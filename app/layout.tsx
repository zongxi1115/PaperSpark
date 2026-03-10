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
      <body style={{ margin: 0, height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Providers>
          <TopNav />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {children}
          </div>
        </Providers>
      </body>
    </html>
  )
}
