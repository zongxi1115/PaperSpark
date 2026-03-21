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
  getCanvasEdgeColor,
  getCanvasEdgeLabel,
  getCanvasNodeLabel,
  getCanvasPresetGroups,
  getViewportRect,
  hideAllNodePorts,
  insertCanvasImageNode,
  insertCanvasPresetNode,
  readEdgeStyle,
  applyEdgeStyle,
  readNodeStyle,
  applyNodeStyle,
  setCanvasEdgeLabel,
  setCanvasGraphTheme,
  setCanvasNodeLabel,
  showAllNodePorts,
  type CanvasBlockProps,
  type CanvasGraphSession,
  type CanvasOriginRect,
  type EdgeStyleState,
  type EdgeLineStyle,
  type EdgeArrowDir,
  type EdgeStrokeType,
  type NodeStyleState,
  type NodeBorderStyle,
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
  const imageInputRef = useRef<HTMLInputElement | null>(null)
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
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyleState>({
    strokeType: 'solid',
    arrowDir: 'forward',
    lineStyle: 'curve',
    strokeWidth: 2,
    color: '#64748b',
  })
  const [nodeStyle, setNodeStyle] = useState<NodeStyleState | null>(null)
  const [nodeToolbarVisible, setNodeToolbarVisible] = useState(false)

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

      if (selectedNode?.isNode?.()) {
        const style = readNodeStyle(selectedNode)
        setNodeStyle(style)
        setNodeToolbarVisible(true)
      } else {
        setNodeStyle(null)
        setNodeToolbarVisible(false)
      }

      if (!selectedNode) {
        setEditingNodeId(null)
      }
      if (selectedCells.length > 1) {
        setSelectedEdgeId(null)
        setEdgeEditing(false)
        setEdgeToolbarRect(null)
        setNodeToolbarVisible(false)
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

      // Reset previous selected edge style
      if (selectedEdgeId && selectedEdgeId !== edgeId) {
        const prevEdge = session.graph.getCellById?.(selectedEdgeId)
        if (prevEdge?.isEdge?.()) {
          prevEdge.setAttrByPath('line/stroke', edgeStyle.color)
          prevEdge.setAttrByPath('line/strokeWidth', edgeStyle.strokeWidth)
        }
      }

      setEditingNodeId(null)
      setSelectedNodeId(null)
      setSelectedNodeRect(null)
      setSelectedEdgeId(edgeId)
      setEdgeLabelDraft(getCanvasEdgeLabel(edge))

      if (edge?.isEdge?.()) {
        // Read current edge style
        const style = readEdgeStyle(edge, isDark)
        setEdgeStyle(style)

        // Apply selected visual
        edge.setAttrByPath('line/stroke', style.color !== getCanvasEdgeColor(isDark) ? style.color : '#3b82f6')
        edge.setAttrByPath('line/strokeWidth', Math.max(style.strokeWidth, 3))
      }

      // Show toolbar immediately
      setEdgeEditing(true)

      // Show all node ports as potential targets
      if (session) {
        showAllNodePorts(session.graph)
      }

      requestAnimationFrame(() => refreshFloatingUi())
    }

    const handleBlankClick = () => {
      if (editingNodeId) {
        const node = session.graph.getCellById?.(editingNodeId)
        if (node?.isNode?.()) {
          setCanvasNodeLabel(node, nodeLabelDraft.trim(), isDark)
        }
      }

      // Reset edge styling when deselecting
      if (selectedEdgeId) {
        const edge = session.graph.getCellById?.(selectedEdgeId)
        if (edge?.isEdge?.()) {
          const style = readEdgeStyle(edge, isDark)
          edge.setAttrByPath('line/stroke', style.color)
          edge.setAttrByPath('line/strokeWidth', style.strokeWidth)
        }
      }

      // Hide all ports
      if (session) {
        hideAllNodePorts(session.graph)
      }

      setSelectedEdgeId(null)
      setEdgeEditing(false)
      setEditingNodeId(null)
      setEdgeToolbarRect(null)
      setSelectionToolbarRect(null)
      setNodeToolbarVisible(false)
      setNodeStyle(null)
    }

    const handleNodeDblClick = ({ node, e }: any) => {
      e?.stopPropagation?.()
      setSelectedEdgeId(null)
      setEdgeEditing(false)
      setSelectedNodeId(String(node?.id ?? ''))
      setEditingNodeId(String(node?.id ?? ''))
      setNodeLabelDraft(getCanvasNodeLabel(node))
      setNodeToolbarVisible(false)
      requestAnimationFrame(() => refreshFloatingUi())
    }

    const handleEdgeRemoved = () => {
      setSelectedEdgeId(null)
      setEdgeEditing(false)
      setEdgeToolbarRect(null)
      setEdgeLabelDraft('')
      if (session) {
        hideAllNodePorts(session.graph)
      }
    }

    const handleEdgeMouseEnter = ({ edge }: any) => {
      if (!edge?.isEdge?.()) return
      edge.setAttrByPath('line/strokeWidth', 3)
      edge.setAttrByPath('line/cursor', 'grab')
    }

    const handleEdgeMouseLeave = ({ edge }: any) => {
      if (!edge?.isEdge?.()) return
      const isSelected = edge.id === selectedEdgeId
      edge.setAttrByPath('line/strokeWidth', isSelected ? 3 : 2)
      edge.setAttrByPath('line/cursor', 'default')
    }

    const handleEdgeConnected = ({ edge }: any) => {
      if (!edge?.isEdge?.()) return
      edge.setAttrByPath('line/strokeDasharray', '')
    }

    graph.on('scale', handleScale)
    graph.on('translate', refreshFloatingUi)
    graph.on('node:change:position', refreshFloatingUi)
    graph.on('node:change:size', refreshFloatingUi)
    graph.on('edge:change:labels', refreshFloatingUi)
    graph.on('edge:change:vertices', refreshFloatingUi)
    graph.on('edge:click', handleEdgeClick)
    graph.on('edge:mouseenter', handleEdgeMouseEnter)
    graph.on('edge:mouseleave', handleEdgeMouseLeave)
    graph.on('edge:connected', handleEdgeConnected)
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
      graph.off('edge:mouseenter', handleEdgeMouseEnter)
      graph.off('edge:mouseleave', handleEdgeMouseLeave)
      graph.off('edge:connected', handleEdgeConnected)
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

    // Check for image file drop
    const files = event.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = async () => {
          const dataUri = String(reader.result ?? '')
          if (!dataUri) return

          const point = session.graph.clientToLocal({
            x: event.clientX,
            y: event.clientY,
          })

          const node = await insertCanvasImageNode({
            graph: session.graph,
            dataUri,
            point,
            isDark,
          })

          if (node) {
            session.selection.reset?.([node])
            setSelectedNodeId(String(node.id))
            requestAnimationFrame(() => refreshFloatingUi())
          }
        }
        reader.readAsDataURL(file)
        return
      }
    }

    // Handle preset drag-and-drop
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

  const handleImageUpload = useCallback(() => {
    imageInputRef.current?.click()
  }, [])

  const handleImageFile = useCallback(async (file: File) => {
    if (!session || !graphHostRef.current) return
    if (!file.type.startsWith('image/')) {
      addToast({ title: '请选择图片文件', color: 'warning' })
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      const dataUri = String(reader.result ?? '')
      if (!dataUri) return

      const rect = graphHostRef.current!.getBoundingClientRect()
      const point = session.graph.clientToLocal({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })

      const node = await insertCanvasImageNode({
        graph: session.graph,
        dataUri,
        point,
        isDark,
      })

      if (node) {
        session.selection.reset?.([node])
        setSelectedNodeId(String(node.id))
        requestAnimationFrame(() => refreshFloatingUi())
      }
    }
    reader.readAsDataURL(file)
  }, [isDark, refreshFloatingUi, session])

  const handleImageInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      void handleImageFile(file)
    }
    // Reset input so the same file can be selected again
    event.target.value = ''
  }, [handleImageFile])

  const handleSaveNodeLabel = useCallback(() => {
    if (!session || !editingNodeId) return
    const node = session.graph.getCellById?.(editingNodeId)
    if (!node?.isNode?.()) return

    setCanvasNodeLabel(node, nodeLabelDraft.trim(), isDark)
    setEditingNodeId(null)

    // Re-read style and show toolbar
    const style = readNodeStyle(node)
    setNodeStyle(style)
    setNodeToolbarVisible(true)

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
    if (session) hideAllNodePorts(session.graph)
  }, [selectedEdgeId, session])

  const handleEdgeStyleChange = useCallback((patch: Partial<EdgeStyleState>) => {
    if (!session || !selectedEdgeId) return
    const edge = session.graph.getCellById?.(selectedEdgeId)
    if (!edge?.isEdge?.()) return

    const nextStyle: EdgeStyleState = { ...edgeStyle, ...patch }
    setEdgeStyle(nextStyle)
    applyEdgeStyle(edge, nextStyle, isDark)

    // Keep selection highlight color
    const displayColor = nextStyle.color === getCanvasEdgeColor(isDark) ? '#3b82f6' : nextStyle.color
    edge.setAttrByPath('line/stroke', displayColor)
    edge.setAttrByPath('line/strokeWidth', Math.max(nextStyle.strokeWidth, 3))

    refreshFloatingUi()
  }, [edgeStyle, isDark, refreshFloatingUi, selectedEdgeId, session])

  const handleNodeStyleChange = useCallback((patch: Partial<NodeStyleState>) => {
    if (!session || !selectedNodeId || !nodeStyle) return
    const node = session.graph.getCellById?.(selectedNodeId)
    if (!node?.isNode?.()) return

    const nextStyle: NodeStyleState = { ...nodeStyle, ...patch }
    setNodeStyle(nextStyle)
    applyNodeStyle(node, nextStyle, isDark)
    refreshFloatingUi()
  }, [nodeStyle, isDark, refreshFloatingUi, selectedNodeId, session])

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
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageInputChange}
        style={{ display: 'none' }}
      />
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
            <ToolbarButton icon="mdi:image-plus-outline" label="上传图片" onPress={handleImageUpload} />
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

      {edgeToolbarRect && selectedEdgeId && edgeEditing && !closing ? (
        <Card
          shadow="lg"
          style={{
            position: 'fixed',
            left: edgeToolbarRect.left + edgeToolbarRect.width / 2,
            top: Math.max(68, edgeToolbarRect.top - 18),
            transform: 'translate(-50%, -100%)',
            zIndex: 10020,
            background: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
            border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.18)'}`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CardBody style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Row 1: stroke type + arrow direction */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {([
                  { type: 'solid' as EdgeStrokeType, icon: 'mdi:minus', label: '实线' },
                  { type: 'dashed' as EdgeStrokeType, icon: 'mdi:dots-horizontal', label: '虚线' },
                  { type: 'dotted' as EdgeStrokeType, icon: 'mdi:dots-horizontal', label: '点线' },
                ]).map((opt) => (
                  <Tooltip key={opt.type} content={opt.label} placement="top">
                    <Button
                      isIconOnly
                      size="sm"
                      variant={edgeStyle.strokeType === opt.type ? 'solid' : 'flat'}
                      color={edgeStyle.strokeType === opt.type ? 'primary' : 'default'}
                      onPress={() => handleEdgeStyleChange({ strokeType: opt.type })}
                      aria-label={opt.label}
                    >
                      <Icon icon={opt.icon} width={16} />
                    </Button>
                  </Tooltip>
                ))}
              </div>

              <div style={{ width: 1, height: 20, background: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.24)' }} />

              <div style={{ display: 'flex', gap: 2 }}>
                {([
                  { dir: 'forward' as EdgeArrowDir, icon: 'mdi:arrow-right', label: '单向箭头' },
                  { dir: 'bidirectional' as EdgeArrowDir, icon: 'mdi:swap-horizontal', label: '双向箭头' },
                  { dir: 'none' as EdgeArrowDir, icon: 'mdi:minus', label: '无箭头' },
                ]).map((opt) => (
                  <Tooltip key={opt.dir} content={opt.label} placement="top">
                    <Button
                      isIconOnly
                      size="sm"
                      variant={edgeStyle.arrowDir === opt.dir ? 'solid' : 'flat'}
                      color={edgeStyle.arrowDir === opt.dir ? 'primary' : 'default'}
                      onPress={() => handleEdgeStyleChange({ arrowDir: opt.dir })}
                      aria-label={opt.label}
                    >
                      <Icon icon={opt.icon} width={16} />
                    </Button>
                  </Tooltip>
                ))}
              </div>

              <div style={{ width: 1, height: 20, background: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.24)' }} />

              <Tooltip content="删除连线" placement="top">
                <Button isIconOnly size="sm" color="danger" variant="light" onPress={handleDeleteEdge} aria-label="删除连线">
                  <Icon icon="mdi:delete-outline" width={16} />
                </Button>
              </Tooltip>
            </div>

            {/* Row 2: line style + stroke width */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {([
                  { ls: 'straight' as EdgeLineStyle, icon: 'mdi:ray-start-end', label: '直线' },
                  { ls: 'curve' as EdgeLineStyle, icon: 'mdi:sine-wave', label: '曲线' },
                  { ls: 'polyline' as EdgeLineStyle, icon: 'mdi:vector-polyline', label: '折线' },
                  { ls: 'elbow' as EdgeLineStyle, icon: 'mdi:arrow-top-right-bottom-left', label: '折角线' },
                ]).map((opt) => (
                  <Tooltip key={opt.ls} content={opt.label} placement="top">
                    <Button
                      isIconOnly
                      size="sm"
                      variant={edgeStyle.lineStyle === opt.ls ? 'solid' : 'flat'}
                      color={edgeStyle.lineStyle === opt.ls ? 'primary' : 'default'}
                      onPress={() => handleEdgeStyleChange({ lineStyle: opt.ls })}
                      aria-label={opt.label}
                    >
                      <Icon icon={opt.icon} width={16} />
                    </Button>
                  </Tooltip>
                ))}
              </div>

              <div style={{ width: 1, height: 20, background: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.24)' }} />

              <div style={{ display: 'flex', gap: 2 }}>
                {[1, 2, 3, 4].map((w) => (
                  <Tooltip key={w} content={`${w}px 粗细`} placement="top">
                    <Button
                      isIconOnly
                      size="sm"
                      variant={edgeStyle.strokeWidth === w ? 'solid' : 'flat'}
                      color={edgeStyle.strokeWidth === w ? 'primary' : 'default'}
                      onPress={() => handleEdgeStyleChange({ strokeWidth: w })}
                      aria-label={`${w}px`}
                    >
                      <div style={{ width: Math.min(w * 5, 18), height: Math.min(w * 2, 6), borderRadius: 3, background: 'currentColor' }} />
                    </Button>
                  </Tooltip>
                ))}
              </div>

              <div style={{ width: 1, height: 20, background: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.24)' }} />

              <div style={{ display: 'flex', gap: 2 }}>
                {['#64748b', '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6'].map((c) => (
                  <Tooltip key={c} content={c} placement="top">
                    <button
                      type="button"
                      onClick={() => handleEdgeStyleChange({ color: c })}
                      aria-label={c}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        background: c,
                        border: edgeStyle.color === c
                          ? `2px solid ${isDark ? '#e2e8f0' : '#1e293b'}`
                          : `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.3)'}`,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  </Tooltip>
                ))}
              </div>
            </div>

            {/* Row 3: label input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Input
                size="sm"
                variant="bordered"
                placeholder="输入连线说明文字"
                value={edgeLabelDraft}
                onValueChange={setEdgeLabelDraft}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key === 'Enter') handleSaveEdgeLabel()
                }}
                style={{ flex: 1 }}
              />
              <Button size="sm" color="primary" variant="flat" onPress={handleSaveEdgeLabel}>
                应用
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {selectedNodeRect && selectedNodeId && nodeToolbarVisible && nodeStyle && !editingNodeId && !selectedEdgeId && selectionCount <= 1 && !closing ? (
        <Card
          shadow="lg"
          style={{
            position: 'fixed',
            left: selectedNodeRect.left + selectedNodeRect.width / 2,
            top: Math.max(68, selectedNodeRect.top - 14),
            transform: 'translate(-50%, -100%)',
            zIndex: 10020,
            background: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
            border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.18)'}`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CardBody style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Row 1: color + border width + border style + delete */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {['#4f46e5', '#7c3aed', '#0891b2', '#059669', '#f59e0b', '#ef4444', '#ec4899', '#64748b'].map((c) => (
                  <Tooltip key={c} content={c} placement="top">
                    <button
                      type="button"
                      onClick={() => handleNodeStyleChange({ color: c })}
                      aria-label={c}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        background: c,
                        border: nodeStyle.color === c
                          ? `2px solid ${isDark ? '#e2e8f0' : '#1e293b'}`
                          : `1px solid ${isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.3)'}`,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  </Tooltip>
                ))}
              </div>

              <div style={{ width: 1, height: 20, background: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.24)' }} />

              <Tooltip content="删除形状" placement="top">
                <Button isIconOnly size="sm" color="danger" variant="light" onPress={() => handleDeleteSelection()} aria-label="删除形状">
                  <Icon icon="mdi:delete-outline" width={16} />
                </Button>
              </Tooltip>
            </div>

            {/* Row 2: border width + border style */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1, 2, 3, 4].map((w) => (
                  <Tooltip key={w} content={`${w}px 边框`} placement="top">
                    <Button
                      isIconOnly
                      size="sm"
                      variant={nodeStyle.borderWidth === w ? 'solid' : 'flat'}
                      color={nodeStyle.borderWidth === w ? 'primary' : 'default'}
                      onPress={() => handleNodeStyleChange({ borderWidth: w })}
                      aria-label={`${w}px`}
                    >
                      <div style={{ width: Math.min(w * 5, 18), height: Math.min(w * 2, 6), borderRadius: 3, background: 'currentColor' }} />
                    </Button>
                  </Tooltip>
                ))}
              </div>

              <div style={{ width: 1, height: 20, background: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.24)' }} />

              <div style={{ display: 'flex', gap: 2 }}>
                {([
                  { bs: 'solid' as NodeBorderStyle, icon: 'mdi:minus', label: '实线边框' },
                  { bs: 'dashed' as NodeBorderStyle, icon: 'mdi:dots-horizontal', label: '虚线边框' },
                  { bs: 'dotted' as NodeBorderStyle, icon: 'mdi:dots-horizontal', label: '点线边框' },
                ]).map((opt) => (
                  <Tooltip key={opt.bs} content={opt.label} placement="top">
                    <Button
                      isIconOnly
                      size="sm"
                      variant={nodeStyle.borderStyle === opt.bs ? 'solid' : 'flat'}
                      color={nodeStyle.borderStyle === opt.bs ? 'primary' : 'default'}
                      onPress={() => handleNodeStyleChange({ borderStyle: opt.bs })}
                      aria-label={opt.label}
                    >
                      <Icon icon={opt.icon} width={16} />
                    </Button>
                  </Tooltip>
                ))}
              </div>

              {(['rectangle', 'rounded', 'comparison', 'multiDocument', 'image', 'text'].includes(nodeStyle.variant)) ? (
                <>
                  <div style={{ width: 1, height: 20, background: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.24)' }} />
                  <div style={{ display: 'flex', gap: 2 }}>
                    {([0, 8, 18, 28]).map((r) => (
                      <Tooltip key={r} content={`圆角 ${r}px`} placement="top">
                        <Button
                          isIconOnly
                          size="sm"
                          variant={nodeStyle.borderRadius === r ? 'solid' : 'flat'}
                          color={nodeStyle.borderRadius === r ? 'primary' : 'default'}
                          onPress={() => handleNodeStyleChange({ borderRadius: r })}
                          aria-label={`圆角${r}`}
                        >
                          <div style={{
                            width: 14,
                            height: 14,
                            border: '2px solid currentColor',
                            borderRadius: r === 0 ? 1 : r <= 8 ? 4 : r <= 18 ? 7 : 10,
                            background: 'transparent',
                          }} />
                        </Button>
                      </Tooltip>
                    ))}
                  </div>
                </>
              ) : null}
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
    </div>,
    document.body,
  )
}
