export const WORKSPACE_BRIDGE_SYNC_EVENT = 'paperspark-workspace-bridge-sync'

export function emitWorkspaceBridgeChanged(reason = 'workspace-updated') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_BRIDGE_SYNC_EVENT, {
      detail: {
        reason,
        at: new Date().toISOString(),
      },
    }),
  )
}
