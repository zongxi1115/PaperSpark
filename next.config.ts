import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
