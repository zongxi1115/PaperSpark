'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Button, Card, CardBody, Chip, Input, Tooltip, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
import { CanvasStencil } from './CanvasStencil'
import {
  CANVAS_DRAG_MIME,
  createCanvasGraphSession,
  exportGraphDataUrl,
  getCanvasBlockDefaults,
  getCanvasEdgeLabel,
  getCanvasNodeLabel,
  getCanvasPresetGroups,
  getViewportRect,
  insertCanvasPresetNode,
  setCanvasEdgeLabel,
  setCanvasGraphTheme,
  setCanvasNodeLabel,
  type CanvasBlockProps,
  type CanvasGraphSession,
  type CanvasOriginRect,
} from '@/lib/canvasX6'

interface CanvasEditorProps {
  graphData?: string
  previewDataUrl?: string
  width?: number
  height?: number
  isDark: boolean
  originRect: CanvasOriginRect | null
  onSave: (payload: CanvasBlockProps) => void
  onClose: () => void
}

type FloatingRect = {
  left: number
  top: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function ToolbarButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: string
  label: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip content={label}>
      <Button isIconOnly size="sm" variant="flat" onPress={onPress} isDisabled={disabled} aria-label={label}>
        <Icon icon={icon} width={18} />
      </Button>
    </Tooltip>
  )
}

function getGraphCellRect(graph: any, cell: any): FloatingRect | null {
  if (!graph || !cell?.getBBox) return null
  const box = graph.localToClient(cell.getBBox())
  if (!box) return null

  return {
    left: Number(box.x ?? 0),
    top: Number(box.y ?? 0),
    width: Number(box.width ?? 0),
    height: Number(box.height ?? 0),
  }
}

export function CanvasEditor({
  graphData,
  previewDataUrl,
  width,
  height,
  isDark,
  originRect,
  onSave,
  onClose,
}: CanvasEditorProps) {
  const graphHostRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const nodeEditorRef = useRef<HTMLDivElement | null>(null)
  const resizeRef = useRef<{
    nodeId: string
    startClientX: number
    startClientY: number
    startWidth: number
    startHeight: number
    minWidth: number
    minHeight: number
    keepAspect: boolean
    aspectRatio: number
  } | null>(null)

  const [mounted, setMounted] = useState(false)
  const [session, setSession] = useState<CanvasGraphSession | null>(null)
  const [stencilCollapsed, setStencilCollapsed] = useState(false)
  const [closing, setClosing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedNodeRect, setSelectedNodeRect] = useState<FloatingRect | null>(null)
  const [selectionToolbarRect, setSelectionToolbarRect] = useState<FloatingRect | null>(null)
  const [selectionCount, setSelectionCount] = useState(0)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [nodeLabelDraft, setNodeLabelDraft] = useState('')
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [edgeEditing, setEdgeEditing] = useState(false)
  const [edgeToolbarRect, setEdgeToolbarRect] = useState<FloatingRect | null>(null)
  const [edgeLabelDraft, setEdgeLabelDraft] = useState('')

  const presetGroups = useMemo(() => getCanvasPresetGroups(), [])
  const viewportRect = useMemo(() => getViewportRect(), [mounted])
  const fromRect = originRect ?? viewportRect
  const initialScaleX = viewportRect.width ? fromRect.width / viewportRect.width : 1
  const initialScaleY = viewportRect.height ? fromRect.height / viewportRect.height : 1

  const refreshFloatingUi = useCallback(() => {
    if (!session) return

    const selectedCells = session.selection.getSelectedCells?.() ?? []
    if (selectedCells.length > 1) {
      const bbox = session.graph.getCellsBBox?.(selectedCells)
      const box = bbox ? session.graph.localToClient(bbox) : null
      if (box) {
        setSelectionToolbarRect({
          left: Number(box.x ?? 0),
          top: Number(box.y ?? 0),
          width: Number(box.width ?? 0),
          height: Number(box.height ?? 0),
        })
        setSelectionCount(selectedCells.length)
      } else {
        setSelectionToolbarRect(null)
        setSelectionCount(0)
      }
    } else {
      setSelectionToolbarRect(null)
      setSelectionCount(selectedCells.length)
    }

    if (selectedNodeId) {
      const node = session.graph.getCellById?.(selectedNodeId)
      if (node?.isNode?.()) {
        setSelectedNodeRect(getGraphCellRect(session.graph, node))
      } else {
        setSelectedNodeRect(null)
      }
    } else {
      setSelectedNodeRect(null)
    }

    if (selectedEdgeId && edgeEditing) {
      const edge = session.graph.getCellById?.(selectedEdgeId)
      if (edge?.isEdge?.()) {
        setEdgeToolbarRect(getGraphCellRect(session.graph, edge))
      } else {
        setEdgeToolbarRect(null)
      }
    } else {
      setEdgeToolbarRect(null)
    }
  }, [edgeEditing, selectedEdgeId, selectedNodeId, session])

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
    })()

    return () => {
      disposed = true
      currentSession?.dispose()
    }
  }, [graphData, height, isDark, mounted, width])

  useEffect(() => {
    if (!session) return
    setCanvasGraphTheme(session.graph, isDark)
    refreshFloatingUi()
  }, [isDark, refreshFloatingUi, session])

  useEffect(() => {
    rootRef.current?.focus()
  }, [mounted])

  useEffect(() => {
    if (!session) return

    const graph = session.graph
    const selection = session.selection

    const syncSelectionState = () => {
      const selectedCells = selection.getSelectedCells?.() ?? []
      const selectedNode = selectedCells.length === 1
        ? selectedCells.find((cell: any) => cell?.isNode?.()) ?? null
        : null
      setSelectedNodeId(selectedNode?.id ?? null)
      if (!selectedNode) {
        setEditingNodeId(null)
      }
      if (selectedCells.length > 1) {
        setSelectedEdgeId(null)
        setEdgeEditing(false)
        setEdgeToolbarRect(null)
      }
      refreshFloatingUi()
    }

    const handleScale = () => {
      setZoomLevel(Number(graph.zoom?.() ?? 1))
      refreshFloatingUi()
    }

    const handleHistoryChange = () => {
      setHistoryState({
        canUndo: Boolean(session.history.canUndo?.()),
        canRedo: Boolean(session.history.canRedo?.()),
      })
    }

    const handleEdgeClick = ({ edge, e }: any) => {
      e?.stopPropagation?.()
      const edgeId = String(edge?.id ?? '')
      setEditingNodeId(null)
      setSelectedNodeId(null)
      setSelectedNodeRect(null)
      setSelectedEdgeId(edgeId)
      setEdgeEditing(false)
      setEdgeLabelDraft(getCanvasEdgeLabel(edge))
      setEdgeToolbarRect(null)
      refreshFloatingUi()
    }

    const handleEdgeContextMenu = ({ edge, e }: any) => {
      e?.preventDefault?.()
      e?.stopPropagation?.()
      const edgeId = String(edge?.id ?? '')
      setSelectedEdgeId(edgeId)
      setEdgeEditing(true)
      setEdgeLabelDraft(getCanvasEdgeLabel(edge))
      requestAnimationFrame(() => refreshFloatingUi())
    }

    const handleBlankClick = () => {
      if (editingNodeId) {
        const node = session.graph.getCellById?.(editingNodeId)
        if (node?.isNode?.()) {
          setCanvasNodeLabel(node, nodeLabelDraft.trim(), isDark)
        }
      }
      setSelectedEdgeId(null)
      setEdgeEditing(false)
      setEditingNodeId(null)
      setEdgeToolbarRect(null)
      setSelectionToolbarRect(null)
    }

    const handleNodeDblClick = ({ node, e }: any) => {
      e?.stopPropagation?.()
      setSelectedEdgeId(null)
      setEdgeEditing(false)
      setSelectedNodeId(String(node?.id ?? ''))
      setEditingNodeId(String(node?.id ?? ''))
      setNodeLabelDraft(getCanvasNodeLabel(node))
      requestAnimationFrame(() => refreshFloatingUi())
    }

    const handleEdgeRemoved = () => {
      setSelectedEdgeId(null)
      setEdgeEditing(false)
      setEdgeToolbarRect(null)
      setEdgeLabelDraft('')
    }

    graph.on('scale', handleScale)
    graph.on('translate', refreshFloatingUi)
    graph.on('node:change:position', refreshFloatingUi)
    graph.on('node:change:size', refreshFloatingUi)
    graph.on('edge:change:labels', refreshFloatingUi)
    graph.on('edge:change:vertices', refreshFloatingUi)
    graph.on('edge:click', handleEdgeClick)
    graph.on('edge:contextmenu', handleEdgeContextMenu)
    graph.on('node:dblclick', handleNodeDblClick)
    graph.on('blank:click', handleBlankClick)
    graph.on('edge:removed', handleEdgeRemoved)

    selection.on('selection:changed', syncSelectionState)
    session.history.on('change', handleHistoryChange)

    syncSelectionState()
    handleHistoryChange()

    return () => {
      graph.off('scale', handleScale)
      graph.off('translate', refreshFloatingUi)
      graph.off('node:change:position', refreshFloatingUi)
      graph.off('node:change:size', refreshFloatingUi)
      graph.off('edge:change:labels', refreshFloatingUi)
      graph.off('edge:change:vertices', refreshFloatingUi)
      graph.off('edge:click', handleEdgeClick)
      graph.off('edge:contextmenu', handleEdgeContextMenu)
      graph.off('node:dblclick', handleNodeDblClick)
      graph.off('blank:click', handleBlankClick)
      graph.off('edge:removed', handleEdgeRemoved)
      selection.off('selection:changed', syncSelectionState)
      session.history.off('change', handleHistoryChange)
    }
  }, [refreshFloatingUi, session])

  const handleResizeMove = useCallback((event: PointerEvent) => {
    if (!resizeRef.current || !session) return

    const state = resizeRef.current
    const node = session.graph.getCellById?.(state.nodeId)
    if (!node?.isNode?.()) return

    const zoom = Number(session.graph.zoom?.() ?? 1) || 1
    let nextWidth = state.startWidth + (event.clientX - state.startClientX) / zoom
    let nextHeight = state.startHeight + (event.clientY - state.startClientY) / zoom

    if (state.keepAspect) {
      const basedOnWidth = nextWidth / state.aspectRatio
      const basedOnHeight = nextHeight * state.aspectRatio
      if (Math.abs(nextWidth - state.startWidth) >= Math.abs(nextHeight - state.startHeight)) {
        nextHeight = basedOnWidth
      } else {
        nextWidth = basedOnHeight
      }
    }

    nextWidth = Math.round(clamp(nextWidth, state.minWidth, 720))
    nextHeight = Math.round(clamp(nextHeight, state.minHeight, 480))
    node.resize(nextWidth, nextHeight)
    refreshFloatingUi()
  }, [refreshFloatingUi, session])

  const handleResizeEnd = useCallback(() => {
    resizeRef.current = null
    window.removeEventListener('pointermove', handleResizeMove)
    window.removeEventListener('pointerup', handleResizeEnd)
  }, [handleResizeMove])

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleResizeMove)
      window.removeEventListener('pointerup', handleResizeEnd)
    }
  }, [handleResizeEnd, handleResizeMove])

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!session || !selectedNodeId) return

    event.preventDefault()
    event.stopPropagation()

    const node = session.graph.getCellById?.(selectedNodeId)
    if (!node?.isNode?.()) return

    const size = node.getSize?.() ?? { width: 148, height: 88 }
    const data = node.getData?.() ?? {}

    resizeRef.current = {
      nodeId: selectedNodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: Number(size.width ?? 148),
      startHeight: Number(size.height ?? 88),
      minWidth: Number(data.minWidth ?? 72),
      minHeight: Number(data.minHeight ?? 56),
      keepAspect: Boolean(data.keepAspect),
      aspectRatio: Math.max(Number(size.width ?? 148) / Math.max(Number(size.height ?? 88), 1), 0.4),
    }

    window.addEventListener('pointermove', handleResizeMove)
    window.addEventListener('pointerup', handleResizeEnd)
  }, [handleResizeEnd, handleResizeMove, selectedNodeId, session])

  const insertPresetAtCenter = useCallback((presetId: string) => {
    if (!session || !graphHostRef.current) return

    const rect = graphHostRef.current.getBoundingClientRect()
    const point = session.graph.clientToLocal({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    })

    const node = insertCanvasPresetNode({
      graph: session.graph,
      presetId,
      point,
      isDark,
    })

    if (node) {
      session.selection.reset?.([node])
      setSelectedNodeId(String(node.id))
      setEditingNodeId(null)
      requestAnimationFrame(() => refreshFloatingUi())
    }
  }, [isDark, refreshFloatingUi, session])

  const handleDropPreset = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDropActive(false)
    if (!session) return

    const presetId = event.dataTransfer.getData(CANVAS_DRAG_MIME)
    if (!presetId) return

    const point = session.graph.clientToLocal({
      x: event.clientX,
      y: event.clientY,
    })

    const node = insertCanvasPresetNode({
      graph: session.graph,
      presetId,
      point,
      isDark,
    })

    if (node) {
      session.selection.reset?.([node])
      setSelectedNodeId(String(node.id))
      requestAnimationFrame(() => refreshFloatingUi())
    }
  }, [isDark, refreshFloatingUi, session])

  const handleExportPng = async () => {
    if (!session) return

    try {
      const dataUrl = await exportGraphDataUrl({
        graph: session.graph,
        format: 'png',
        isDark,
        maxWidth: 1800,
        maxHeight: 1400,
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = 'paperspark-canvas.png'
      link.click()
    } catch (error) {
      addToast({ title: `导出 PNG 失败：${error instanceof Error ? error.message : '未知错误'}`, color: 'danger' })
    }
  }

  const handleSaveNodeLabel = useCallback(() => {
    if (!session || !editingNodeId) return
    const node = session.graph.getCellById?.(editingNodeId)
    if (!node?.isNode?.()) return

    setCanvasNodeLabel(node, nodeLabelDraft.trim(), isDark)
    setEditingNodeId(null)
    refreshFloatingUi()
  }, [editingNodeId, isDark, nodeLabelDraft, refreshFloatingUi, session])

  const handleEditorPointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editingNodeId) return

    const target = event.target as Node | null
    if (target && nodeEditorRef.current?.contains(target)) {
      return
    }

    handleSaveNodeLabel()
  }, [editingNodeId, handleSaveNodeLabel])

  const handleDeleteSelection = useCallback(() => {
    if (!session) return
    const selectedCells = session.selection.getSelectedCells?.() ?? []
    if (selectedCells.length === 0) return

    session.graph.removeCells?.(selectedCells)
    session.selection.clean?.()
    setSelectionToolbarRect(null)
    setSelectionCount(0)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
  }, [session])

  const handleSaveEdgeLabel = useCallback(() => {
    if (!session || !selectedEdgeId) return
    const edge = session.graph.getCellById?.(selectedEdgeId)
    if (!edge?.isEdge?.()) return

    setCanvasEdgeLabel(edge, edgeLabelDraft, isDark)
    refreshFloatingUi()
  }, [edgeLabelDraft, isDark, refreshFloatingUi, selectedEdgeId, session])

  const handleDeleteEdge = useCallback(() => {
    if (!session || !selectedEdgeId) return
    const edge = session.graph.getCellById?.(selectedEdgeId)
    if (!edge?.isEdge?.()) return

    edge.remove?.()
    setSelectedEdgeId(null)
    setEdgeEditing(false)
    setEdgeToolbarRect(null)
    setEdgeLabelDraft('')
  }, [selectedEdgeId, session])

  const handleClose = async () => {
    if (!session || saving) {
      setClosing(true)
      return
    }

    setSaving(true)
    try {
      const cells = session.graph.getCells?.() ?? []
      const hasContent = cells.length > 0
      const nextGraphData = hasContent ? JSON.stringify(session.graph.toJSON?.() ?? {}) : ''
      let nextPreviewDataUrl = hasContent ? String(previewDataUrl ?? '') : ''

      if (hasContent) {
        try {
          nextPreviewDataUrl = await Promise.race([
            exportGraphDataUrl({
              graph: session.graph,
              format: 'jpeg',
              isDark,
              maxWidth: 1200,
              maxHeight: 900,
              quality: 0.88,
            }),
            new Promise<string>((_, reject) => {
              window.setTimeout(() => reject(new Error('缩略图生成超时')), 4000)
            }),
          ])
        } catch (error) {
          addToast({ title: `缩略图更新失败，已保留现有预览：${error instanceof Error ? error.message : '未知错误'}`, color: 'warning' })
        }
      }

      onSave({
        ...getCanvasBlockDefaults(),
        graphData: nextGraphData,
        previewDataUrl: nextPreviewDataUrl,
        width: width ?? getCanvasBlockDefaults().width,
        height: height ?? getCanvasBlockDefaults().height,
      })

      setClosing(true)
    } catch (error) {
      addToast({ title: `保存画板失败：${error instanceof Error ? error.message : '未知错误'}`, color: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  if (!mounted) return null

  const nodeHintVisible = Boolean(
    selectedNodeRect &&
    selectedNodeId &&
    !editingNodeId &&
    session?.graph.getCellById?.(selectedNodeId)?.isNode?.() &&
    !getCanvasNodeLabel(session.graph.getCellById(selectedNodeId)).trim(),
  )

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerDownCapture={handleEditorPointerDownCapture}
      onKeyDownCapture={(event) => {
        event.stopPropagation()
        const target = event.target as HTMLElement | null
        const isInputTarget = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))

        // 拦截撤回/重做快捷键
        if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'y' || event.key === 'Z')) {
          event.preventDefault()
          if (event.key === 'z' || event.key === 'Z') {
            if (event.shiftKey) {
              session?.history.redo?.()
            } else {
              session?.history.undo?.()
            }
          } else if (event.key === 'y') {
            session?.history.redo?.()
          }
          return
        }

        if (event.key === 'Escape' && !isInputTarget) {
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
          background: isDark ? 'rgba(2, 6, 23, 0.7)' : 'rgba(15, 23, 42, 0.18)',
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
            height: 52,
            padding: '0 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.18)'}`,
            background: isDark ? 'rgba(2, 6, 23, 0.96)' : 'rgba(255, 255, 255, 0.96)',
            position: 'relative',
            zIndex: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button
              color="primary"
              variant="flat"
              onPress={() => void handleClose()}
              isLoading={saving}
              startContent={!saving ? <Icon icon="mdi:close" width={18} /> : undefined}
            >
              {saving ? '保存中' : '关闭'}
            </Button>
            <ToolbarButton icon="mdi:undo" label="撤销" onPress={() => session?.history.undo?.()} disabled={!historyState.canUndo} />
            <ToolbarButton icon="mdi:redo" label="重做" onPress={() => session?.history.redo?.()} disabled={!historyState.canRedo} />
            <ToolbarButton
              icon="mdi:magnify-minus-outline"
              label="缩小"
              onPress={() => {
                session?.graph.zoom?.(-0.1)
                setZoomLevel(Number(session?.graph.zoom?.() ?? zoomLevel))
              }}
            />
            <Chip size="sm" variant="flat">{Math.round(zoomLevel * 100)}%</Chip>
            <ToolbarButton
              icon="mdi:magnify-plus-outline"
              label="放大"
              onPress={() => {
                session?.graph.zoom?.(0.1)
                setZoomLevel(Number(session?.graph.zoom?.() ?? zoomLevel))
              }}
            />
            <ToolbarButton
              icon="mdi:fit-to-page-outline"
              label="适配画布"
              onPress={() => {
                session?.graph.zoomToFit?.({ padding: 48, maxScale: 1.15 })
                setZoomLevel(Number(session?.graph.zoom?.() ?? zoomLevel))
              }}
            />
            <ToolbarButton icon="mdi:image-outline" label="导出 PNG" onPress={() => void handleExportPng()} />
          </div>

          <Chip variant="flat" color="secondary">论文画板</Chip>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <CanvasStencil
            groups={presetGroups}
            collapsed={stencilCollapsed}
            isDark={isDark}
            onToggle={() => setStencilCollapsed((value) => !value)}
            onInsert={insertPresetAtCenter}
          />

          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDropActive(true)
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={handleDropPreset}
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
                outline: dropActive ? `2px dashed ${isDark ? '#60a5fa' : '#2563eb'}` : 'none',
                outlineOffset: -12,
                borderRadius: 20,
              }}
            />
          </div>
        </div>
      </motion.div>

      {edgeToolbarRect && selectedEdgeId && !closing ? (
        <Card
          shadow="lg"
          style={{
            position: 'fixed',
            left: edgeToolbarRect.left + edgeToolbarRect.width / 2,
            top: Math.max(68, edgeToolbarRect.top - 18),
            transform: 'translate(-50%, -100%)',
            zIndex: 10020,
            minWidth: 260,
            background: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
            border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.18)'}`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CardBody style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700 }}>箭头工具</span>
              <Button isIconOnly size="sm" color="danger" variant="light" onPress={handleDeleteEdge} aria-label="删除箭头">
                <Icon icon="mdi:delete-outline" width={18} />
              </Button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Input
                size="sm"
                variant="bordered"
                placeholder="输入箭头说明文字"
                value={edgeLabelDraft}
                onValueChange={setEdgeLabelDraft}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') {
                    handleSaveEdgeLabel()
                  }
                }}
              />
              <Button size="sm" color="primary" onPress={handleSaveEdgeLabel}>
                应用
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {selectionToolbarRect && selectionCount > 1 && !editingNodeId && !selectedEdgeId && !closing ? (
        <Card
          shadow="lg"
          style={{
            position: 'fixed',
            left: selectionToolbarRect.left + selectionToolbarRect.width / 2,
            top: Math.max(68, selectionToolbarRect.top - 14),
            transform: 'translate(-50%, -100%)',
            zIndex: 10020,
            background: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
            border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.18)'}`,
          }}
        >
          <CardBody style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Chip size="sm" variant="flat">{selectionCount} 项</Chip>
            <Button isIconOnly size="sm" color="danger" variant="flat" onPress={handleDeleteSelection} aria-label="删除所选元素">
              <Icon icon="mdi:delete-outline" width={18} />
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {selectedNodeRect && editingNodeId && !closing ? (
        <div
          ref={nodeEditorRef}
          style={{
            position: 'fixed',
            left: selectedNodeRect.left + selectedNodeRect.width / 2,
            top: selectedNodeRect.top + selectedNodeRect.height / 2,
            transform: 'translate(-50%, -50%)',
            zIndex: 10020,
            width: Math.max(120, Math.min(260, selectedNodeRect.width - 12 || 120)),
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Input
            autoFocus
            size="sm"
            variant="flat"
            placeholder="输入文字"
            value={nodeLabelDraft}
            onValueChange={setNodeLabelDraft}
            onBlur={handleSaveNodeLabel}
            style={{
              background: isDark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)',
              borderRadius: 12,
            }}
            classNames={{
              input: 'text-center font-semibold',
              inputWrapper: 'shadow-lg',
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') {
                handleSaveNodeLabel()
              }
              if (event.key === 'Escape') {
                setEditingNodeId(null)
              }
            }}
          />
        </div>
      ) : null}

      {selectedNodeRect && selectedNodeId && selectionCount <= 1 && !editingNodeId && !closing ? (
        <button
          type="button"
          aria-label="调整节点大小"
          onPointerDown={handleResizeStart}
          style={{
            position: 'fixed',
            left: selectedNodeRect.left + selectedNodeRect.width - 8,
            top: selectedNodeRect.top + selectedNodeRect.height - 8,
            width: 18,
            height: 18,
            borderRadius: 999,
            border: '2px solid white',
            background: isDark ? '#60a5fa' : '#2563eb',
            boxShadow: '0 6px 18px rgba(37, 99, 235, 0.28)',
            cursor: 'nwse-resize',
            zIndex: 10010,
          }}
        />
      ) : null}

      {nodeHintVisible && selectedNodeRect && selectionCount <= 1 ? (
        <div
          style={{
            position: 'fixed',
            left: selectedNodeRect.left + selectedNodeRect.width / 2,
            top: selectedNodeRect.top + selectedNodeRect.height + 18,
            transform: 'translateX(-50%)',
            zIndex: 10020,
            pointerEvents: 'none',
          }}
        >
          <Chip size="sm" variant="flat">双击编辑文字</Chip>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
