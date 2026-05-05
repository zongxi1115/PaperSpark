import {
  convertToExcalidrawElements,
  exportToBlob,
  FONT_FAMILY,
  getCommonBounds,
  getNonDeletedElements,
  MIME_TYPES,
  restore,
  serializeAsJSON,
  THEME,
} from '@excalidraw/excalidraw'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawElement, OrderedExcalidrawElement, Theme } from '@excalidraw/excalidraw/element/types'
import type { AppState, BinaryFiles, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'

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

export interface CanvasSceneSnapshot {
  elements: OrderedExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export const DEFAULT_CANVAS_WIDTH = 1200
export const DEFAULT_CANVAS_HEIGHT = 720
export const DEFAULT_PREVIEW_MAX_WIDTH = 800
export const DEFAULT_PREVIEW_MAX_HEIGHT = 600

function getCanvasTheme(isDark: boolean): Theme {
  return isDark ? THEME.DARK : THEME.LIGHT
}

export function getCanvasSurfaceColor(isDark: boolean) {
  return isDark ? '#0b1220' : '#f8fafc'
}

function getCanvasStrokeColor(isDark: boolean) {
  return isDark ? '#cbd5e1' : '#334155'
}

function getCanvasFillColor(isDark: boolean) {
  return isDark ? '#162033' : '#ffffff'
}

function getFormalCanvasAppState(isDark: boolean): Partial<AppState> {
  return {
    theme: getCanvasTheme(isDark),
    viewBackgroundColor: getCanvasSurfaceColor(isDark),
    exportBackground: true,
    exportWithDarkMode: isDark,
    gridModeEnabled: true,
    objectsSnapModeEnabled: true,
    currentItemStrokeColor: getCanvasStrokeColor(isDark),
    currentItemBackgroundColor: getCanvasFillColor(isDark),
    currentItemFillStyle: 'solid',
    currentItemStrokeWidth: 2,
    currentItemStrokeStyle: 'solid',
    currentItemRoughness: 0,
    currentItemOpacity: 100,
    currentItemFontFamily: FONT_FAMILY.Helvetica,
    currentItemFontSize: 18,
    currentItemTextAlign: 'center',
    currentItemStartArrowhead: null,
    currentItemEndArrowhead: 'triangle',
    currentItemRoundness: 'sharp',
    currentItemArrowType: 'elbow',
    showWelcomeScreen: false,
  }
}

function normalizeElements(elements: readonly ExcalidrawElement[], isDark: boolean): OrderedExcalidrawElement[] {
  const strokeColor = getCanvasStrokeColor(isDark)
  const fillColor = getCanvasFillColor(isDark)

  return elements.map((element) => {
    const next: ExcalidrawElement = {
      ...element,
      roughness: 0,
      strokeStyle: 'solid',
      strokeColor: element.strokeColor || strokeColor,
    }

    if (next.type === 'text') {
      return {
        ...next,
        fontFamily: FONT_FAMILY.Helvetica,
      } as OrderedExcalidrawElement
    }

    if (next.type === 'arrow') {
      return {
        ...next,
        endArrowhead: next.endArrowhead ?? 'triangle',
      } as OrderedExcalidrawElement
    }

    if (next.type === 'rectangle' || next.type === 'diamond') {
      return {
        ...next,
        roundness: null,
        backgroundColor: next.backgroundColor && next.backgroundColor !== 'transparent'
          ? next.backgroundColor
          : fillColor,
      } as OrderedExcalidrawElement
    }

    if (next.type === 'ellipse') {
      return {
        ...next,
        backgroundColor: next.backgroundColor && next.backgroundColor !== 'transparent'
          ? next.backgroundColor
          : fillColor,
      } as OrderedExcalidrawElement
    }

    return next as OrderedExcalidrawElement
  })
}

function createEmptyScene(isDark: boolean): CanvasSceneSnapshot {
  return {
    elements: [],
    appState: getFormalCanvasAppState(isDark),
    files: {},
  }
}

function coerceSceneSnapshot(snapshot: CanvasSceneSnapshot, isDark: boolean): CanvasSceneSnapshot {
  return {
    elements: normalizeElements(snapshot.elements, isDark),
    appState: {
      ...snapshot.appState,
      ...getFormalCanvasAppState(isDark),
      theme: getCanvasTheme(isDark),
      viewBackgroundColor: getCanvasSurfaceColor(isDark),
      exportBackground: true,
      exportWithDarkMode: isDark,
    },
    files: snapshot.files ?? {},
  }
}

function isStoredExcalidrawScene(value: unknown): value is {
  elements?: readonly ExcalidrawElement[]
  appState?: Partial<AppState>
  files?: BinaryFiles
} {
  return Boolean(value && typeof value === 'object' && ('elements' in value || 'appState' in value || 'files' in value))
}

function getSceneBounds(elements: readonly ExcalidrawElement[]) {
  if (elements.length === 0) {
    return { width: 320, height: 240 }
  }

  const [minX, minY, maxX, maxY] = getCommonBounds(elements)
  return {
    width: Math.max(Math.ceil(maxX - minX), 320),
    height: Math.max(Math.ceil(maxY - minY), 240),
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取导出图片失败'))
    reader.readAsDataURL(blob)
  })
}

export function getViewportRect(): CanvasOriginRect {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0, width: 800, height: 600 }
  }

  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

export function getCanvasBlockDefaults(): CanvasBlockProps {
  return {
    graphData: '',
    previewDataUrl: '',
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
  }
}

export function sceneHasElements(snapshot: CanvasSceneSnapshot) {
  return getNonDeletedElements(snapshot.elements).length > 0
}

export function readCanvasScene(graphData: string, isDark: boolean): CanvasSceneSnapshot {
  if (!graphData.trim()) {
    return createEmptyScene(isDark)
  }

  try {
    const parsed = JSON.parse(graphData)

    if (!isStoredExcalidrawScene(parsed)) {
      return createEmptyScene(isDark)
    }

    const restored = restore(parsed, getFormalCanvasAppState(isDark), null)
    return coerceSceneSnapshot({
      elements: restored.elements,
      appState: restored.appState,
      files: restored.files ?? {},
    }, isDark)
  } catch {
    return createEmptyScene(isDark)
  }
}

export function getCanvasInitialData(graphData: string, isDark: boolean): ExcalidrawInitialDataState {
  const scene = readCanvasScene(graphData, isDark)

  return {
    elements: scene.elements,
    appState: scene.appState,
    files: scene.files,
    scrollToContent: sceneHasElements(scene),
  }
}

export function createCanvasSnapshot(params: {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
  isDark: boolean
}) {
  return coerceSceneSnapshot({
    elements: normalizeElements(params.elements, params.isDark),
    appState: params.appState,
    files: params.files,
  }, params.isDark)
}

export function serializeCanvasScene(snapshot: CanvasSceneSnapshot, isDark: boolean) {
  const normalized = coerceSceneSnapshot(snapshot, isDark)

  if (!sceneHasElements(normalized)) {
    return ''
  }

  return serializeAsJSON(normalized.elements, normalized.appState, normalized.files, 'database')
}

export async function exportCanvasSceneBlob(
  snapshot: CanvasSceneSnapshot,
  isDark: boolean,
  options?: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
    mimeType?: string
  },
) {
  const normalized = coerceSceneSnapshot(snapshot, isDark)
  const elements = getNonDeletedElements(normalized.elements)

  if (elements.length === 0) {
    return null
  }

  const bounds = getSceneBounds(elements)
  const maxWidth = options?.maxWidth ?? DEFAULT_PREVIEW_MAX_WIDTH
  const maxHeight = options?.maxHeight ?? DEFAULT_PREVIEW_MAX_HEIGHT
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height, 1)

  return await exportToBlob({
    elements,
    appState: normalized.appState,
    files: normalized.files,
    mimeType: options?.mimeType ?? MIME_TYPES.png,
    quality: options?.quality ?? 1,
    exportPadding: 32,
    getDimensions: (width, height) => ({
      width: Math.max(Math.round(width * scale), 320),
      height: Math.max(Math.round(height * scale), 240),
      scale: 1,
    }),
  })
}

export async function exportCanvasSceneDataUrl(
  snapshot: CanvasSceneSnapshot,
  isDark: boolean,
  options?: {
    maxWidth?: number
    maxHeight?: number
    quality?: number
  },
) {
  const blob = await exportCanvasSceneBlob(snapshot, isDark, options)
  if (!blob) return ''
  return await blobToDataUrl(blob)
}

export function createLegacyDropScene(label = '旧版画板已丢弃'): CanvasSceneSnapshot {
  const skeletons: ExcalidrawElementSkeleton[] = [
    {
      type: 'rectangle',
      x: 240,
      y: 180,
      width: 480,
      height: 180,
      strokeColor: '#334155',
      backgroundColor: '#ffffff',
      strokeWidth: 2,
      roughness: 0,
      label: {
        text: label,
        fontFamily: FONT_FAMILY.Helvetica,
        fontSize: 22,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    },
  ]

  return {
    elements: convertToExcalidrawElements(skeletons, { regenerateIds: false }),
    appState: getFormalCanvasAppState(false),
    files: {},
  }
}
