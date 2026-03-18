'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { addToast } from '@heroui/react'
import { CanvasStencil } from './CanvasStencil'
import {
  createCanvasGraphSession,
  exportGraphDataUrl,
  getCanvasBlockDefaults,
  getViewportRect,
  type CanvasBlockProps,
  type CanvasGraphSession,
  type CanvasOriginRect,
  setCanvasGraphTheme,
} from '@/lib/canvasX6'

interface CanvasEditorProps {
  graphData?: string
  width?: number
  height?: number
  isDark: boolean
  originRect: CanvasOriginRect | null
  onSave: (payload: CanvasBlockProps) => void
  onClose: () => void
}

function ToolbarButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 32,
        padding: '0 12px',
        borderRadius: 10,
        border: '1px solid rgba(148, 163, 184, 0.18)',
        background: disabled ? 'rgba(148, 163, 184, 0.1)' : 'rgba(255, 255, 255, 0.08)',
        color: disabled ? 'rgba(148, 163, 184, 0.72)' : 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

export function CanvasEditor({
  graphData,
  width,
  height,
  isDark,
  originRect,
  onSave,
  onClose,
}: CanvasEditorProps) {
  const graphHostRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [session, setSession] = useState<CanvasGraphSession | null>(null)
  const [stencilCollapsed, setStencilCollapsed] = useState(false)
  const [closing, setClosing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })

  const viewportRect = useMemo(() => getViewportRect(), [mounted])
  const fromRect = originRect ?? viewportRect
  const initialScaleX = viewportRect.width ? fromRect.width / viewportRect.width : 1
  const initialScaleY = viewportRect.height ? fromRect.height / viewportRect.height : 1

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || !graphHostRef.current) return

    let disposed = false
    let currentSession: CanvasGraphSession | null = null

    ;(async () => {
      const nextSession = await createCanvasGraphSession({
        container: graphHostRef.current!,
        stencilHost: document.createElement('div'),
        graphData,
        isDark,
        width,
        height,
      })

      if (disposed) {
        nextSession.dispose()
        return
      }

      currentSession = nextSession
      setSession(nextSession)
      setZoomLevel(Number(nextSession.graph.zoom?.() ?? 1))
      setHistoryState({
        canUndo: Boolean(nextSession.history.canUndo?.()),
        canRedo: Boolean(nextSession.history.canRedo?.()),
      })

      nextSession.graph.on('scale', () => {
        setZoomLevel(Number(nextSession.graph.zoom?.() ?? 1))
      })

      nextSession.history.on('change', () => {
        setHistoryState({
          canUndo: Boolean(nextSession.history.canUndo?.()),
          canRedo: Boolean(nextSession.history.canRedo?.()),
        })
      })
    })()

    return () => {
      disposed = true
      currentSession?.dispose()
    }
  }, [graphData, height, mounted, width])

  useEffect(() => {
    if (!session) return
    setCanvasGraphTheme(session.graph, isDark, session.stencil)
  }, [isDark, session])

  useEffect(() => {
    rootRef.current?.focus()
  }, [mounted])

  const handleExportPng = async () => {
    if (!session) return

    try {
      const dataUrl = await exportGraphDataUrl({
        graph: session.graph,
        format: 'png',
        isDark,
        maxWidth: 1600,
        maxHeight: 1200,
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = 'paperspark-canvas.png'
      link.click()
    } catch (error) {
      addToast({ title: `导出 PNG 失败：${error instanceof Error ? error.message : '未知错误'}`, color: 'danger' })
    }
  }

  const handleClose = async () => {
    if (!session || saving) {
      setClosing(true)
      return
    }

    setSaving(true)
    try {
      const previewDataUrl = await exportGraphDataUrl({
        graph: session.graph,
        format: 'jpeg',
        isDark,
      })

      onSave({
        ...getCanvasBlockDefaults(),
        graphData: JSON.stringify(session.graph.toJSON?.() ?? {}),
        previewDataUrl,
        width: width ?? getCanvasBlockDefaults().width,
        height: height ?? getCanvasBlockDefaults().height,
      })
    } catch (error) {
      addToast({ title: `保存画板失败：${error instanceof Error ? error.message : '未知错误'}`, color: 'danger' })
    } finally {
      setSaving(false)
      setClosing(true)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDownCapture={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          void handleClose()
        }
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: 0.24 }}
        style={{
          position: 'absolute',
          inset: 0,
          background: isDark ? 'rgba(2, 6, 23, 0.62)' : 'rgba(15, 23, 42, 0.18)',
          backdropFilter: 'blur(10px)',
        }}
      />

      <motion.div
        initial={{
          x: fromRect.x,
          y: fromRect.y,
          scaleX: initialScaleX,
          scaleY: initialScaleY,
          borderRadius: 24,
          opacity: 0.98,
        }}
        animate={closing
          ? {
              x: fromRect.x,
              y: fromRect.y,
              scaleX: initialScaleX,
              scaleY: initialScaleY,
              borderRadius: 24,
              opacity: 0.98,
            }
          : {
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
              borderRadius: 0,
              opacity: 1,
            }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => {
          if (closing) {
            onClose()
          }
        }}
        style={{
          position: 'absolute',
          inset: 0,
          transformOrigin: 'top left',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: isDark ? '#020617' : '#ffffff',
          color: isDark ? '#e2e8f0' : '#0f172a',
          boxShadow: '0 30px 80px rgba(15, 23, 42, 0.24)',
        }}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
            borderBottom: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.18)'}`,
            background: isDark ? 'rgba(2, 6, 23, 0.94)' : 'rgba(255, 255, 255, 0.96)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ToolbarButton onClick={() => void handleClose()}>{saving ? '保存中…' : '关闭'}</ToolbarButton>
            <ToolbarButton onClick={() => session?.history.undo?.()} disabled={!historyState.canUndo}>撤销</ToolbarButton>
            <ToolbarButton onClick={() => session?.history.redo?.()} disabled={!historyState.canRedo}>重做</ToolbarButton>
            <ToolbarButton
              onClick={() => {
                session?.graph.zoom?.(-0.1)
                setZoomLevel(Number(session?.graph.zoom?.() ?? zoomLevel))
              }}
            >
              缩小
            </ToolbarButton>
            <div style={{ minWidth: 68, textAlign: 'center', fontSize: 13, fontWeight: 600 }}>
              {Math.round(zoomLevel * 100)}%
            </div>
            <ToolbarButton
              onClick={() => {
                session?.graph.zoom?.(0.1)
                setZoomLevel(Number(session?.graph.zoom?.() ?? zoomLevel))
              }}
            >
              放大
            </ToolbarButton>
            <ToolbarButton
              onClick={() => {
                session?.graph.zoomToFit?.({ padding: 48, maxScale: 1.15 })
                setZoomLevel(Number(session?.graph.zoom?.() ?? zoomLevel))
              }}
            >
              适配
            </ToolbarButton>
            <ToolbarButton onClick={() => void handleExportPng()}>导出 PNG</ToolbarButton>
          </div>

          <div style={{ fontSize: 14, fontWeight: 700 }}>论文画板</div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <CanvasStencil
            hostElement={session?.stencil?.container ?? null}
            collapsed={stencilCollapsed}
            isDark={isDark}
            onToggle={() => setStencilCollapsed((value) => !value)}
          />

          <div
            style={{
              flex: 1,
              minWidth: 0,
              position: 'relative',
              background: isDark ? '#08111f' : '#f8fafc',
            }}
          >
            <div
              ref={graphHostRef}
              style={{
                position: 'absolute',
                inset: 0,
                cursor: 'default',
              }}
            />
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
