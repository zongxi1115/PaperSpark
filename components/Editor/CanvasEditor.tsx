'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Excalidraw, MIME_TYPES, useHandleLibrary } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI, LibraryItems } from '@excalidraw/excalidraw/types'
import { Button, Chip, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  createCanvasSnapshot,
  DEFAULT_PREVIEW_MAX_HEIGHT,
  DEFAULT_PREVIEW_MAX_WIDTH,
  exportCanvasSceneBlob,
  exportCanvasSceneDataUrl,
  getCanvasBlockDefaults,
  getCanvasInitialData,
  sceneHasElements,
  serializeCanvasScene,
  type CanvasBlockProps,
  type CanvasOriginRect,
} from '@/lib/canvas'

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

const EXCALIDRAW_LIBRARY_STORAGE_KEY = 'paper_reader_excalidraw_library'

function readStoredLibraryItems() {
  if (typeof window === 'undefined') return []

  const raw = window.localStorage.getItem(EXCALIDRAW_LIBRARY_STORAGE_KEY)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as LibraryItems
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStoredLibraryItems(libraryItems: LibraryItems) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(EXCALIDRAW_LIBRARY_STORAGE_KEY, JSON.stringify(libraryItems))
}

export function CanvasEditor({
  graphData,
  width,
  height,
  isDark,
  onSave,
  onClose,
}: CanvasEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const [excalidrawApi, setExcalidrawApi] = useState<ExcalidrawImperativeAPI | null>(null)
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  const initialData = useMemo(() => ({
    ...getCanvasInitialData(String(graphData || ''), isDark),
    libraryItems: readStoredLibraryItems(),
  }), [graphData, isDark, mounted])
  const libraryReturnUrl = useMemo(() => {
    if (!mounted || typeof window === 'undefined') return undefined

    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    return url.toString()
  }, [mounted])
  const libraryAdapter = useMemo(() => ({
    load: async () => {
      const libraryItems = readStoredLibraryItems()
      return libraryItems.length > 0 ? { libraryItems } : null
    },
    save: async ({ libraryItems }: { libraryItems: LibraryItems }) => {
      writeStoredLibraryItems(libraryItems)
    },
  }), [])

  useHandleLibrary({
    excalidrawAPI: excalidrawApi,
    adapter: libraryAdapter,
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    rootRef.current?.focus()
  }, [mounted])

  useEffect(() => {
    if (!mounted) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        event.preventDefault()
        setClosing(true)
        window.setTimeout(onClose, 160)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mounted, onClose, saving])

  const getSnapshot = () => {
    const api = excalidrawApiRef.current
    if (!api) return null

    return createCanvasSnapshot({
      elements: api.getSceneElementsIncludingDeleted(),
      appState: api.getAppState(),
      files: api.getFiles(),
      isDark,
    })
  }

  const closeEditor = () => {
    setClosing(true)
    window.setTimeout(onClose, 160)
  }

  const handleSave = async () => {
    const snapshot = getSnapshot()
    if (!snapshot) return

    setSaving(true)

    try {
      const defaults = getCanvasBlockDefaults()
      const hasElements = sceneHasElements(snapshot)
      const serialized = hasElements ? serializeCanvasScene(snapshot, isDark) : ''
      const previewDataUrl = hasElements
        ? await exportCanvasSceneDataUrl(snapshot, isDark, {
          maxWidth: DEFAULT_PREVIEW_MAX_WIDTH,
          maxHeight: DEFAULT_PREVIEW_MAX_HEIGHT,
          quality: 1,
        })
        : ''

      onSave({
        ...defaults,
        width: width ?? defaults.width,
        height: height ?? defaults.height,
        graphData: serialized,
        previewDataUrl,
      })

      closeEditor()
    } catch (error) {
      addToast({
        title: `保存画板失败：${error instanceof Error ? error.message : '未知错误'}`,
        color: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleExportPng = async () => {
    const snapshot = getSnapshot()
    if (!snapshot) return

    setExporting(true)

    try {
      const blob = await exportCanvasSceneBlob(snapshot, isDark, {
        maxWidth: 1800,
        maxHeight: 1400,
        quality: 1,
        mimeType: MIME_TYPES.png,
      })

      if (!blob) {
        addToast({ title: '当前画板为空，暂无可导出的内容', color: 'warning' })
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'paperspark-canvas.png'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      addToast({
        title: `导出 PNG 失败：${error instanceof Error ? error.message : '未知错误'}`,
        color: 'danger',
      })
    } finally {
      setExporting(false)
    }
  }

  const handleReset = () => {
    const api = excalidrawApiRef.current
    if (!api) return

    api.updateScene({
      elements: [],
      appState: {
        ...api.getAppState(),
        ...initialData.appState,
      },
    })
    api.history.clear()
  }

  if (!mounted) return null

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: isDark ? 'rgba(2, 6, 23, 0.72)' : 'rgba(15, 23, 42, 0.2)',
        backdropFilter: 'blur(14px)',
      }}
    >
      <motion.div
        initial={{
          opacity: 0,
        }}
        animate={{
          opacity: closing ? 0 : 1,
        }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: isDark ? '#0b1220' : '#eef2f7',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '14px 18px',
            borderBottom: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(148, 163, 184, 0.22)'}`,
            background: isDark ? 'rgba(15, 23, 42, 0.86)' : 'rgba(255, 255, 255, 0.9)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 14,
                display: 'grid',
                placeItems: 'center',
                background: isDark ? 'rgba(59, 130, 246, 0.18)' : 'rgba(37, 99, 235, 0.1)',
                color: isDark ? '#bfdbfe' : '#1d4ed8',
              }}
            >
              <Icon icon="mdi:vector-polyline" width={20} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>
              在线画板
              </div>
              {/* <div style={{ fontSize: 12, color: isDark ? 'rgba(203, 213, 225, 0.72)' : 'rgba(71, 85, 105, 0.88)' }}>
                默认已切为正式风格：Helvetica、实线、锐角、最低 roughness
              </div> */}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Chip variant="flat" color="secondary">正式风格</Chip>
            <Button
              size="sm"
              variant="flat"
              startContent={<Icon icon="mdi:refresh" width={16} />}
              onPress={handleReset}
              isDisabled={saving}
            >
              清空
            </Button>
            <Button
              size="sm"
              variant="flat"
              startContent={<Icon icon="mdi:image-outline" width={16} />}
              onPress={() => void handleExportPng()}
              isLoading={exporting}
              isDisabled={saving}
            >
              导出 PNG
            </Button>
            <Button size="sm" variant="light" onPress={closeEditor} isDisabled={saving}>
              取消
            </Button>
            <Button
              size="sm"
              color="primary"
              onPress={() => void handleSave()}
              isLoading={saving}
              isDisabled={exporting}
              startContent={!saving ? <Icon icon="mdi:content-save-outline" width={16} /> : undefined}
            >
              保存
            </Button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              borderRadius: 24,
              border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.22)'}`,
              boxShadow: isDark
                ? '0 24px 48px rgba(2, 6, 23, 0.42)'
                : '0 20px 40px rgba(15, 23, 42, 0.08)',
            }}
          >
            <Excalidraw
              initialData={initialData}
              theme={isDark ? 'dark' : 'light'}
              gridModeEnabled
              objectsSnapModeEnabled
              libraryReturnUrl={libraryReturnUrl}
              excalidrawAPI={(api) => {
                excalidrawApiRef.current = api
                setExcalidrawApi(api)
              }}
              UIOptions={{
                canvasActions: {
                  export: false,
                  loadScene: false,
                  saveToActiveFile: false,
                  saveAsImage: false,
                  toggleTheme: false,
                },
                tools: {
                  image: true,
                },
              }}
              viewModeEnabled={false}
              zenModeEnabled={false}
              detectScroll
              handleKeyboardGlobally={false}
              onLibraryChange={(libraryItems) => {
                writeStoredLibraryItems(libraryItems)
              }}
              autoFocus
            />
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
