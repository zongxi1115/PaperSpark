export interface DesktopPythonCandidate {
  path: string
  displayName: string
  version: string
  versionLabel: string
  compatible: boolean
  ready: boolean
  supportsCodeRuntime?: boolean
  supportsSelfHostedParser?: boolean
  packageChecks?: Record<string, boolean>
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
      savedDeploymentMode: 'local' | 'cloud' | 'mineru'
      savedLocalParserEnabled?: boolean
      savedServiceUrl: string
      savedMineruUrl?: string
      savedMineruApiKey?: string
      savedMineruModelVersion?: string
      candidates: DesktopPythonCandidate[]
    }>
    browsePythonPath: () => Promise<DesktopPythonCandidate | null>
    confirmPythonPath: (payload: {
      mode: 'local' | 'cloud' | 'mineru'
      pythonPath?: string | null
      enableLocalParser?: boolean
      serviceUrl?: string
      mineruUrl?: string
      mineruApiKey?: string
      mineruModelVersion?: string
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
