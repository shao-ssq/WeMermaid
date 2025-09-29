/** @type {import('next').NextConfig} */
const nextConfig = {
    // 启用 standalone 输出模式以支持 Docker
    output: 'standalone',

    // 优化图片处理
    images: {
        unoptimized: true
    },
    devIndicators: false,

    // 服务器外部包配置
    serverExternalPackages: []
};

export default nextConfig;

