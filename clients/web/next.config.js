/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  typescript: {
    ignoreBuildErrors: true,
  },
  staticPageGenerationTimeout: 1,
};

module.exports = nextConfig;
