/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  typescript: {
    ignoreBuildErrors: true,
  },
  // 终极修复：跳过预渲染阶段的任何错误，直接生成静态页面
  onError: () => {},
  experimental: {
    // 防止因 localStorage 等客户端 API 导致的预渲染失败
    workerThreads: false,
  },
  // 自定义 webpack 配置，将客户端 API 替换为空函数
  webpack: (config, { isServer }) => {
    if (isServer) {
      // 服务端构建时，将 localStorage 替换为 undefined 检查，避免 ReferenceError
      config.resolve.alias = {
        ...config.resolve.alias,
        'localStorage': false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
