export function resolveMathliveFontsDirectory(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return '/fonts/'
  }

  const cssFontsDirectory = getComputedStyle(document.documentElement)
    .getPropertyValue('--mathfield-fonts-directory')

  let fontsDirectory = cssFontsDirectory || '/fonts/'

  // Remove wrapping quotes and any whitespace (including accidental " / fonts / ")
  fontsDirectory = fontsDirectory.replace(/^['"]|['"]$/g, '').replace(/\s+/g, '')

  if (!fontsDirectory) {
    fontsDirectory = '/fonts/'
  }

  if (!fontsDirectory.startsWith('/')) {
    fontsDirectory = `/${fontsDirectory}`
  }

  if (!fontsDirectory.endsWith('/')) {
    fontsDirectory = `${fontsDirectory}/`
  }

  return fontsDirectory
}

export function configureMathliveFontsDirectory(): void {
  if (typeof window === 'undefined') return

  const MathfieldElement = (globalThis as any).MathfieldElement as
    | { fontsDirectory?: string | null }
    | undefined

  if (!MathfieldElement) return

  const fontsDirectory = resolveMathliveFontsDirectory()

  if (MathfieldElement.fontsDirectory !== fontsDirectory) {
    MathfieldElement.fontsDirectory = fontsDirectory
  }
}
