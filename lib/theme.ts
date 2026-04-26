'use client'

import { useEffect, useState, useCallback } from 'react'
import { getString, setString } from './storage/StorageUtils'
import { emitWorkspaceBridgeChanged } from './workspaceBridgeEvents'

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'theme'

// 获取系统主题偏好
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// 获取存储的主题设置
function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = getString(THEME_STORAGE_KEY, 'system')
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

// 存储主题设置
function storeTheme(theme: ThemeMode) {
  if (typeof window === 'undefined') return
  setString(THEME_STORAGE_KEY, theme)
  emitWorkspaceBridgeChanged('theme-changed')
}

// 应用主题到 DOM
function applyTheme(theme: ThemeMode) {
  if (typeof window === 'undefined') return
  
  const resolved = theme === 'system' ? getSystemTheme() : theme
  
  // 更新 html class
  const html = document.documentElement
  if (resolved === 'dark') {
    html.classList.add('dark')
  } else {
    html.classList.remove('dark')
  }
  
  // 更新 HeroUI 主题属性
  html.setAttribute('data-theme', resolved)
}

// 主题 Hook
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const [mounted, setMounted] = useState(false)

  // 初始化
  useEffect(() => {
    const stored = getStoredTheme()
    setThemeState(stored)
    applyTheme(stored)
    setResolvedTheme(stored === 'system' ? getSystemTheme() : stored)
    setMounted(true)
    
    // 监听系统主题变化
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system')
        setResolvedTheme(getSystemTheme())
      }
    }
    
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  // 设置主题
  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme)
    storeTheme(newTheme)
    applyTheme(newTheme)
    setResolvedTheme(newTheme === 'system' ? getSystemTheme() : newTheme)
  }, [])

  return {
    theme,
    resolvedTheme,
    setTheme,
    mounted,
    isDark: resolvedTheme === 'dark',
  }
}

// 主题切换组件（用于 SSR 避免闪烁）
export function getThemeScript() {
  return `
    (function() {
      try {
        var theme = localStorage.getItem('paper_reader_${THEME_STORAGE_KEY}') || 'system';
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
}
