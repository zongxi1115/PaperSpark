export interface DesktopPythonCandidate {
  path: string
  displayName: string
  version: string
  versionLabel: string
  compatible: boolean
  ready: boolean
  sourceLabel?: string
  issues: string[]
}

export interface DesktopWindowState {
  isMaximized: boolean
}

export interface PaperSparkDesktopAPI {
  isDesktop: boolean
  platform: string
  launcher: {
    getState: () => Promise<{
      savedPythonPath: string | null
      savedDeploymentMode: 'local' | 'cloud'
      savedServiceUrl: string
      candidates: DesktopPythonCandidate[]
    }>
    browsePythonPath: () => Promise<DesktopPythonCandidate | null>
    confirmPythonPath: (payload: {
      mode: 'local' | 'cloud'
      pythonPath?: string | null
      serviceUrl?: string
    }) => Promise<{ ok: true }>
  }
  windowControls: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<DesktopWindowState>
    close: () => Promise<void>
    getState: () => Promise<DesktopWindowState>
    onStateChange: (listener: (state: DesktopWindowState) => void) => () => void
  }
}

declare global {
  interface Window {
    papersparkDesktop?: PaperSparkDesktopAPI
  }
}
