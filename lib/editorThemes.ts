import { lightDefaultTheme, type Theme } from '@blocknote/mantine'

export interface EditorThemeConfig {
  id: string
  name: string
  description: string
  /** CSS font-family 值 */
  fontFamily: string
  /** Google Fonts URL，null 表示使用系统字体 */
  googleFontUrl?: string
  borderRadius?: number
  /** 编辑器背景色覆盖（浅色模式） */
  lightEditorBackground?: string
}

export const EDITOR_THEMES: EditorThemeConfig[] = [
  {
    id: 'default',
    name: '默认',
    description: '简洁现代无衬线，清晰易读',
    fontFamily:
      '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", "Roboto", sans-serif',
    borderRadius: 6,
  },
  {
    id: 'source-serif',
    name: '学术经典',
    description: 'Source Serif 4，专为学术阅读优化的衬线字体',
    fontFamily: '"Source Serif 4", "Georgia", "Times New Roman", serif',
    googleFontUrl:
      'https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300..700;1,8..60,300..700&display=swap',
    borderRadius: 4,
  },
  {
    id: 'lora',
    name: '优雅阅读',
    description: 'Lora，温润优雅的人文衬线字体',
    fontFamily: '"Lora", "Georgia", serif',
    googleFontUrl:
      'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&display=swap',
    borderRadius: 6,
  },
  {
    id: 'dm-sans',
    name: '现代简约',
    description: 'DM Sans，圆润几何无衬线，清爽明快',
    fontFamily: '"DM Sans", "Helvetica Neue", Arial, sans-serif',
    googleFontUrl:
      'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,300..700&display=swap',
    borderRadius: 10,
  },
  {
    id: 'crimson',
    name: '暖调书写',
    description: 'Crimson Pro，暖色衬线字体，如纸张温度',
    fontFamily: '"Crimson Pro", "Georgia", serif',
    googleFontUrl:
      'https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,200..900;1,200..900&display=swap',
    borderRadius: 4,
    lightEditorBackground: '#fdfaf5',
  },
  {
    id: 'jetbrains-mono',
    name: '等宽代码',
    description: 'JetBrains Mono，程序员与技术写作的理想选择',
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
    googleFontUrl:
      'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap',
    borderRadius: 4,
  },
]

/**
 * 根据 id 获取主题配置，找不到时返回默认主题
 */
export function getThemeById(id: string): EditorThemeConfig {
  return EDITOR_THEMES.find(t => t.id === id) ?? EDITOR_THEMES[0]
}

/**
 * 将 EditorThemeConfig 转换为 BlockNote 的 Theme 对象。
 * light 和 dark 均基于 lightDefaultTheme，确保始终呈现浅色背景，
 * 并叠加自定义字体、圆角与背景色。
 */
export function buildBlockNoteTheme(config: EditorThemeConfig): { light: Theme; dark: Theme } {
  const overrides: Theme = {
    ...lightDefaultTheme,
    fontFamily: config.fontFamily,
    borderRadius: config.borderRadius ?? 6,
    ...(config.lightEditorBackground
      ? {
          colors: {
            ...lightDefaultTheme.colors,
            editor: {
              ...lightDefaultTheme.colors?.editor,
              background: config.lightEditorBackground,
            },
          },
        }
      : {}),
  }

  // 无论系统深/浅色模式，都强制使用浅色主题颜色 + 自定义字体
  return { light: overrides, dark: overrides }
}

/**
 * 动态注入 Google Fonts <link> 标签，已注入则跳过
 */
export function injectGoogleFont(url: string): void {
  if (typeof document === 'undefined') return
  const alreadyLoaded = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .some(el => el.getAttribute('href') === url)
  if (alreadyLoaded) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  document.head.appendChild(link)
}
