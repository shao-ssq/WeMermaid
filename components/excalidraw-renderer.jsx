"use client";

import {useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef} from "react";
import dynamic from "next/dynamic";
import {parseMermaidToExcalidraw} from "@excalidraw/mermaid-to-excalidraw";
import {toast} from "sonner";
import {Button} from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {DiagramTypeSelector} from "@/components/diagram-type-selector";
import {
    Download,
    ZoomIn,
    ZoomOut,
    RefreshCw,
    Minimize,
    Move, FileImage, Monitor
} from "lucide-react";
import "@excalidraw/excalidraw/index.css";
import {convertToExcalidrawElements, exportToBlob, Footer} from "@excalidraw/excalidraw";
import {generateMermaidFromText, optimizeMermaidCode, optimizeMermaidCodeNotStream} from "@/lib/ai-service";


// Dynamically import Excalidraw to avoid SSR issues
const Excalidraw = dynamic(
    async () => (await import("@excalidraw/excalidraw")).Excalidraw,
    {
        ssr: false,
    }
);

function excalidrawToMermaidFlowChart(elements, direction = "TD", includeColors = true) {
    const textMap = {};
    const idMap = {};
    const nodes = {};
    const links = [];
    const classDefs = new Map();
    let idCounter = 0;
    let colorCounter = 0;

    const getAlphaId = () => {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        return letters[idCounter++] || `N${idCounter}`;
    };

    const cleanText = (t) => (t || "").replace(/\s*\n\s*/g, "").trim();

    const getColorClass = (bg, stroke) => {
        const key = `${bg}-${stroke}`;
        if (!classDefs.has(key)) {
            classDefs.set(key, `C${++colorCounter}`);
        }
        return classDefs.get(key);
    };

    // 1️⃣ 收集文字内容
    elements.forEach(el => {
        if (el.type === "text") textMap[el.id] = cleanText(el.text);
    });

    // 2️⃣ 收集节点

    const groupMap = {}; // 临时存储 groupId -> 节点列表

    elements.forEach(el => {
        if (["rectangle", "ellipse", "diamond"].includes(el.type)) {
            const textId = el.boundElements?.find(b => b.type === "text")?.id;
            const text = textMap[textId] || "";
            const alphaId = getAlphaId();
            idMap[el.id] = alphaId;

            // 节点形状
            let shape = `[${text}]`;
            if (el.type === "ellipse") shape = `((${text}))`;
            if (el.type === "diamond") shape = `{${text}}`;

            nodes[alphaId] = includeColors
                ? `${shape}:::${getColorClass(el.backgroundColor || "white", el.strokeColor || "#1e1e1e")}`
                : shape;

            // 如果节点有 groupIds
            if (el.groupIds && el.groupIds.length > 0) {
                el.groupIds.forEach(groupId => {
                    if (!groupMap[groupId]) groupMap[groupId] = [];
                    groupMap[groupId].push({nodeId: alphaId, groupId});
                });
            }
        }
    });
    const groupList = Object.values(groupMap);


    // 3️⃣ 收集箭头
    elements.forEach(el => {
        if (el.type === "arrow") {
            const start = idMap[el.startBinding?.elementId];
            const end = idMap[el.endBinding?.elementId];
            if (!start || !end) return;

            const textId = el.boundElements?.find(b => b.type === "text")?.id;
            const label = textMap[textId] || "";
            const linkLabel = label ? `|${label}|` : "";

            links.push(`${start} -->${linkLabel} ${end}`);
        }
    });

    // 4️⃣ 拼接输出
    const lines = [`flowchart ${direction}`];
    for (const [id, shape] of Object.entries(nodes)) {
        lines.push(`    ${id}${shape}`);
    }
    links.forEach(l => lines.push(`    ${l}`));

    // 5️⃣ 添加颜色定义
    if (includeColors && classDefs.size) {
        lines.push("");
        classDefs.forEach((name, key) => {
            const [bg, stroke] = key.split("-");
            lines.push(`    classDef ${name} fill:${bg},stroke:${stroke},stroke-width:2px;`);
        });
    }
    return {
        code: lines.join("\n"),
        groupList: groupList
    };
}

const DIAGRAM_TYPES = [
    {value: "flowchart", label: "流程图"},
    {value: "sequenceDiagram", label: "时序图"},
    // {value: "classDiagram", label: "类图"},
];
const ExcalidrawRenderer = forwardRef(({
                                           mermaidCode,
                                           onErrorChange,
                                           setRenderMode,
                                           renderMode,
                                           changeMermaidCode,
                                           changeStreamCode,
                                           setIsGenerating,
                                           setIsStreaming,
                                           setStreamingContent
                                       }, ref) => {
    const [excalidrawElements, setExcalidrawElements] = useState([]);
    const [excalidrawFiles, setExcalidrawFiles] = useState({});
    const [excalidrawAPI, setExcalidrawAPI] = useState(null);
    const [isRendering, setIsRendering] = useState(false);
    const [renderError, setRenderError] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isTypeDialogOpen, setIsTypeDialogOpen] = useState(false);
    const [selectedDiagramType, setSelectedDiagramType] = useState("flowchart");
    let [parentDiagramType, setParentDiagramType] = useState(false);

    const [sceneKey, setSceneKey] = useState(0);
    const pendingFitSceneKeyRef = useRef(null);

    // 监听全局事件
    useEffect(() => {
        if (mermaidCode.startsWith("flowchart TD")) {
            setParentDiagramType(true)
        } else {
            setParentDiagramType(false)
        }

        const handleResetView = () => {
            if (excalidrawAPI) {
                excalidrawAPI.resetScene();
                if (mermaidCode && mermaidCode.trim()) {
                    // 重新渲染当前内容
                    renderMermaidContent();
                }
            }
        };

        const handleToggleFullscreen = () => {
            setIsFullscreen(prev => !prev);
        };

        window.addEventListener('resetView', handleResetView);
        window.addEventListener('toggleFullscreen', handleToggleFullscreen);

        return () => {
            window.removeEventListener('resetView', handleResetView);
            window.removeEventListener('toggleFullscreen', handleToggleFullscreen);
        };
    }, [excalidrawAPI, mermaidCode]);

    const renderMermaidContent = useCallback(async () => {
        if (!mermaidCode || mermaidCode.trim() === "") {
            setExcalidrawElements([]);
            setExcalidrawFiles({});
            setRenderError(null);
            setExcalidrawAPI(null);
            setSceneKey((k) => {
                const next = k + 1;
                // 空内容不需要适配
                pendingFitSceneKeyRef.current = null;
                return next;
            });
            return;
        }

        setIsRendering(true);
        setRenderError(null);

        try {
            // 预处理 mermaidCode: 移除 <br> 标签
            const preprocessedCode = mermaidCode.replace(/<br\s*\/?>/gi, '');
            const {elements, files} = await parseMermaidToExcalidraw(preprocessedCode);
            const convertedElements = convertToExcalidrawElements(elements);

            setExcalidrawElements(convertedElements);
            setExcalidrawFiles(files);
            setExcalidrawAPI(null);
            setSceneKey((k) => {
                const next = k + 1;
                // 标记该场景需要在首次变更后自动适配
                pendingFitSceneKeyRef.current = next;
                return next;
            });

            // 通知父组件没有错误
            if (onErrorChange) {
                onErrorChange(null, false);
            }
        } catch (error) {
            console.error("Mermaid rendering error:", error);
            const errorMsg = `${error.message}`;
            setRenderError(errorMsg);
            toast.error("图表渲染失败，请检查 Mermaid 代码语法");

            // 通知父组件有错误，与 mermaid-renderer 保持一致
            if (onErrorChange) {
                onErrorChange(errorMsg, true);
            }
        } finally {
            setIsRendering(false);
        }
    }, [mermaidCode]);

    useEffect(() => {
        renderMermaidContent();
    }, [renderMermaidContent]);

    // 通过 onChange 的首次回调来保证 Excalidraw 完成挂载和布局后再适配
    // 以及在 sceneKey 或 API 就绪时也尝试进行一次自动适配（双保险）
    useEffect(() => {
        if (!excalidrawAPI) return;
        if (renderError) return;
        if (pendingFitSceneKeyRef.current !== sceneKey) return;
        // 等待一帧，确保容器尺寸稳定
        const raf = requestAnimationFrame(() => {
            try {
                excalidrawAPI.scrollToContent(undefined, { fitToContent: true });
            } catch (e) {
                console.error('Auto fit in effect failed:', e);
            }
            pendingFitSceneKeyRef.current = null;
        });
        return () => cancelAnimationFrame(raf);
    }, [excalidrawAPI, sceneKey, renderError]);

    useImperativeHandle(ref, () => ({handleFitToScreen, excalidrawAPI, excalidrawElements}))
    useImperativeHandle(ref, () => ({handleDownload, excalidrawAPI, excalidrawElements, excalidrawFiles}))

    // 缩放功能
    const handleZoomIn = () => {
        if (excalidrawAPI) {
            excalidrawAPI.zoomIn();
        }
    };

    const handleZoomOut = () => {
        if (excalidrawAPI) {
            excalidrawAPI.zoomOut();
        }
    };

    const handleZoomReset = () => {
        if (excalidrawAPI) {
            excalidrawAPI.resetZoom();
            if (excalidrawElements.length > 0) {
                excalidrawAPI.scrollToContent(excalidrawElements, {
                    fitToContent: true,
                });
            }
        }
    };

    // 适应窗口大小
    const handleFitToScreen = () => {
        if (excalidrawAPI && excalidrawElements.length > 0) {
            excalidrawAPI.scrollToContent(excalidrawElements, {
                fitToContent: true,
            });
        }
    };

    const toggleRenderMode = () => {
        setRenderMode(prev => prev === "excalidraw" ? "mermaid" : "excalidraw");
    };

    const handleDownload = async () => {
        if (!excalidrawAPI || excalidrawElements.length === 0) {
            toast.error("没有可下载的内容");
            return;
        }

        try {
            // 获取当前应用状态
            const appState = excalidrawAPI.getAppState();

            // 使用正确的exportToBlob API
            const blob = await exportToBlob({
                elements: excalidrawElements,
                appState: appState,
                files: excalidrawFiles,
                mimeType: "image/png",
                quality: 0.8,
            });

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'excalidraw-diagram.png';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            toast.success("图表已下载");
        } catch (error) {
            console.error('Download error:', error);
            toast.error("下载失败");
        }
    };

    const handGenerateMermaidCode = async (diagramType = "flowchart") => {
        if (!excalidrawAPI) return;
        const elements = excalidrawAPI.getSceneElements();
        setIsGenerating(true);
        setIsStreaming(true);
        setStreamingContent("");
        if (diagramType === "flowchart") {
            const {code, groupList} = excalidrawToMermaidFlowChart(elements);
            if (groupList.length > 0) {
                const mermaidOptimizationPrompt = `
            请按以下要求处理并输出仅包含 Mermaid 代码（不要附带解释或注释）：
            任务目标：
            - 优化并精简 Mermaid 流程图代码，保持逻辑完整，不遗漏任何节点、连线或文本。
            - 支持可选的 groupList 输入：当 groupList 为空或未提供时，不生成任何 subgraph。
            - 当 groupList 有内容时，将属于同一 groupId 的节点自动归入对应 subgraph；生成的 subgraph 数量应与 groupList 中的 groupId 数量一致。
            
            输入内容：
            1. 原始 Mermaid 代码（flowchart TD / LR 等）。
            2. 如果groupList（JSON 数组）非空，格式示例：
               [[{ "nodeId": "C", "groupId": "subgraph_group_移动端流程" }]]
            
            输出要求（严格）：
            - 保留所有节点、连线与文本，移除重复节点、重复连线与无意义循环引用。
            - 节点定义与文本必须紧贴（例如 A[文本]），禁止 HTML 标签或转义符（如 <br>、&lt; 等）。
            - 使用紧凑格式：首行保留原方向（如 flowchart TD），其后每行一条连线，格式形如：
              \`A --> B[文本]\` 或 \`D -->|条件| E[文本]\`
            - 若 groupList 提供了 groupId，则将对应节点放入相应 subgraph 中；否则不生成任何 subgraph。
            - 禁止重复节点定义、多次等价的 classDef；相同样式须合并为单一定义。
            - 保留并规范化 classDef 与 class 使用，样式命名应语义化（如 success, failure, warning, process）。
            - 移除自指或重复循环（如 B --> B），但保留必要的逻辑循环。
            - 同名不同文本的节点需拆分为独立编号节点（如 A1, A2），并保留原连线文本。
            - 输出不得包含空行、注释或非 Mermaid 内容，保证可直接渲染。
            - 节点顺序保持逻辑清晰（入口节点优先），无需完全复原原文件顺序。
            
            输出示例（严格格式）：
            flowchart TD
            A[用户打开App] --> B[显示二维码]
            B --> C[用户扫码]
            C --> D{扫码成功?}
            D -->|是| E[登录]
            D -->|否| F[重试]
            classDef success fill:#d4edda,stroke:#155724,color:#155724
            class E success
                `;
                const {
                    optimizedCode,
                    error
                } = await optimizeMermaidCode(code, mermaidOptimizationPrompt, changeStreamCode, groupList);
                changeMermaidCode(optimizedCode);
            } else {
                const mermaidOptimizationPrompt = `
           请按以下要求处理并输出仅包含 Mermaid 代码（不要附带解释或注释）：
            任务目标：优化并精简 Mermaid 流程图代码，保持逻辑完整，不遗漏任何节点、连线或文本。
            
            输入内容：
            1. 原始 Mermaid 代码（flowchart TD / LR 等）。
            
            输出要求（严格）：
            - 保留所有节点、连线与文本，移除重复节点、重复连线与无意义循环引用。
            - 节点定义与文本必须紧贴（例如 A[文本]），禁止 HTML 标签或转义符（如 <br>、&lt; 等）。
            - 使用紧凑格式：首行保留原方向（如 flowchart TD），其后每行一条连线，格式形如：
              \`A --> B[文本]\` 或 \`D -->|条件| E[文本]\`
            - 禁止重复节点定义、多次等价的 classDef；相同样式须合并为单一定义。
            - 保留并规范化 classDef 与 class 使用，样式命名应语义化（如 success, failure, warning, process）。
            - 移除自指或重复循环（如 B --> B），但保留必要的逻辑循环。
            - 同名不同文本的节点需拆分为独立编号节点（如 A1, A2），并保留原连线文本。
            - 输出不得包含空行、注释或非 Mermaid 内容，保证可直接渲染。
            - 节点顺序保持逻辑清晰（入口节点优先），无需完全复原原文件顺序。
            
            输出示例（严格格式）：
            flowchart TD
            A[用户打开App] --> B[显示二维码]
            B --> C[用户扫码]
            C --> D{扫码成功?}
            D -->|是| E[登录]
            D -->|否| F[重试]
            classDef success fill:#d4edda,stroke:#155724,color:#155724
            class E success
                `;
                const {
                    optimizedCode,
                    error
                } = await optimizeMermaidCode(code, mermaidOptimizationPrompt, changeStreamCode, groupList);
                changeMermaidCode(optimizedCode);
            }
        } else if (diagramType === "sequenceDiagram") {
            console.log(elements)
        }
        setIsGenerating(false);
        setIsStreaming(false);
    }

    return (
        <div className={`${isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'h-full'} flex flex-col`}>
            {/* 控制栏 - 固定高度 */}
            <div className="h-12 flex justify-between items-center flex-shrink-0">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleRenderMode}
                    className="h-9"
                >
                    {renderMode === "excalidraw" ? (
                        <>
                            <FileImage className="h-4 w-4"/>
                            <span className="hidden sm:inline ml-2">Mermaid</span>
                        </>
                    ) : (
                        <>
                            <Monitor className="h-4 w-4"/>
                            <span className="hidden sm:inline ml-2">Excalidraw</span>
                        </>
                    )}
                </Button>

                <div className="flex gap-2">

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsTypeDialogOpen(true)}
                        className="h-7 gap-1 text-xs px-2"
                        title="手动调整图像后反向更新 Mermaid Code"
                        disabled={!excalidrawAPI || !parentDiagramType}
                    >
                        <RefreshCw className="h-3.5 w-3.5"/>
                        <span className="hidden sm:inline">更新 Mermaid Code</span>
                    </Button>

                    {/* 适应窗口 */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFitToScreen}
                        className="h-7 gap-1 text-xs px-2"
                        title="适应窗口"
                        disabled={!excalidrawAPI || excalidrawElements.length === 0}
                    >
                        <Move className="h-3.5 w-3.5"/>
                        <span className="hidden sm:inline">适应</span>
                    </Button>


                    {/* 下载按钮 */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownload}
                        disabled={!excalidrawAPI || excalidrawElements.length === 0}
                        className="h-7 gap-1 text-xs px-2"
                    >
                        <Download className="h-3.5 w-3.5"/>
                        <span className="hidden sm:inline">下载</span>
                    </Button>

                    {/* 全屏模式下的退出按钮 */}
                    {isFullscreen && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsFullscreen(false)}
                            className="h-7 gap-1 text-xs px-2"
                            title="退出全屏"
                        >
                            <Minimize className="h-3.5 w-3.5"/>
                            <span className="hidden sm:inline">退出</span>
                        </Button>
                    )}
                </div>
            </div>

            {/* 图表类型选择对话框 */}
            <Dialog open={isTypeDialogOpen} onOpenChange={setIsTypeDialogOpen}>
                <DialogContent
                    className="max-w-sm sm:max-w-md p-5 rounded-2xl shadow-lg border border-muted bg-background/95 backdrop-blur-md transition-all">
                    <div className="flex flex-col gap-3">
                        <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                            选择生成的图表类型
                        </DialogTitle>

                        <div className="flex items-center justify-between mt-1">
                            <span className="text-sm text-muted-foreground">图表类型：</span>
                            <Select value={selectedDiagramType} onValueChange={setSelectedDiagramType}>
                                <SelectTrigger id="diagram-type"
                                               className="w-40 text-sm border-muted focus:ring-2 focus:ring-primary/40">
                                    <SelectValue placeholder="选择图表类型"/>
                                </SelectTrigger>
                                <SelectContent>
                                    {DIAGRAM_TYPES.map((type) => (
                                        <SelectItem key={type.value} value={type.value} className="text-sm">
                                            {type.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter className="mt-4 flex justify-end gap-3">
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setIsTypeDialogOpen(false)}
                        >
                            取消
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            className="rounded-lg shadow-sm hover:shadow-md transition-all"
                            onClick={() => {
                                handGenerateMermaidCode(selectedDiagramType);
                                setIsTypeDialogOpen(false);
                            }}
                            disabled={!excalidrawAPI}
                        >
                            生成
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>


            {/* 图表显示区域 - 占用剩余空间 */}
            <div className="flex-1 border rounded-lg bg-gray-50 dark:bg-gray-900 relative min-h-0 overflow-hidden">
                {isRendering && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                        <div className="flex items-center space-x-2">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                            <span className="text-muted-foreground">渲染中...</span>
                        </div>
                    </div>
                )}

                {renderError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                        <div className="text-center p-4">
                            <p className="text-destructive mb-2">渲染失败</p>
                            <p className="text-sm text-muted-foreground">{renderError}</p>
                        </div>
                    </div>
                )}

                {!isRendering && !renderError && !mermaidCode && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-muted-foreground">请生成Mermaid代码以查看图表</p>
                    </div>
                )}

                <div className="w-full h-full">
                    <Excalidraw
                        key={sceneKey}
                        initialData={{
                            elements: excalidrawElements,
                            appState: {
                                viewBackgroundColor: "#fafafa",
                                currentItemFontFamily: 1,
                            },
                            files: excalidrawFiles,
                            scrollToContent: excalidrawElements.length > 0,
                        }
                        }
                        excalidrawAPI={(api) => setExcalidrawAPI(api)}
                        onChange={(elements) => {
                            // 仅在新场景挂载后的首次变更时自动适配一次
                            if (
                                pendingFitSceneKeyRef.current === sceneKey &&
                                excalidrawAPI &&
                                elements &&
                                elements.length > 0 &&
                                !renderError
                            ) {
                                // 等待一帧，确保容器尺寸与布局稳定
                                requestAnimationFrame(() => {
                                    try {
                                        excalidrawAPI.scrollToContent(undefined, { fitToContent: true });
                                    } catch (e) {
                                        console.error('Auto fit in onChange failed:', e);
                                    }
                                });
                                pendingFitSceneKeyRef.current = null;
                            }
                        }}
                    >
                        <Footer>
                        </Footer>
                    </Excalidraw>
                </div>
            </div>
        </div>
    );
});

export default ExcalidrawRenderer;
