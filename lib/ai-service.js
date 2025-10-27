import {cleanText} from "./utils";
import {getAIConfig, getSavedPassword, getSelectedModel} from "./config-service";

/**
 * Sends text to AI API for processing and returns the generated Mermaid code
 * @param {string} text - The text to process
 * @param {string} diagramType - The type of diagram to generate (e.g., 'flowchart', 'sequence', etc.)
 * @param {function} onChunk - Callback function to receive streaming chunks
 * @returns {Promise<{mermaidCode: string, error: string|null}>} - The generated Mermaid code or error
 */
export async function generateMermaidFromText(text, diagramType = "flowchart", onChunk = null) {
    if (!text) {
        return {mermaidCode: "", error: "请提供文本内容"};
    }

    const cleanedText = cleanText(text);

    if (cleanedText.length > parseInt(process.env.NEXT_PUBLIC_MAX_CHARS || "20000")) {
        return {
            mermaidCode: "",
            error: `文本超过${process.env.NEXT_PUBLIC_MAX_CHARS || "20000"}字符限制`
        };
    }

    // 获取AI配置、密码和选择的模型
    const aiConfig = getAIConfig();
    const accessPassword = getSavedPassword();
    const selectedModel = getSelectedModel();

    // 如果没有提供 onChunk 回调，则使用传统的非流式方式
    if (!onChunk) {
        return generateMermaidTraditional(cleanedText, diagramType, aiConfig, accessPassword, selectedModel);
    }

    try {
        console.log(aiConfig)
        console.log(accessPassword)
        console.log(selectedModel)
        const response = await fetch("/api/generate-mermaid", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text: cleanedText,
                diagramType,
                aiConfig, // 传递AI配置到后端
                accessPassword, // 传递密码到后端
                selectedModel // 传递选择的模型到后端
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "生成图表时出错");
        }

        // 处理流式响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullMermaidCode = "";
        let buffer = ""; // Buffer to accumulate JSON data

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, {stream: true});
            buffer += chunk; // Add new chunk to buffer

            // Process complete JSON objects from the buffer
            let startPos = 0;
            let endPos;

            while ((endPos = findJsonObjectEnd(buffer, startPos)) !== -1) {
                try {
                    const jsonStr = buffer.substring(startPos, endPos + 1);
                    const data = JSON.parse(jsonStr);

                    if (data.error) {
                        throw new Error(data.error);
                    }

                    if (data.chunk && !data.done) {
                        // 收到新的代码片段，调用回调
                        onChunk(data.chunk);
                    }

                    if (data.done && data.mermaidCode) {
                        // 流式接收完成，返回最终的完整代码
                        fullMermaidCode = data.mermaidCode;
                    }

                    // Move start position for next JSON object
                    startPos = endPos + 1;

                } catch (e) {
                    console.error("Error parsing streaming chunk:", e, buffer.substring(startPos, endPos + 1));
                    // Skip this malformed object
                    startPos = endPos + 1;
                }
            }

            // Keep any remaining incomplete data in the buffer
            buffer = buffer.substring(startPos);
        }

        return {mermaidCode: fullMermaidCode, error: null};
    } catch (error) {
        console.error("AI API Error:", error);
        return {
            mermaidCode: "",
            error: error.message || "与AI服务通信时出错"
        };
    }
}

export async function optimizeMermaidCode(mermaidCode, instruction = "", onChunk = null, groupList = null) {
    if (!mermaidCode) {
        return {optimizedCode: "", error: "请提供需要优化的Mermaid代码"};
    }

    // 获取AI配置、密码和选择的模型
    const aiConfig = getAIConfig();
    const accessPassword = getSavedPassword();
    const selectedModel = getSelectedModel();
    let response = null
    try {
        if (groupList == null) {
            response = await fetch("/api/optimize-mermaid", {
                method: "POST",
                headers: {"Content-Type": "application/json", "Accept": "text/event-stream"},
                body: JSON.stringify({mermaidCode, instruction, aiConfig, accessPassword, selectedModel})
            });
        } else {
            response = await fetch("/api/optimize-mermaid", {
                method: "POST",
                headers: {"Content-Type": "application/json", "Accept": "text/event-stream"},
                body: JSON.stringify({mermaidCode, instruction, groupList, aiConfig, accessPassword, selectedModel})
            });
        }

        if (!response.ok || !response.body) {
            try {
                const errorData = await response.json();
                throw new Error(errorData.error || "优化代码时出错");
            } catch (_) {
                throw new Error("优化代码时出错");
            }
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let mermaidFull = "";

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, {stream: true});
            const events = chunk.split("\n\n").filter(Boolean);
            for (const evt of events) {
                const line = evt.trim();
                if (!line.startsWith("data:")) continue;
                const payloadStr = line.slice(5).trim();
                if (!payloadStr) continue;
                try {
                    const payload = JSON.parse(payloadStr);
                    if (payload.type === 'chunk' && payload.data) {
                        if (onChunk) onChunk(payload.data);
                    } else if (payload.type === 'final' && payload.ok) {
                        mermaidFull = payload.data || "";
                    } else if (payload.type === 'error') {
                        throw new Error(payload.message || "优化代码时出错");
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        return {optimizedCode: mermaidFull, error: null};
    } catch (error) {
        console.error("Optimize API Error:", error);
        return {optimizedCode: "", error: error.message || "与AI服务通信时出错"};
    }
}


export async function fetchOptimizationSuggestions(mermaidCode) {
    if (!mermaidCode) {
        return {suggestions: [], error: "请提供Mermaid代码"};
    }

    const aiConfig = getAIConfig();
    const accessPassword = getSavedPassword();
    const selectedModel = getSelectedModel();

    try {
        const response = await fetch("/api/optimize-mermaid/suggestions", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({mermaidCode, aiConfig, accessPassword, selectedModel})
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "获取优化建议失败");
        }

        const data = await response.json();
        const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
        return {suggestions, error: null};
    } catch (error) {
        console.error("Suggestions API Error:", error);
        return {suggestions: [], error: error.message || "与AI服务通信时出错"};
    }
}

/**
 * 传统的非流式 API 调用（作为备选方案）
 * @private
 */
async function generateMermaidTraditional(cleanedText, diagramType, aiConfig, accessPassword, selectedModel) {
    try {
        const response = await fetch("/api/generate-mermaid", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text: cleanedText,
                diagramType,
                aiConfig, // 传递AI配置到后端
                accessPassword, // 传递密码到后端
                selectedModel // 传递选择的模型到后端
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "生成图表时出错");
        }

        const data = await response.json();
        return {mermaidCode: data.mermaidCode, error: null};
    } catch (error) {
        console.error("AI API Error:", error);
        return {
            mermaidCode: "",
            error: error.message || "与AI服务通信时出错"
        };
    }
}

/**
 * Helper function to find the end position of a JSON object in a string
 * @param {string} str - The string containing JSON data
 * @param {number} startPos - Position to start searching from
 * @returns {number} - End position of the JSON object or -1 if no complete object found
 */
function findJsonObjectEnd(str, startPos) {
    if (startPos >= str.length) return -1;

    // Find the start of a JSON object
    let pos = str.indexOf('{', startPos);
    if (pos === -1) return -1;

    let braceCount = 1;
    let inString = false;
    let escaping = false;

    // Parse through the string to find the matching closing brace
    for (let i = pos + 1; i < str.length; i++) {
        const char = str[i];

        if (escaping) {
            escaping = false;
            continue;
        }

        if (char === '\\' && inString) {
            escaping = true;
            continue;
        }

        if (char === '"' && !escaping) {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === '{') {
                braceCount++;
            } else if (char === '}') {
                braceCount--;
                // Found the matching closing brace
                if (braceCount === 0) {
                    return i;
                }
            }
        }
    }

    // No complete JSON object found
    return -1;
}
