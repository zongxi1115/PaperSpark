'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button, Divider, Tooltip } from '@heroui/react'
import { useThemeContext } from '@/components/Providers'
import { Icon } from '@iconify/react'

function ThoughtIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
      <path d="M12 6a1 1 0 0 0-1 1v4.59l-2.71 2.7a1 1 0 0 0 1.42 1.42l3-3A1 1 0 0 0 13 12V7a1 1 0 0 0-1-1z" />
      <circle cx="12" cy="17" r="1" />
    </svg>
  )
}

export function TopNav() {
  const pathname = usePathname()
  const { theme, setTheme, resolvedTheme, mounted } = useThemeContext()

  const isEditor = pathname.startsWith('/editor')
  const isDocuments = pathname === '/documents'
  const isThoughts = pathname === '/thoughts'
  const isSettings = pathname === '/settings'

  // 切换主题的快捷方式：在 light/dark 之间切换（跳过 system）
  const toggleTheme = () => {
    if (theme === 'system') {
      // 如果当前是 system，根据实际主题切换到相反的固定主题
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
    } else {
      setTheme(theme === 'dark' ? 'light' : 'dark')
    }
  }

  return (
    <nav
      style={{
        height: 52,
        background: 'var(--bg-primary)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 8,
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ color: 'var(--accent-color)' }}
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14,2 14,8 20,8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
        <span style={{ fontWeight: 600, fontSize: 15 }}>PaperSpark</span>
      </div>

      <Divider orientation="vertical" style={{ height: 20 }} />

      <div style={{ display: 'flex', gap: 4 }}>
        <Link href="/documents">
          <Button
            size="sm"
            variant={isDocuments ? 'flat' : 'light'}
            color={isDocuments ? 'primary' : 'default'}
            startContent={<DocIcon />}
          >
            文档列表
          </Button>
        </Link>

        <Link href="/thoughts">
          <Button
            size="sm"
            variant={isThoughts ? 'flat' : 'light'}
            color={isThoughts ? 'secondary' : 'default'}
            startContent={<ThoughtIcon />}
          >
            随记想法
          </Button>
        </Link>

        {isEditor && (
          <Button size="sm" variant="flat" color="primary" startContent={<EditIcon />} isDisabled>
            编辑器
          </Button>
        )}

        <Link href="/settings">
          <Button
            size="sm"
            variant={isSettings ? 'flat' : 'light'}
            color={isSettings ? 'primary' : 'default'}
            startContent={<SettingsIcon />}
          >
            设置
          </Button>
        </Link>
      </div>

      {/* 右侧主题切换按钮 */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
        <Tooltip 
          content={mounted ? (resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式') : '加载中...'}
          placement="bottom"
        >
          <Button
            isIconOnly
            size="sm"
            variant="light"
            onPress={toggleTheme}
            isDisabled={!mounted}
          >
            <Icon 
              icon={mounted && resolvedTheme === 'dark' ? 'solar:sun-bold' : 'solar:moon-bold'} 
              width={18}
              style={{ color: 'var(--text-secondary)' }}
            />
          </Button>
        </Tooltip>
      </div>
    </nav>
  )
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

