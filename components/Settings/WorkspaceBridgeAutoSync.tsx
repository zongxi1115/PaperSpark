'use client'

import { useEffect, useRef } from 'react'
import { syncWorkspaceSnapshotToServer, buildWorkspaceSnapshot } from '@/lib/workspaceSnapshotClient'
import { WORKSPACE_BRIDGE_SYNC_EVENT } from '@/lib/workspaceBridgeEvents'
import type { WorkspaceSnapshot } from '@/lib/workspaceSnapshot'

const STARTUP_DELAY_MS = 700
const MUTATION_DELAY_MS = 900
const PERIODIC_SYNC_MS = 30000
const MIN_SYNC_GAP_MS = 4000

export function WorkspaceBridgeAutoSync() {
  const inFlightRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const lastSyncAtRef = useRef(0)
  const lastFingerprintRef = useRef('')

  useEffect(() => {
    const scheduleSync = (delay = MUTATION_DELAY_MS) => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
      }

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        void syncNow()
      }, delay)
    }

    const syncNow = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }

      if (inFlightRef.current) {
        scheduleSync(MUTATION_DELAY_MS)
        return
      }

      const elapsed = Date.now() - lastSyncAtRef.current
      if (elapsed < MIN_SYNC_GAP_MS) {
        scheduleSync(MIN_SYNC_GAP_MS - elapsed)
        return
      }

      inFlightRef.current = true

      try {
        const snapshot = await buildWorkspaceSnapshot()
        const fingerprint = createSnapshotFingerprint(snapshot)

        if (fingerprint === lastFingerprintRef.current) {
          lastSyncAtRef.current = Date.now()
          return
        }

        await syncWorkspaceSnapshotToServer(snapshot)
        lastFingerprintRef.current = fingerprint
        lastSyncAtRef.current = Date.now()
      } catch (error) {
        console.warn('Workspace bridge auto-sync failed:', error)
      } finally {
        inFlightRef.current = false
      }
    }

    const handleWorkspaceChanged = () => scheduleSync(MUTATION_DELAY_MS)
    const handleFocus = () => scheduleSync(250)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        scheduleSync(250)
      }
    }

    scheduleSync(STARTUP_DELAY_MS)

    window.addEventListener(WORKSPACE_BRIDGE_SYNC_EVENT, handleWorkspaceChanged)
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisible)

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        scheduleSync(0)
      }
    }, PERIODIC_SYNC_MS)

    return () => {
      window.removeEventListener(WORKSPACE_BRIDGE_SYNC_EVENT, handleWorkspaceChanged)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisible)
      window.clearInterval(intervalId)
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return null
}

function createSnapshotFingerprint(snapshot: WorkspaceSnapshot) {
  return JSON.stringify({
    theme: snapshot.data.theme,
    lastDocId: snapshot.data.lastDocId,
    settings: snapshot.data.settings,
    zotero: snapshot.data.zotero,
    stats: snapshot.stats,
    documents: snapshot.data.documents.map(item => [item.id, item.updatedAt]),
    documentVersions: snapshot.data.documentVersions.map(item => [item.id, item.createdAt]),
    knowledge: snapshot.data.knowledge.map(item => [
      item.id,
      item.updatedAt,
      item.immersive?.document?.updatedAt || item.immersive?.document?.parsedAt || '',
      item.immersive?.translation?.translatedAt || '',
      item.immersive?.guide?.updatedAt || item.immersive?.guide?.generatedAt || '',
      (item.immersive?.annotations || []).map(annotation => annotation.id).join('|'),
      (item.immersive?.pages || []).map(page => `${page.id}:${page.blockCount}:${page.fullText.length}`).join('|'),
    ]),
    assets: snapshot.data.assets.map(item => [item.id, item.updatedAt]),
    assetTypes: snapshot.data.assetTypes.map(item => [item.id, item.updatedAt]),
    thoughts: snapshot.data.thoughts.map(item => [item.id, item.updatedAt]),
    agents: snapshot.data.agents.map(item => [item.id, item.title, item.prompt, item.isDefault || false, item.isPreset]),
    conversations: snapshot.data.conversations.map(item => [item.id, item.updatedAt]),
    assistantNotes: snapshot.data.assistantNotes.map(item => [item.id, item.updatedAt]),
    knowledgeGraph: snapshot.data.knowledgeGraph
      ? [snapshot.data.knowledgeGraph.updatedAt, snapshot.data.knowledgeGraph.nodes.length, snapshot.data.knowledgeGraph.edges.length]
      : null,
  })
}
