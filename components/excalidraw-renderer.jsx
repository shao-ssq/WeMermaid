"use client";

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import dynamic from "next/dynamic";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { DiagramTypeSelector } from "@/components/diagram-type-selector";
import {
    Download,
    ZoomIn,
    ZoomOut,
    RefreshCw,
    Minimize,
    Move, FileImage, Monitor
} from "lucide-react";
import "@excalidraw/excalidraw/index.css";
import { convertToExcalidrawElements, exportToBlob, Footer } from "@excalidraw/excalidraw";

// Dynamically import Excalidraw to avoid SSR issues
const Excalidraw = dynamic(
    async () => (await import("@excalidraw/excalidraw")).Excalidraw,
    {
        ssr: false,
    }
);

function excalidrawToMermaid(elements, diagramType = "flowchart", direction = "TD", includeColors = true) {
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
            const className = `C${++colorCounter}`;
            classDefs.set(key, className);
        }
        return classDefs.get(key);
    };

    // 1️⃣ 收集文字
    elements.forEach((el) => {
        if (el.type === "text") textMap[el.id] = cleanText(el.text);
    });

    // 2️⃣ 收集节点
    elements.forEach((el) => {
        if (["rectangle", "ellipse", "diamond"].includes(el.type)) {
            const textId = el.boundElements?.find((b) => b.type === "text")?.id;
            const text = textMap[textId] || "";
            const alphaId = getAlphaId();
            idMap[el.id] = alphaId;

            if (diagramType === "flowchart") {
                let shape = `[${text}]`;
                if (el.type === "ellipse") shape = `((${text}))`;
                if (el.type === "diamond") shape = `{${text}}`;

                nodes[alphaId] = includeColors
                    ? `${shape}:::${getColorClass(el.backgroundColor || "white", el.strokeColor || "#1e1e1e")}`
                    : shape;

            } else if (diagramType === "classDiagram") {
                nodes[alphaId] = text.replace(/[[\]{}()]/g, '');
            } else if (diagramType === "sequenceDiagram") {
                nodes[alphaId] = text || alphaId;
            }
        }
    });

    // 3️⃣ 收集箭头
    elements.forEach((el) => {
        if (el.type === "arrow") {
            const start = idMap[el.startBinding?.elementId];
            const end = idMap[el.endBinding?.elementId];
            if (!start || !end) return;

            const textId = el.boundElements?.find((b) => b.type === "text")?.id;
            const label = textMap[textId] || "";

            if (diagramType === "flowchart") {
                const linkLabel = label ? `|${label}|` : "";
                links.push(`${start} -->${linkLabel} ${end}`);
            } else if (diagramType === "classDiagram") {
                // 简单映射：实线箭头为继承
                links.push(`${start} <|-- ${end}`);
            } else if (diagramType === "sequenceDiagram") {
                const msg = label || "";
                links.push(`${start}->>${end}: ${msg}`);
            }
        }
    });

    // 4️⃣ 拼接输出
    const lines = [];
    if (diagramType === "flowchart") {
        lines.push(`flowchart ${direction}`);
        lines.push(...Object.entries(nodes).map(([id, shape]) => `    ${id}${shape}`));
        lines.push(...links.map((l) => `    ${l}`));
    } else if (diagramType === "classDiagram") {
        lines.push("classDiagram");
        lines.push(...Object.values(nodes).map(n => `    class ${n}`));
        lines.push(...links.map(l => `    ${l}`));
    } else if (diagramType === "sequenceDiagram") {
        lines.push("sequenceDiagram");
        lines.push(...links.map(l => `    ${l}`));
    }

    // 颜色定义只对 flowchart 和 classDiagram 有效
    if (includeColors && classDefs.size && diagramType !== "sequenceDiagram") {
        lines.push("");
        classDefs.forEach((name, key) => {
            const [bg, stroke] = key.split("-");
            lines.push(`    classDef ${name} fill:${bg},stroke:${stroke},stroke-width:2px;`);
        });
    }

    return lines.join("\n");
}
const DIAGRAM_TYPES = [
  { value: "flowchart", label: "流程图" },
  { value: "sequenceDiagram", label: "时序图" },
  { value: "classDiagram", label: "类图" },
];
const ExcalidrawRenderer = forwardRef(({
    mermaidCode,
    onErrorChange,
    setRenderMode,
    renderMode,
    changeMermaidCode
}, ref) => {
    const [excalidrawElements, setExcalidrawElements] = useState([]);
    const [excalidrawFiles, setExcalidrawFiles] = useState({});
    const [excalidrawAPI, setExcalidrawAPI] = useState(null);
    const [isRendering, setIsRendering] = useState(false);
    const [renderError, setRenderError] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isTypeDialogOpen, setIsTypeDialogOpen] = useState(false);
    const [selectedDiagramType, setSelectedDiagramType] = useState("flowchart");


    // 监听全局事件
    useEffect(() => {
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
        if (!excalidrawAPI || !mermaidCode || mermaidCode.trim() === "") {
            setExcalidrawElements([]);
            setExcalidrawFiles({});
            setRenderError(null);
            if (excalidrawAPI) {
                excalidrawAPI.resetScene();
            }
            return;
        }

        setIsRendering(true);
        setRenderError(null);

        try {
            // 预处理 mermaidCode: 移除 <br> 标签
            const preprocessedCode = mermaidCode.replace(/<br\s*\/?>/gi, '');
            const { elements, files } = await parseMermaidToExcalidraw(preprocessedCode);
            const convertedElements = convertToExcalidrawElements(elements);

            setExcalidrawElements(convertedElements);
            setExcalidrawFiles(files);
            excalidrawAPI.updateScene({
                elements: convertedElements,
            });
            excalidrawAPI.scrollToContent(convertedElements, {
                fitToContent: true,
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
    }, [excalidrawAPI, mermaidCode]);

    useEffect(() => {
        renderMermaidContent();
    }, [renderMermaidContent]);

    useImperativeHandle(ref, () => ({ handleFitToScreen, excalidrawAPI, excalidrawElements }))
    useImperativeHandle(ref, () => ({ handleDownload, excalidrawAPI, excalidrawElements, excalidrawFiles }))

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

    const handGenerateMermaidCode = (diagramType = "flowchart") => {
        if (!excalidrawAPI) return;
        const elements = excalidrawAPI.getSceneElements();
        const code = excalidrawToMermaid(elements, diagramType);
        changeMermaidCode(code);
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
                            <FileImage className="h-4 w-4" />
                            <span className="hidden sm:inline ml-2">Mermaid</span>
                        </>
                    ) : (
                        <>
                            <Monitor className="h-4 w-4" />
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
                        disabled={!excalidrawAPI}
                    >
                        <RefreshCw className="h-3.5 w-3.5" />
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
                        <Move className="h-3.5 w-3.5" />
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
                        <Download className="h-3.5 w-3.5" />
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
                            <Minimize className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">退出</span>
                        </Button>
                    )}
                </div>
            </div>

            {/* 图表类型选择对话框 */}
            <Dialog open={isTypeDialogOpen} onOpenChange={setIsTypeDialogOpen}>
                <DialogContent className="max-w-sm sm:max-w-md p-5 rounded-2xl shadow-lg border border-muted bg-background/95 backdrop-blur-md transition-all">
                    <div className="flex flex-col gap-3">
                        <DialogTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                            选择生成的图表类型
                        </DialogTitle>

                        <div className="flex items-center justify-between mt-1">
                            <span className="text-sm text-muted-foreground">图表类型：</span>
                            <Select value={selectedDiagramType} onValueChange={setSelectedDiagramType}>
                                <SelectTrigger id="diagram-type" className="w-40 text-sm border-muted focus:ring-2 focus:ring-primary/40">
                                    <SelectValue placeholder="选择图表类型" />
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
                        initialData={{
                            appState: {
                                viewBackgroundColor: "#fafafa",
                                currentItemFontFamily: 1,
                            },
                        }
                        }
                        excalidrawAPI={(api) => setExcalidrawAPI(api)}
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
