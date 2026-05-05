'use client'
import { HeroUIProvider, ToastProvider } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { VercelPreviewNotice } from '@/components/VercelPreviewNotice'
import { WorkspaceBridgeAutoSync } from '@/components/Settings/WorkspaceBridgeAutoSync'
import { createContext, useContext, useEffect, useState } from 'react'
import { useTheme, ThemeMode } from '@/lib/theme'
import { initializeStorage } from '@/lib/storage/StorageFactory'
import { syncDesktopLauncherSettingsToLocalStorage } from '@/lib/desktopSettingsSync'

// 主题 Context
interface ThemeContextValue {
  theme: ThemeMode
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: ThemeMode) => void
  mounted: boolean
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useThemeContext() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useThemeContext must be used within a ThemeProvider')
  }
  return context
}

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const themeValue = useTheme()
  const [storageReady, setStorageReady] = useState(false)

  useEffect(() => {
    let active = true

    void initializeStorage()
      .then(() => syncDesktopLauncherSettingsToLocalStorage())
      .catch((error) => {
        console.error('Workspace storage bootstrap failed:', error)
      })
      .finally(() => {
        if (active) {
          setStorageReady(true)
        }
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <HeroUIProvider navigate={router.push}>
      <ThemeContext.Provider value={themeValue}>
        <ToastProvider placement="top-right" />
        {storageReady ? (
          <>
            <VercelPreviewNotice />
            <WorkspaceBridgeAutoSync />
            {children}
          </>
        ) : (
          <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            正在加载本地工作区…
          </div>
        )}
      </ThemeContext.Provider>
    </HeroUIProvider>
  )
}
