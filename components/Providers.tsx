'use client'
import { HeroUIProvider, ToastProvider } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { VercelPreviewNotice } from '@/components/VercelPreviewNotice'
import { WorkspaceBridgeAutoSync } from '@/components/Settings/WorkspaceBridgeAutoSync'
import { createContext, useContext, ReactNode } from 'react'
import { useTheme, ThemeMode } from '@/lib/theme'

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

  return (
    <HeroUIProvider navigate={router.push}>
      <ThemeContext.Provider value={themeValue}>
        <ToastProvider placement="top-right" />
        <VercelPreviewNotice />
        <WorkspaceBridgeAutoSync />
        {children}
      </ThemeContext.Provider>
    </HeroUIProvider>
  )
}
