import type { Metadata } from 'next'
import { Providers } from '@/components/Providers'
import { TopNav } from '@/components/Navigation/TopNav'
import '@blocknote/mantine/style.css'
import '@blocknote/xl-ai/style.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'PaperSpark',
  description: '专注的学术论文写作工具',
}

// 防止 SSR 主题闪烁的脚本
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('paper_reader_theme') || 'system';
      var resolved = theme === 'system' 
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      if (resolved === 'dark') {
        document.documentElement.classList.add('dark');
      }
      document.documentElement.setAttribute('data-theme', resolved);
    } catch (e) {}
  })();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
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