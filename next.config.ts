import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Docker 部署必需：生成独立可运行的输出
  output: 'standalone',
  transpilePackages: [
    '@antv/x6',
    '@antv/x6-plugin-clipboard',
    '@antv/x6-plugin-export',
    '@antv/x6-plugin-history',
    '@antv/x6-plugin-keyboard',
    '@antv/x6-plugin-selection',
    '@antv/x6-plugin-snapline',
    '@antv/x6-plugin-stencil',
    '@antv/x6-react-shape',
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
