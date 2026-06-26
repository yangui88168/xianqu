/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',   // ← 新增：生成纯静态文件
}
module.exports = nextConfig
