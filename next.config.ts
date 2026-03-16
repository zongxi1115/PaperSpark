import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Docker 部署必需：生成独立可运行的输出
  output: 'standalone',
  transpilePackages: [
    '@blocknote/core',
    '@blocknote/react',
    '@blocknote/mantine',
  ],
  webpack: (config) => {
    // 解决 Yjs 重复导入警告
    config.resolve.alias = {
      ...config.resolve.alias,
      yjs: require.resolve('yjs'),
    }
    return config
  },
}

export default nextConfig
