import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: [
    '@blocknote/core',
    '@blocknote/react',
    '@blocknote/mantine',
  ],
}

export default nextConfig
