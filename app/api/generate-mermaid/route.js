import { cleanText } from "@/lib/utils";
import { buildMermaidSystemPrompt } from "@/lib/prompts/mermaid";
export async function POST(request) {
  try {
    const { text, diagramType, aiConfig, accessPassword, selectedModel } = await request.json();

    if (!text) {
      return Response.json({ error: "请提供文本内容" }, { status: 400 });
    }

    const cleanedText = cleanText(text);

    let finalConfig;

    // 步骤1: 检查是否有完整的aiConfig
    const hasCompleteAiConfig = aiConfig?.apiUrl && aiConfig?.apiKey && aiConfig?.modelName;

    if (hasCompleteAiConfig) {
      // 如果有完整的aiConfig，直接使用
      finalConfig = {
        apiUrl: aiConfig.apiUrl,
        apiKey: aiConfig.apiKey,
        modelName: aiConfig.modelName
      };
    } else {
      // 步骤2: 如果没有完整的aiConfig，则检验accessPassword
      if (accessPassword) {
        // 步骤3: 如果传入了accessPassword，验证是否有效
        const correctPassword = process.env.ACCESS_PASSWORD;
        const isPasswordValid = correctPassword && accessPassword === correctPassword;

        if (!isPasswordValid) {
          // 如果密码无效，直接报错
          return Response.json({
            error: "访问密码无效"
          }, { status: 401 });
        }
      }

      // 如果没有传入accessPassword或者accessPassword有效，使用环境变量配置
      // 如果有选择的模型，使用选择的模型，否则使用默认模型
      finalConfig = {
        apiUrl: process.env.AI_API_URL,
        apiKey: process.env.AI_API_KEY,
        modelName: process.env.AI_MODEL_NAME
      };
    }

    // 检查最终配置是否完整
    if (!finalConfig.apiUrl || !finalConfig.apiKey || !finalConfig.modelName) {
      return Response.json({
        error: "AI配置不完整，请在设置中配置API URL、API Key和模型名称"
      }, { status: 400 });
    }

    const systemPrompt = buildMermaidSystemPrompt({ diagramType: diagramType || "auto", language: "zh" });

    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: cleanedText,
      },
    ];

    // 构建API URL
    const url = finalConfig.apiUrl.includes("v1") || finalConfig.apiUrl.includes("v3")
      ? `${finalConfig.apiUrl}/chat/completions`
      : `${finalConfig.apiUrl}/v1/chat/completions`;

    console.log('Using AI config:', {
      url,
      modelName: finalConfig.modelName,
      hasApiKey: !!finalConfig.apiKey,
    });

    // 创建一个流式响应
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 发送请求到 AI API (开启流式模式)
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${finalConfig.apiKey}`,
            },
            body: JSON.stringify({
              model: finalConfig.modelName,
              messages,
              stream: true, // 开启流式输出
            }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error("AI API Error:", response.status, errorText);
            controller.enqueue(encoder.encode(JSON.stringify({
              error: `AI服务返回错误 (${response.status}): ${errorText || 'Unknown error'}`
            })));
            controller.close();
            return;
          }

          // 读取流式响应
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let mermaidCode = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 解析返回的数据块
            const chunk = decoder.decode(value, { stream: true });

            // 处理数据行
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.substring(6);
                if (data === '[DONE]') continue;

                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices[0]?.delta?.content || '';
                  if (content) {
                    mermaidCode += content;
                    // 发送给客户端
                    controller.enqueue(encoder.encode(JSON.stringify({
                      chunk: content,
                      done: false
                    })));
                  }
                } catch (e) {
                  console.error('Error parsing chunk:', e);
                }
              }
            }
          }

          // 提取代码块中的内容（如果有代码块标记）
          const codeBlockMatch = mermaidCode.match(/```(?:mermaid)?\s*([\s\S]*?)```/);
          const finalCode = codeBlockMatch ? codeBlockMatch[1].trim() : mermaidCode;

          // 发送完成信号
          controller.enqueue(encoder.encode(JSON.stringify({
            mermaidCode: finalCode,
            done: true
          })));

        } catch (error) {
          console.error("Streaming Error:", error);
          controller.enqueue(encoder.encode(JSON.stringify({
            error: `处理请求时发生错误: ${error.message}`,
            done: true
          })));
        } finally {
          controller.close();
        }
      }
    });

    // 返回流式响应
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error("API Route Error:", error);
    return Response.json(
      { error: `处理请求时发生错误: ${error.message}` },
      { status: 500 }
    );
  }
}
