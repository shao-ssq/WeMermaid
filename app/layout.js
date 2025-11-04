import {ThemeProvider} from "@/components/theme-provider";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
export const metadata = {
    title: "WeMermaid",
    description: "利用 AI 技术将文本内容智能转换为 Mermaid 格式的可视化图表",
};

export default function RootLayout({children}) {
    return (
        <html lang="zh-CN" suppressHydrationWarning>
        <body>
        <ThemeProvider defaultTheme="system" storageKey="theme">
            {children}
            <Toaster />
        </ThemeProvider>
        </body>
        </html>
    );
}
