import { Icon } from '@iconify/react'
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export interface CanvasBlockProps {
  graphData: string
  previewDataUrl: string
  width: number
  height: number
}

export interface CanvasOriginRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CanvasGraphSession {
  graph: any
  history: any
  clipboard: any
  keyboard: any
  selection: any
  stencil: any | null
  dispose: () => void
}

export const DEFAULT_CANVAS_WIDTH = 1200
export const DEFAULT_CANVAS_HEIGHT = 720
export const DEFAULT_PREVIEW_MAX_WIDTH = 800
export const DEFAULT_PREVIEW_MAX_HEIGHT = 600
export const CANVAS_NODE_SHAPE = 'paperspark-canvas-node'

type CanvasNodePreset = {
  id: string
  label: string
  icon: string
  color: string
  group: 'basic' | 'flow' | 'architecture' | 'paper'
  variant:
    | 'rectangle'
    | 'rounded'
    | 'circle'
    | 'diamond'
    | 'parallelogram'
    | 'cylinder'
    | 'document'
    | 'multiDocument'
    | 'cloud'
    | 'comparison'
    | 'annotation'
  width?: number
  height?: number
}

const PORT_ITEMS = [
  { id: 'top', group: 'top' },
  { id: 'right', group: 'right' },
  { id: 'bottom', group: 'bottom' },
  { id: 'left', group: 'left' },
] as const

const CANVAS_NODE_PRESETS: CanvasNodePreset[] = [
  { id: 'rect', label: '矩形', icon: 'mdi:shape-rectangle-plus', color: '#6366f1', group: 'basic', variant: 'rectangle' },
  { id: 'rounded', label: '圆角矩形', icon: 'mdi:rectangle-rounded', color: '#8b5cf6', group: 'basic', variant: 'rounded' },
  { id: 'circle', label: '圆 / 椭圆', icon: 'mdi:ellipse-outline', color: '#0ea5e9', group: 'basic', variant: 'circle', width: 120, height: 120 },
  { id: 'diamond', label: '菱形', icon: 'mdi:source-branch', color: '#f59e0b', group: 'basic', variant: 'diamond', width: 148, height: 110 },
  { id: 'parallel', label: '平行四边形', icon: 'mdi:shape-parallelogram', color: '#ef4444', group: 'basic', variant: 'parallelogram' },
  { id: 'process', label: '处理块', icon: 'mdi:cog-outline', color: '#4f46e5', group: 'flow', variant: 'rounded' },
  { id: 'storage', label: '数据存储', icon: 'mdi:database-outline', color: '#06b6d4', group: 'flow', variant: 'cylinder' },
  { id: 'document', label: '文档', icon: 'mdi:file-document-outline', color: '#f97316', group: 'flow', variant: 'document' },
  { id: 'multiDocument', label: '多文档', icon: 'mdi:file-multiple-outline', color: '#ec4899', group: 'flow', variant: 'multiDocument' },
  { id: 'server', label: '服务器', icon: 'mdi:server-outline', color: '#14b8a6', group: 'architecture', variant: 'rectangle' },
  { id: 'database', label: '数据库', icon: 'mdi:database', color: '#2563eb', group: 'architecture', variant: 'cylinder' },
  { id: 'client', label: '客户端', icon: 'mdi:monitor-cellphone', color: '#8b5cf6', group: 'architecture', variant: 'rounded' },
  { id: 'gateway', label: 'API 网关', icon: 'mdi:api', color: '#f59e0b', group: 'architecture', variant: 'diamond' },
  { id: 'cloud', label: '云服务', icon: 'mdi:cloud-outline', color: '#0ea5e9', group: 'architecture', variant: 'cloud' },
  { id: 'module', label: '模块框', icon: 'mdi:view-grid-outline', color: '#22c55e', group: 'architecture', variant: 'rectangle' },
  { id: 'dataset', label: '数据集', icon: 'mdi:database-search-outline', color: '#10b981', group: 'paper', variant: 'cylinder' },
  { id: 'model', label: '模型 / 算法', icon: 'mdi:brain', color: '#7c3aed', group: 'paper', variant: 'rounded' },
  { id: 'result', label: '实验结果', icon: 'mdi:chart-box-outline', color: '#ef4444', group: 'paper', variant: 'document' },
  { id: 'comparison', label: '对比表', icon: 'mdi:table-large', color: '#f97316', group: 'paper', variant: 'comparison' },
  { id: 'annotation', label: '箭头注释', icon: 'mdi:comment-text-outline', color: '#64748b', group: 'paper', variant: 'annotation' },
]

const STENCIL_GROUP_META = [
  { name: 'basic', title: '基本形状' },
  { name: 'flow', title: '流程元素' },
  { name: 'architecture', title: '系统架构' },
  { name: 'paper', title: '论文图表' },
] as const

let runtimePromise: Promise<CanvasRuntime> | null = null
let reactNodeRegistered = false

type CanvasRuntime = {
  Graph: any
  Stencil: any
  Snapline: any
  Selection: any
  Clipboard: any
  Keyboard: any
  History: any
  registerReactShape: (config: Record<string, unknown>) => void
}

function getCanvasSurfaceColor(isDark: boolean) {
  return isDark ? '#08111f' : '#f8fafc'
}

function getCanvasBorderColor(isDark: boolean) {
  return isDark ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.28)'
}

function getCanvasTextColor(isDark: boolean) {
  return isDark ? '#e2e8f0' : '#0f172a'
}

function createPortConfig() {
  return {
    groups: {
      top: {
        position: 'top',
        attrs: {
          circle: {
            r: 5,
            magnet: true,
            stroke: '#6366f1',
            strokeWidth: 2,
            fill: '#ffffff',
          },
        },
      },
      right: {
        position: 'right',
        attrs: {
          circle: {
            r: 5,
            magnet: true,
            stroke: '#6366f1',
            strokeWidth: 2,
            fill: '#ffffff',
          },
        },
      },
      bottom: {
        position: 'bottom',
        attrs: {
          circle: {
            r: 5,
            magnet: true,
            stroke: '#6366f1',
            strokeWidth: 2,
            fill: '#ffffff',
          },
        },
      },
      left: {
        position: 'left',
        attrs: {
          circle: {
            r: 5,
            magnet: true,
            stroke: '#6366f1',
            strokeWidth: 2,
            fill: '#ffffff',
          },
        },
      },
    },
    items: PORT_ITEMS.map((port) => ({ ...port })),
  }
}

function createNodeMetadata(preset: CanvasNodePreset, isDark: boolean) {
  const width = preset.width ?? 176
  const height = preset.height ?? 88

  return {
    shape: CANVAS_NODE_SHAPE,
    width,
    height,
    ports: createPortConfig(),
    data: {
      presetId: preset.id,
      label: preset.label,
      icon: preset.icon,
      color: preset.color,
      variant: preset.variant,
      isDark,
    },
  }
}

function getStencilData(isDark: boolean) {
  return STENCIL_GROUP_META.map((groupMeta) => ({
    ...groupMeta,
    nodes: CANVAS_NODE_PRESETS.filter((preset) => preset.group === groupMeta.name).map((preset) => createNodeMetadata(preset, isDark)),
  }))
}

function getVariantOuterStyle(variant: CanvasNodePreset['variant']) {
  const base: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 16px',
    position: 'relative',
    overflow: 'hidden',
  }

  switch (variant) {
    case 'rounded':
      return { ...base, borderRadius: 24 }
    case 'circle':
      return { ...base, borderRadius: 999 }
    case 'diamond':
      return { ...base, clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', padding: '18px 28px' }
    case 'parallelogram':
      return { ...base, clipPath: 'polygon(12% 0%, 100% 0%, 88% 100%, 0% 100%)', padding: '14px 22px' }
    case 'cylinder':
      return { ...base, borderRadius: '999px / 26px' }
    case 'document':
      return { ...base, clipPath: 'polygon(0 0, 78% 0, 100% 20%, 100% 100%, 0 100%)' }
    case 'multiDocument':
      return { ...base, borderRadius: 18, padding: '14px 18px' }
    case 'cloud':
      return { ...base, borderRadius: 999, padding: '18px 24px' }
    case 'comparison':
      return { ...base, borderRadius: 22 }
    case 'annotation':
      return { ...base, borderRadius: 20, padding: '14px 18px' }
    default:
      return { ...base, borderRadius: 18 }
  }
}

function getVariantDecorationStyle(variant: CanvasNodePreset['variant'], color: string, isDark: boolean) {
  const accent = `${color}26`

  switch (variant) {
    case 'multiDocument':
      return {
        boxShadow: `-8px 8px 0 ${accent}`,
      } satisfies CSSProperties
    case 'comparison':
      return {
        backgroundImage: `linear-gradient(${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'} 1px, transparent 1px), linear-gradient(90deg, ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'} 1px, transparent 1px)`,
        backgroundSize: '22px 22px',
      } satisfies CSSProperties
    case 'annotation':
      return {
        borderStyle: 'dashed',
      } satisfies CSSProperties
    default:
      return {}
  }
}

function CanvasNodeCard({ node }: { node: any }) {
  const data = node?.getData?.() ?? {}
  const color = String(data.color ?? '#6366f1')
  const isDark = Boolean(data.isDark)
  const variant = (data.variant ?? 'rectangle') as CanvasNodePreset['variant']
  const [editing, setEditing] = useState(false)
  const [draftLabel, setDraftLabel] = useState(String(data.label ?? '未命名节点'))

  useEffect(() => {
    setDraftLabel(String((node?.getData?.() ?? {}).label ?? '未命名节点'))
  }, [node, data.label])

  const outerStyle = useMemo(() => {
    const baseColor = isDark ? 'rgba(15, 23, 42, 0.94)' : '#ffffff'
    return {
      ...getVariantOuterStyle(variant),
      ...getVariantDecorationStyle(variant, color, isDark),
      background: `linear-gradient(135deg, ${baseColor} 0%, ${isDark ? 'rgba(15, 23, 42, 0.84)' : 'rgba(248, 250, 252, 0.98)'} 100%)`,
      border: `1.5px solid ${color}`,
      color: getCanvasTextColor(isDark),
      boxShadow: isDark ? '0 14px 36px rgba(2, 6, 23, 0.32)' : '0 14px 30px rgba(15, 23, 42, 0.12)',
    } satisfies CSSProperties
  }, [color, isDark, variant])

  const commitLabel = () => {
    const nextLabel = draftLabel.trim() || '未命名节点'
    setDraftLabel(nextLabel)
    setEditing(false)
    const current = node?.getData?.() ?? {}
    node?.setData?.({ ...current, label: nextLabel })
  }

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      commitLabel()
    }
    if (event.key === 'Escape') {
      setDraftLabel(String((node?.getData?.() ?? {}).label ?? '未命名节点'))
      setEditing(false)
    }
  }

  return (
    <div
      style={outerStyle}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setEditing(true)
      }}
    >
      {variant === 'document' ? (
        <div
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 32,
            height: 28,
            background: `${color}20`,
            clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
          }}
        />
      ) : null}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          minWidth: 0,
          justifyContent: variant === 'annotation' ? 'flex-start' : 'center',
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 12,
            background: `${color}1c`,
            color,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Icon icon={String(data.icon ?? 'mdi:vector-polyline')} width={18} />
        </div>
        <div
          style={{
            minWidth: 0,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {editing ? (
            <input
              autoFocus
              value={draftLabel}
              onChange={(event) => setDraftLabel(event.target.value)}
              onBlur={commitLabel}
              onKeyDown={handleInputKeyDown}
              style={{
                width: '100%',
                border: 'none',
                background: 'transparent',
                color: getCanvasTextColor(isDark),
                fontSize: 13,
                fontWeight: 600,
                outline: 'none',
                padding: 0,
              }}
            />
          ) : (
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {draftLabel}
            </div>
          )}
          <div
            style={{
              fontSize: 11,
              color: isDark ? 'rgba(203, 213, 225, 0.74)' : 'rgba(71, 85, 105, 0.82)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            双击编辑标签
          </div>
        </div>
      </div>
    </div>
  )
}

async function ensureCanvasReactNodeRegistered(runtime: CanvasRuntime) {
  if (reactNodeRegistered) return

  runtime.registerReactShape({
    shape: CANVAS_NODE_SHAPE,
    inherit: 'react-shape',
    width: 176,
    height: 88,
    component: CanvasNodeCard,
    effect: ['data'],
    portMarkup: [{ tagName: 'circle', selector: 'circle' }],
    attrs: {
      body: {
        fill: 'transparent',
        stroke: 'transparent',
      },
    },
  })

  reactNodeRegistered = true
}

export async function loadCanvasX6Runtime(): Promise<CanvasRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import('@antv/x6'),
      import('@antv/x6-plugin-stencil'),
      import('@antv/x6-plugin-snapline'),
      import('@antv/x6-plugin-selection'),
      import('@antv/x6-plugin-clipboard'),
      import('@antv/x6-plugin-keyboard'),
      import('@antv/x6-plugin-history'),
      import('@antv/x6-plugin-export'),
      import('@antv/x6-react-shape'),
    ]).then(async ([x6, stencil, snapline, selection, clipboard, keyboard, history, _exportPlugin, reactShape]) => {
      const runtime: CanvasRuntime = {
        Graph: x6.Graph,
        Stencil: stencil.Stencil,
        Snapline: snapline.Snapline,
        Selection: selection.Selection,
        Clipboard: clipboard.Clipboard,
        Keyboard: keyboard.Keyboard,
        History: history.History,
        registerReactShape: reactShape.register,
      }

      await ensureCanvasReactNodeRegistered(runtime)
      return runtime
    })
  }

  return runtimePromise
}

function bindCanvasShortcuts(session: Omit<CanvasGraphSession, 'dispose' | 'stencil'>) {
  const getSelectedCells = () => {
    if (typeof session.selection?.getSelectedCells === 'function') {
      return session.selection.getSelectedCells()
    }
    return []
  }

  session.keyboard.bindKey(['meta+c', 'ctrl+c'], () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      session.clipboard.copy(cells)
    }
  })

  session.keyboard.bindKey(['meta+x', 'ctrl+x'], () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      session.clipboard.cut(cells)
      session.selection.clean()
    }
  })

  session.keyboard.bindKey(['meta+v', 'ctrl+v'], () => {
    const cells = session.clipboard.paste({ offset: 24 }, session.graph)
    if (Array.isArray(cells) && cells.length > 0) {
      session.selection.reset(cells)
    }
  })

  session.keyboard.bindKey(['backspace', 'delete'], () => {
    const cells = getSelectedCells()
    if (cells.length > 0) {
      session.graph.removeCells(cells)
      session.selection.clean()
    }
  })

  session.keyboard.bindKey(['meta+z', 'ctrl+z'], () => {
    if (session.history.canUndo()) {
      session.history.undo()
    }
  })

  session.keyboard.bindKey(['meta+shift+z', 'ctrl+shift+z', 'meta+y', 'ctrl+y'], () => {
    if (session.history.canRedo()) {
      session.history.redo()
    }
  })
}

function getOppositePort(portId: string | null | undefined) {
  switch (portId) {
    case 'top':
      return 'bottom'
    case 'right':
      return 'left'
    case 'bottom':
      return 'top'
    case 'left':
      return 'right'
    default:
      return 'left'
  }
}

function bindAutoCreateNode(graph: any) {
  graph.on('edge:connected', ({ edge, currentPoint }: any) => {
    const sourceCellId = edge?.getSourceCellId?.()
    const targetCellId = edge?.getTargetCellId?.()

    if (sourceCellId && targetCellId) return
    if (!currentPoint) return

    const anchorCellId = sourceCellId || targetCellId
    if (!anchorCellId) return

    const anchorCell = graph.getCellById(anchorCellId)
    if (!anchorCell || anchorCell.isEdge?.()) return

    const cloneMetadata = anchorCell.toJSON?.() ?? {}
    const nextNode = graph.addNode({
      ...cloneMetadata,
      id: undefined,
      x: Number(currentPoint.x) - Number(cloneMetadata.width ?? 176) / 2,
      y: Number(currentPoint.y) - Number(cloneMetadata.height ?? 88) / 2,
    })

    if (!targetCellId) {
      edge.setTarget({
        cell: nextNode.id,
        port: getOppositePort(edge?.getSourcePortId?.()),
      })
    } else {
      edge.setSource({
        cell: nextNode.id,
        port: getOppositePort(edge?.getTargetPortId?.()),
      })
    }

    graph.batchUpdate(() => {
      graph.cleanSelection?.()
      graph.select?.([nextNode, edge])
    })
  })
}

function applyStencilTheme(stencilContainer: HTMLElement, isDark: boolean) {
  stencilContainer.style.width = '100%'
  stencilContainer.style.height = '100%'
  stencilContainer.style.background = 'transparent'
  stencilContainer.style.color = getCanvasTextColor(isDark)

  const setStyle = (selector: string, styles: Partial<CSSStyleDeclaration>) => {
    stencilContainer.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      Object.assign(element.style, styles)
    })
  }

  setStyle('.x6-widget-stencil-title', {
    background: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(241, 245, 249, 0.95)',
    color: getCanvasTextColor(isDark),
  })

  setStyle('.x6-widget-stencil-group-title', {
    background: isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(248, 250, 252, 0.96)',
    color: getCanvasTextColor(isDark),
    borderBottom: `1px solid ${getCanvasBorderColor(isDark)}`,
  })

  setStyle('.x6-widget-stencil-search-text', {
    background: isDark ? 'rgba(15, 23, 42, 0.96)' : '#ffffff',
    color: getCanvasTextColor(isDark),
    border: `1px solid ${getCanvasBorderColor(isDark)}`,
  })
}

export function setCanvasGraphTheme(graph: any, isDark: boolean, stencil?: any) {
  if (graph?.container instanceof HTMLElement) {
    graph.container.style.background = getCanvasSurfaceColor(isDark)
  }

  const nodes = graph?.getNodes?.() ?? []
  nodes.forEach((node: any) => {
    const current = node.getData?.() ?? {}
    node.setData?.({ ...current, isDark })
  })

  if (stencil?.container instanceof HTMLElement) {
    applyStencilTheme(stencil.container, isDark)
  }
}

export async function createCanvasGraphSession(options: {
  container: HTMLElement
  stencilHost?: HTMLElement | null
  graphData?: string
  isDark: boolean
  width?: number
  height?: number
}): Promise<CanvasGraphSession> {
  const runtime = await loadCanvasX6Runtime()

  const graph = new runtime.Graph({
    container: options.container,
    width: Math.max(options.container.clientWidth || options.width || DEFAULT_CANVAS_WIDTH, 320),
    height: Math.max(options.container.clientHeight || options.height || DEFAULT_CANVAS_HEIGHT, 240),
    background: {
      color: getCanvasSurfaceColor(options.isDark),
    },
    grid: {
      size: 12,
      visible: true,
      type: 'mesh',
      args: {
        color: options.isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.14)',
        thickness: 1,
      },
    },
    panning: {
      enabled: true,
      eventTypes: ['rightMouseDown', 'mouseWheelDown'],
    },
    mousewheel: {
      enabled: true,
      modifiers: ['ctrl', 'meta'],
      minScale: 0.25,
      maxScale: 2.2,
      factor: 1.08,
    },
    connecting: {
      allowBlank: true,
      allowNode: true,
      allowLoop: false,
      allowMulti: 'withPort',
      snap: {
        radius: 24,
      },
      router: {
        name: 'manhattan',
      },
      connector: {
        name: 'rounded',
      },
      createEdge() {
        return this.createEdge({
          attrs: {
            line: {
              stroke: '#6366f1',
              strokeWidth: 2,
              targetMarker: {
                name: 'classic',
                size: 7,
              },
            },
          },
          router: {
            name: 'manhattan',
          },
          connector: {
            name: 'rounded',
          },
          zIndex: 1,
        })
      },
    },
  })

  const history = new runtime.History({ enabled: true })
  const snapline = new runtime.Snapline({ enabled: true, sharp: true })
  const selection = new runtime.Selection({
    enabled: true,
    rubberband: true,
    showNodeSelectionBox: true,
    showEdgeSelectionBox: true,
    multiple: true,
    movable: true,
  })
  const clipboard = new runtime.Clipboard({ enabled: true, useLocalStorage: false })
  const keyboard = new runtime.Keyboard({ enabled: true, global: false })

  graph.use(history)
  graph.use(snapline)
  graph.use(selection)
  graph.use(clipboard)
  graph.use(keyboard)

  const sessionBase = { graph, history, clipboard, keyboard, selection }
  bindCanvasShortcuts(sessionBase)
  bindAutoCreateNode(graph)

  let stencil: any | null = null
  if (options.stencilHost) {
    stencil = new runtime.Stencil({
      title: '组件库',
      target: graph,
      stencilGraphWidth: 208,
      stencilGraphHeight: 820,
      collapsable: true,
      groups: STENCIL_GROUP_META.map((groupMeta) => ({
        name: groupMeta.name,
        title: groupMeta.title,
        collapsable: true,
      })),
      search: true,
      layoutOptions: {
        columns: 1,
        columnWidth: 180,
        rowHeight: 'compact',
      },
    })

    const stencilData = getStencilData(options.isDark)
    stencilData.forEach((group) => {
      stencil.load(group.nodes, group.name)
    })

    options.stencilHost.innerHTML = ''
    options.stencilHost.appendChild(stencil.container)
    applyStencilTheme(stencil.container, options.isDark)
  }

  if (options.graphData) {
    try {
      graph.fromJSON(JSON.parse(options.graphData))
    } catch (error) {
      console.warn('Failed to restore canvas graph data.', error)
    }
  }

  setCanvasGraphTheme(graph, options.isDark, stencil)

  requestAnimationFrame(() => {
    if ((graph.getCells?.() ?? []).length > 0) {
      graph.centerContent?.({ padding: 40 })
    }
  })

  return {
    ...sessionBase,
    stencil,
    dispose: () => {
      stencil?.dispose?.()
      graph.dispose?.()
    },
  }
}

export function getViewportRect(): CanvasOriginRect {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0, width: 1280, height: 800 }
  }

  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

export async function waitForNextPaint() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

export async function exportGraphDataUrl(options: {
  graph: any
  format: 'png' | 'jpeg'
  isDark: boolean
  maxWidth?: number
  maxHeight?: number
  quality?: number
}) {
  await waitForNextPaint()

  const bbox = options.graph.getContentBBox?.()
  const contentWidth = Math.max(Number(bbox?.width ?? 0) + 64, 320)
  const contentHeight = Math.max(Number(bbox?.height ?? 0) + 64, 240)
  const maxWidth = options.maxWidth ?? DEFAULT_PREVIEW_MAX_WIDTH
  const maxHeight = options.maxHeight ?? DEFAULT_PREVIEW_MAX_HEIGHT
  const ratio = Math.min(maxWidth / contentWidth, maxHeight / contentHeight, 1)
  const width = Math.max(Math.round(contentWidth * ratio), 320)
  const height = Math.max(Math.round(contentHeight * ratio), 240)

  return await new Promise<string>((resolve) => {
    const callback = (dataUrl: string) => resolve(dataUrl)
    const exportOptions = {
      width,
      height,
      padding: 32,
      quality: options.quality ?? 0.72,
      backgroundColor: getCanvasSurfaceColor(options.isDark),
    }

    if (options.format === 'png') {
      options.graph.toPNG(callback, exportOptions)
    } else {
      options.graph.toJPEG(callback, exportOptions)
    }
  })
}

export async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl)
  return await response.blob()
}

export function getCanvasBlockDefaults(): CanvasBlockProps {
  return {
    graphData: '',
    previewDataUrl: '',
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
  }
}
