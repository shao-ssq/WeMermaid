"use client";

import {useState, useEffect, useCallback, useRef} from "react";
import {toast} from "sonner";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Button} from "@/components/ui/button";
import {
    Wand2,
} from "lucide-react";
import {TextInput} from "@/components/text-input";
import {FileUpload} from "@/components/file-upload";
import {DiagramTypeSelector} from "@/components/diagram-type-selector";
import {ModelSelector} from "@/components/model-selector";
import {MermaidEditor} from "@/components/mermaid-editor";
import {MermaidRenderer} from "@/components/mermaid-renderer";
import { HistoryList } from "@/components/history-list";
import {generateMermaidFromText} from "@/lib/ai-service";
import {isWithinCharLimit} from "@/lib/utils";
import {autoFixMermaidCode, toggleMermaidDirection} from "@/lib/mermaid-fixer";
import dynamic from "next/dynamic";
import {addHistoryEntry, getHistory} from "@/lib/history-service";

const ExcalidrawRenderer = dynamic(() => import("@/components/excalidraw-renderer"), {ssr: false});

const usageLimit = parseInt(process.env.NEXT_PUBLIC_DAILY_USAGE_LIMIT || "5");

const getRemainingUsage = () => {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    const usageData = JSON.parse(localStorage.getItem('usageData') || '{}');
    const todayUsage = usageData[today] || 0;
    return Math.max(0, usageLimit - todayUsage);
};


export default function Home() {
    const [inputText, setInputText] = useState("");
    const [mermaidCode, setMermaidCode] = useState("");
    const [diagramType, setDiagramType] = useState("flowchart");
    const [isGenerating, setIsGenerating] = useState(false);
    const [streamingContent, setStreamingContent] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const fitRef = useRef(null)
    const [historyEntries, setHistoryEntries] = useState([]);

    // 新增状态：左侧面板折叠和渲染模式
    const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
    const [renderMode, setRenderMode] = useState("excalidraw"); // "excalidraw" | "mermaid"
    const [isFixing, setIsFixing] = useState(false);

    // 错误状态管理
    const [errorMessage, setErrorMessage] = useState(null);
    const [hasError, setHasError] = useState(false);

    const maxChars = parseInt(process.env.NEXT_PUBLIC_MAX_CHARS || "20000");

    useEffect(() => {
        setHistoryEntries(getHistory());
    }, []);

    const handleTextChange = (text) => {
        setInputText(text);
    };

    const handleFileTextExtracted = (text) => {
        setInputText(text);
    };

    const handleDiagramTypeChange = (type) => {
        setDiagramType(type);
    };

    const handleMermaidCodeChange = (code) => {
        setMermaidCode(code);
    };

    const handleStreamChunk = (chunk) => {
        setStreamingContent(prev => prev + chunk);
    };

    // 处理错误状态变化
    const handleErrorChange = (error, hasErr) => {
        setErrorMessage(error);
        setHasError(hasErr);
    };

    // 切换左侧面板
    const toggleLeftPanel = () => {
        setIsLeftPanelCollapsed(!isLeftPanelCollapsed);
    };

    // 使用useCallback优化ModelSelector的回调
    const handleModelChange = useCallback((modelId) => {
        console.log('Selected model:', modelId);
    }, []);

    // 自动修复Mermaid代码
    const handleAutoFixMermaid = async () => {
        if (!mermaidCode) {
            toast.error("没有代码可以修复");
            return;
        }

        setIsFixing(true);
        setStreamingContent(""); // 清空流式内容，准备显示修复内容

        try {
            // 流式修复回调函数
            const handleFixChunk = (chunk) => {
                setStreamingContent(prev => prev + chunk);
            };

            // 传递错误信息给AI修复函数
            const result = await autoFixMermaidCode(mermaidCode, errorMessage, handleFixChunk);

            if (result.error) {
                toast.error(result.error);
                // 如果有基础修复的代码，仍然应用它
                if (result.fixedCode !== mermaidCode) {
                    setMermaidCode(result.fixedCode);
                    toast.info("已应用基础修复");
                }
            } else {
                if (result.fixedCode !== mermaidCode) {
                    setMermaidCode(result.fixedCode);
                    toast.success("AI修复完成");
                } else {
                    toast.info("代码看起来没有问题");
                }
            }
        } catch (error) {
            console.error("修复失败:", error);
            toast.error("修复失败，请稍后重试");
        } finally {
            setIsFixing(false);
            // 修复完成后清空流式内容
            setTimeout(() => {
                setStreamingContent("");
            }, 1000);
        }
    };

    // 切换图表方向
    const handleToggleMermaidDirection = () => {
        if (!mermaidCode) {
            toast.error("没有代码可以切换方向");
            return;
        }

        const toggledCode = toggleMermaidDirection(mermaidCode);
        if (toggledCode !== mermaidCode) {
            setMermaidCode(toggledCode);
            toast.success("图表方向已切换");
        } else {
            toast.info("未检测到可切换的方向");
        }
    };

    const handleGenerateClick = async () => {
        if (!inputText.trim()) {
            toast.error("请输入文本内容");
            return;
        }

        if (!isWithinCharLimit(inputText, maxChars)) {
            toast.error(`文本超过${maxChars}字符限制`);
            return;
        }

        setIsGenerating(true);
        setIsStreaming(true);
        setStreamingContent("");

        try {
            const {mermaidCode: generatedCode, error} = await generateMermaidFromText(
                inputText,
                diagramType,
                handleStreamChunk
            );

            if (error) {
                toast.error(error);
                return;
            }

            if (!generatedCode) {
                toast.error("生成图表失败，请重试");
                return;
            }

            setMermaidCode(generatedCode);
            try {
                addHistoryEntry({ inputText, mermaidCode: generatedCode, diagramType });
                setHistoryEntries(getHistory());
            } catch {}
            toast.success("图表生成成功");
        } catch (error) {
            console.error("Generation error:", error);
            toast.error("生成图表时发生错误");
        } finally {
            setIsGenerating(false);
            setIsStreaming(false);
        }
    };

    return (
        <div className="flex flex-col h-screen overflow-hidden">

            <main className="flex-1 overflow-hidden">
                <div className="h-full p-4 md:p-6">
                    <div
                        className={`h-full grid gap-4 md:gap-6 transition-all duration-300 ${
                            isLeftPanelCollapsed ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'
                        }`}
                    >
                        {/* 左侧面板 */}
                        <div className={`${
                            isLeftPanelCollapsed ? 'hidden md:hidden' : 'col-span-1'
                        } flex flex-col h-full overflow-hidden`}>

                            <Tabs defaultValue="manual" className="flex flex-col h-full">
                                {/* 固定高度的顶部控制栏 */}
                                <div
                                    className="h-auto md:h-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-2 flex-shrink-0 pb-2 md:pb-0">
                                    <TabsList className="h-9 w-full md:w-auto">
                                        <TabsTrigger value="manual"
                                                     className="flex-1 md:flex-none">手动输入</TabsTrigger>
                                        <TabsTrigger value="file" className="flex-1 md:flex-none">文件上传</TabsTrigger>
                                        <TabsTrigger value="history" className="flex-1 md:flex-none">历史记录</TabsTrigger>
                                    </TabsList>
                                    <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
                                        <ModelSelector onModelChange={handleModelChange}/>
                                        <div className="flex-1 md:flex-none min-w-0">
                                            <DiagramTypeSelector
                                                value={diagramType}
                                                onChange={handleDiagramTypeChange}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* 主内容区域 */}
                                <div className="flex-1 flex flex-col overflow-hidden mt-2 md:mt-4">
                                    {/* 输入区域 - 固定高度 */}
                                    <div className="h-40 md:h-56 flex-shrink-0">
                                        <TabsContent value="manual" className="h-full mt-0">
                                            <TextInput
                                                value={inputText}
                                                onChange={handleTextChange}
                                                maxChars={maxChars}
                                            />
                                        </TabsContent>
                                        <TabsContent value="file" className="h-full mt-0">
                                            <FileUpload onTextExtracted={handleFileTextExtracted}/>
                                        </TabsContent>
                                        <TabsContent value="history" className="h-full mt-0">
                                            <HistoryList
                                                items={historyEntries}
                                                onSelect={(item) => {
                                                    setInputText(item.inputText);
                                                    setMermaidCode(item.mermaidCode);
                                                    setLeftTab("manual");
                                                }}
                                            />
                                        </TabsContent>
                                    </div>

                                    {/* 生成按钮 - 固定高度 */}
                                    <div className="h-16 flex items-center flex-shrink-0">
                                        <Button
                                            onClick={handleGenerateClick}
                                            disabled={isGenerating || !inputText.trim() || !isWithinCharLimit(inputText, maxChars)}
                                            className="w-full h-10"
                                        >
                                            {isGenerating ? (
                                                <>
                                                    <div
                                                        className="animate-spin rounded-full h-4 w-4 border-b-2 border-background mr-2"></div>
                                                    生成中...
                                                </>
                                            ) : (
                                                <>
                                                    <Wand2 className="mr-2 h-4 w-4"/>
                                                    生成图表
                                                </>
                                            )}
                                        </Button>
                                    </div>

                                    {/* 编辑器区域 - 占用剩余空间 */}
                                    <div className="flex-1 min-h-0">
                                        <MermaidEditor
                                            code={mermaidCode}
                                            onChange={handleMermaidCodeChange}
                                            streamingContent={streamingContent}
                                            isStreaming={isStreaming}
                                            errorMessage={errorMessage}
                                            hasError={hasError}
                                            onStreamChunk={handleStreamChunk}
                                        />
                                    </div>
                                </div>
                            </Tabs>
                        </div>

                        {/* 右侧面板 */}
                        <div className={`${
                            isLeftPanelCollapsed ? 'col-span-1' : 'col-span-1 md:col-span-2'
                        } flex flex-col h-full overflow-hidden`}>

                            {/* 渲染器区域 - 占用剩余空间 */}
                            <div className="flex-1 min-h-0" style={{minHeight: '600px'}}>
                                {renderMode === "excalidraw" ? (
                                    <ExcalidrawRenderer
                                        ref={fitRef}
                                        mermaidCode={mermaidCode}
                                        parentDiagramType = {diagramType}
                                        onErrorChange={handleErrorChange}
                                        setRenderMode={setRenderMode}
                                        changeMermaidCode={handleMermaidCodeChange}
                                        changeStreamCode = {handleStreamChunk}
                                        setIsGenerating = {setIsGenerating}
                                        setIsStreaming = {setIsStreaming}
                                        setStreamingContent = {setStreamingContent}
                                    />
                                ) : (
                                    <MermaidRenderer
                                        mermaidCode={mermaidCode}
                                        onChange={handleMermaidCodeChange}
                                        onErrorChange={handleErrorChange}
                                        setRenderMode={setRenderMode}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

