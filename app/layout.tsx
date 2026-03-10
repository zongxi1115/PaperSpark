import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { TopNav } from '@/components/Navigation/TopNav'
import '@blocknote/mantine/style.css'
import './globals.css'

export const metadata: Metadata = {
  title: '论文写作助手',
  description: '专注的学术论文写作工具',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, height: '100vh', overflow: 'hidden' }}>
        <Providers>
          {/* Fixed TopNav */}
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50 }}>
            <TopNav />
          </div>
          {/* Content area with top padding for fixed nav */}
          <div style={{ height: '100vh', paddingTop: 52, overflowY: 'auto' }}>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}
