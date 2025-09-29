"use client";

import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {Copy, Check, Wand2, RotateCw, Maximize, RotateCcw} from "lucide-react";
import { copyToClipboard } from "@/lib/utils";
import { autoFixMermaidCode, toggleMermaidDirection } from "@/lib/mermaid-fixer";
import { toast } from "sonner";

// 新增的流式内容显示组件
function StreamingDisplay({ content, isStreaming, isFixing }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [content]);


  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center h-6">
        <h3 className="text-sm font-medium">实时生成</h3>
        {isStreaming && (
          <div className="flex items-center text-xs text-muted-foreground">
            <div className="animate-pulse mr-1 h-2 w-2 rounded-full bg-green-500"></div>
            {isFixing ? "正在修复..." : "正在生成..."}
          </div>
        )}
      </div>
      <div
        ref={contentRef}
        className="border rounded-md p-3 h-24 overflow-y-auto font-mono text-sm bg-muted/50"
      >
        {content || "等待生成..."}
      </div>
    </div>
  );
}

export function MermaidEditor({ code, onChange, streamingContent, isStreaming, errorMessage, hasError, onStreamChunk }) {
  const [copied, setCopied] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [fixingContent, setFixingContent] = useState("");
  const [isHorizontal, setIsHorizontal] = useState(true);

  const handleChange = (e) => {
    onChange(e.target.value);
  };

  const handleCopy = async () => {
    const success = await copyToClipboard(code);

    if (success) {
      setCopied(true);
      toast.success("已复制到剪贴板");

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } else {
      toast.error("复制失败");
    }
  };

  const handleAutoFix = async () => {
    if (!code) {
      toast.error("没有代码可以修复");
      return;
    }

    setIsFixing(true);
    setFixingContent("");

    try {
      // 流式修复回调函数
      const handleFixChunk = (chunk) => {
        setFixingContent(prev => prev + chunk);
        // 如果有父组件的流式回调，也调用它
        if (onStreamChunk) {
          onStreamChunk(chunk);
        }
      };

      // 传递错误信息给AI修复函数
      const result = await autoFixMermaidCode(code, errorMessage, handleFixChunk);

      if (result.error) {
        toast.error(result.error);
        // 如果有基础修复的代码，仍然应用它
        if (result.fixedCode !== code) {
          onChange(result.fixedCode);
          toast.info("已应用基础修复");
        }
      } else {
        if (result.fixedCode !== code) {
          onChange(result.fixedCode);
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
      setFixingContent("");
    }
  };

  const handleToggleDirection = () => {
    if (!code) {
      toast.error("没有代码可以切换方向");
      return;
    }

    const toggledCode = toggleMermaidDirection(code);
    if (toggledCode !== code) {
      onChange(toggledCode);
      setIsHorizontal(!isHorizontal);
    } else {
      toast.info("未检测到可切换的方向");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 流式内容显示区域 - 固定高度 */}
      <div className="mb-4">
        <StreamingDisplay
          content={isFixing ? fixingContent : streamingContent}
          isStreaming={isStreaming || isFixing}
          isFixing={isFixing}
        />
      </div>
      
      {/* 编辑器标题栏 - 固定高度 */}
      <div className="flex justify-between items-center h-8 mb-2">
        <h3 className="text-sm font-medium">Mermaid 代码</h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoFix}
            disabled={!code || isFixing || !hasError}
            className="h-7 gap-1 text-xs"
            title={hasError ? "使用AI智能修复代码问题" : "当前代码没有错误，无需修复"}
          >
            {isFixing ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                <span className="hidden sm:inline">修复中...</span>
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3" />
                <span className="hidden sm:inline">AI修复</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleToggleDirection}
            disabled={!code}
            className="h-7 gap-1 text-xs"
            title="切换图表方向 (横向/纵向)"
          >
            <RotateCw className="h-3 w-3" />
            <span className="hidden sm:inline">{isHorizontal ? "横向" : "纵向"}</span>
          </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    window.dispatchEvent(new CustomEvent('resetView'));
                }}
                className="h-7 gap-1 text-xs"
                title="重绘视图"
            >
                <RotateCcw className="h-3 w-3"/>
                <span className="hidden sm:inline">重绘</span>
            </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!code}
            className="h-7 gap-1 text-xs"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                已复制
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                复制
              </>
            )}
          </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    window.dispatchEvent(new CustomEvent('toggleFullscreen'));
                }}
                className="h-7 gap-1 text-xs"
                title="全屏显示"
            >
                <Maximize className="h-4 w-4"/>
            </Button>

        </div>
      </div>

      {/* 代码编辑器容器 - 占用剩余空间 */}
      <div className="flex-1 min-h-0">
        <Textarea
          value={code}
          onChange={handleChange}
          placeholder="生成的 Mermaid 代码将显示在这里..."
          className="w-full h-full font-mono text-sm mermaid-editor overflow-y-auto resize-none"
          disabled={isStreaming || isFixing}
        />
      </div>
    </div>
  );
} 