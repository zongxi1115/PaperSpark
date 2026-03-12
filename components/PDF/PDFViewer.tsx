'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { TextBlock, PDFAnnotation, HIGHLIGHT_COLORS, HighlightColor, GuideFocusTarget } from '@/lib/types'
import { saveAnnotation, updateAnnotation } from '@/lib/pdfCache'

// PDF.js 类型定义
interface PDFDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PDFPageProxy>
}

interface PDFPageProxy {
  pageNumber: number
  getViewport(params: { scale: number }): PDFViewport
  render(params: {
    canvasContext: CanvasRenderingContext2D
    viewport: PDFViewport
    transform?: number[]
  }): { promise: Promise<void>; cancel?: () => void }
  getTextContent(): Promise<PDFTextContent>
  streamTextContent(): unknown
}

interface PDFViewport {
  width: number
  height: number
  scale: number
  rotation: number
  offsetX: number
  offsetY: number
  transform: number[]
}

interface PDFTextContent {
  items: PDFTextItem[]
  styles: Record<string, PDFTextStyle>
}

interface PDFTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName: string
  hasEOL: boolean
}

interface PDFTextStyle {
  fontFamily?: string
  ascent?: number
  descent?: number
  vertical?: boolean
}

interface PDFJSLib {
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PDFDocumentProxy> }
  GlobalWorkerOptions: { workerSrc: string }
  renderTextLayer: (params: {
    textContentSource: unknown
    container: HTMLElement
    viewport: PDFViewport
    textDivs: HTMLElement[]
    textDivProperties: WeakMap<HTMLElement, unknown>
  }) => { promise: Promise<void>; cancel?: () => void }
}

let pdfjsPromise: Promise<PDFJSLib> | null = null

async function getPdfjs(): Promise<PDFJSLib> {
  if (pdfjsPromise) return pdfjsPromise

  pdfjsPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('PDF 解析只能在客户端进行'))
      return
    }

    const win = window as unknown as { pdfjsLib?: PDFJSLib }
    if (win.pdfjsLib) {
      resolve(win.pdfjsLib)
      return
    }

    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
    script.onload = () => {
      const win = window as unknown as { pdfjsLib?: PDFJSLib }
      if (win.pdfjsLib) {
        win.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        resolve(win.pdfjsLib)
      } else {
        reject(new Error('PDF.js 加载失败'))
      }
    }
    script.onerror = () => reject(new Error('PDF.js 脚本加载失败'))
    document.head.appendChild(script)
  })

  return pdfjsPromise
}

interface PDFViewerProps {
  pdfData: ArrayBuffer
  scale: number
  documentId?: string
  currentPage?: number
  onPageChange?: (page: number) => void
  onTotalPagesChange?: (total: number) => void
  blocks?: TextBlock[]
  showTranslation?: boolean
  annotations?: PDFAnnotation[]
  onAnnotationAdd?: (annotation: PDFAnnotation) => void
  onAnnotationDelete?: (id: string) => void
  onAnnotationUpdate?: (annotation: PDFAnnotation) => void
  jumpToBlock?: { blockId: string; pageNum: number } | null
  focusTarget?: GuideFocusTarget | null
  translationDisplayMode?: 'overlay' | 'parallel'
}

interface TranslationLayout {
  left: number
  top: number
  width: number
  height: number
  fontSize: number
  lineHeight: number
  paddingX: number
  paddingY: number
}

let translationMeasureContext: CanvasRenderingContext2D | null = null

function getTranslationMeasureContext() {
  if (translationMeasureContext || typeof document === 'undefined') {
    return translationMeasureContext
  }

  const canvas = document.createElement('canvas')
  translationMeasureContext = canvas.getContext('2d')
  return translationMeasureContext
}

const TRANSLATION_TOKEN_PATTERN = /([\u3400-\u9fff]|[^\s\u3400-\u9fff]+|\s+)/g

function wrapTextToWidth(text: string, width: number, fontSize: number, fontFamily: string) {
  const context = getTranslationMeasureContext()
  const normalizedText = text.replace(/\r\n/g, '\n')
  if (!context || width <= 0) {
    return normalizedText.split(/\n+/).filter(Boolean)
  }

  context.font = `${fontSize}px ${fontFamily}`
  const paragraphs = normalizedText.split('\n')
  const lines: string[] = []
  const appendLine = (value: string) => {
    const normalized = value.trim()
    if (normalized) {
      lines.push(normalized)
    }
  }

  paragraphs.forEach(paragraph => {
    const normalizedParagraph = paragraph.replace(/\s+/g, ' ').trim()
    if (!normalizedParagraph) return

    const tokens = normalizedParagraph.match(TRANSLATION_TOKEN_PATTERN) || [normalizedParagraph]
    let current = ''

    for (const token of tokens) {
      const candidate = `${current}${token}`
      if (current && context.measureText(candidate).width > width) {
        if (!token.trim()) {
          continue
        }

        if (context.measureText(token).width > width) {
          for (const char of Array.from(token)) {
            const charCandidate = `${current}${char}`
            if (current && context.measureText(charCandidate).width > width) {
              appendLine(current)
              current = char.trim() ? char : ''
            } else {
              current = charCandidate
            }
          }
          continue
        }

        appendLine(current)
        current = token.trimStart()
      } else {
        current = candidate
      }
    }

    appendLine(current)
  })

  return lines.length > 0 ? lines : [normalizedText.trim()]
}

function buildTranslationLayout(
  block: TextBlock,
  scale: number,
  viewport: PDFViewport,
): TranslationLayout {
  const isHeading = block.type === 'title' || block.type === 'subtitle'
  const xScale = block.sourcePageWidth
    ? viewport.width / block.sourcePageWidth
    : scale
  const yScale = block.sourcePageHeight
    ? viewport.height / block.sourcePageHeight
    : scale
  const unitScale = Math.min(xScale, yScale)
  const left = block.bbox.x * xScale
  const top = block.bbox.y * yScale
  const width = Math.max(
    48,
    Math.min(block.bbox.width * xScale, viewport.width - left - 8),
  )
  const height = Math.max(
    20,
    Math.min(block.bbox.height * yScale, viewport.height - top - 8),
  )
  const compactBlock = height <= 42 || width <= 150
  const paddingX = isHeading ? (compactBlock ? 8 : 10) : (compactBlock ? 5 : 8)
  const paddingY = isHeading ? (compactBlock ? 4 : 6) : (compactBlock ? 2.5 : 5)
  const contentWidth = Math.max(24, width - paddingX * 2)
  const fontFamily = block.style.fontFamily || 'serif'
  const translatedText = block.translated || ''
  const preferredFontSize = Math.max(
    isHeading ? 11 : 8,
    Math.min(
      block.style.fontSize * unitScale * (isHeading ? 0.86 : 0.76),
      isHeading ? 28 : 20,
    ),
  )
  const minFontSize = Math.min(preferredFontSize, isHeading ? 7.2 : 4.4)
  const absoluteMinFontSize = isHeading ? 6.4 : 3.8
  const lineHeightRatio = isHeading
    ? (compactBlock ? 1.16 : 1.22)
    : (compactBlock ? 1.2 : 1.28)
  const targetHeight = height
  let low = minFontSize
  let high = preferredFontSize
  let bestFontSize = minFontSize
  let bestLineHeight = minFontSize * lineHeightRatio

  for (let i = 0; i < 10; i++) {
    const candidateFontSize = (low + high) / 2
    const candidateLineHeight = candidateFontSize * lineHeightRatio
    const wrappedLines = wrapTextToWidth(
      translatedText,
      contentWidth,
      candidateFontSize,
      fontFamily,
    )
    const totalHeight = wrappedLines.length * candidateLineHeight + paddingY * 2 + 2

    if (totalHeight <= targetHeight) {
      bestFontSize = candidateFontSize
      bestLineHeight = candidateLineHeight
      low = candidateFontSize
    } else {
      high = candidateFontSize
    }
  }

  let wrappedLines = wrapTextToWidth(translatedText, contentWidth, bestFontSize, fontFamily)
  let measuredHeight = wrappedLines.length * bestLineHeight + paddingY * 2 + 2

  while (measuredHeight > targetHeight && bestFontSize > absoluteMinFontSize) {
    bestFontSize = Math.max(absoluteMinFontSize, bestFontSize - 0.35)
    bestLineHeight = bestFontSize * lineHeightRatio
    wrappedLines = wrapTextToWidth(translatedText, contentWidth, bestFontSize, fontFamily)
    measuredHeight = wrappedLines.length * bestLineHeight + paddingY * 2 + 2
  }

  if (measuredHeight > targetHeight && !isHeading) {
    bestLineHeight = Math.max(bestFontSize * 1.14, bestLineHeight - 1)
    measuredHeight = wrappedLines.length * bestLineHeight + paddingY * 2 + 2
  }

  return {
    left,
    top,
    width,
    height,
    fontSize: bestFontSize,
    lineHeight: bestLineHeight,
    paddingX,
    paddingY,
  }
}

// 单个页面组件
function PDFPage({
  page,
  scale,
  documentId,
  blocks,
  showTranslation,
  pageMode = 'source',
  showTextLayer = true,
  interactive = true,
  annotations,
  onAnnotationAdd,
  onAnnotationDelete,
  onAnnotationUpdate,
  focusTarget,
}: {
  page: PDFPageProxy
  scale: number
  documentId?: string
  blocks?: TextBlock[]
  showTranslation?: boolean
  pageMode?: 'source' | 'translated'
  showTextLayer?: boolean
  interactive?: boolean
  annotations?: PDFAnnotation[]
  onAnnotationAdd?: (annotation: PDFAnnotation) => void
  onAnnotationDelete?: (id: string) => void
  onAnnotationUpdate?: (annotation: PDFAnnotation) => void
  focusTarget?: GuideFocusTarget | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(false)
  const [selection, setSelection] = useState<{ text: string; rects: DOMRect[] } | null>(null)
  const [showHighlightMenu, setShowHighlightMenu] = useState(false)
  const [highlightPosition, setHighlightPosition] = useState({ x: 0, y: 0 })
  const [noteMenuOpen, setNoteMenuOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSelectedColor, setNoteSelectedColor] = useState<HighlightColor>('yellow')
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [freeNoteDraft, setFreeNoteDraft] = useState<{
    annotationId?: string
    x: number
    y: number
    rect: { x: number; y: number; width: number; height: number }
  } | null>(null)
  const freeNoteDismissRef = useRef(false)

  const focusedBlock = useMemo(() => {
    if (!focusTarget || focusTarget.pageNum !== page.pageNumber || !blocks?.length) {
      return null
    }

    return blocks.find(block => block.id === focusTarget.blockId) || null
  }, [blocks, focusTarget, page.pageNumber])

  // 获取设备像素比
  const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  // 渲染页面
  useEffect(() => {
    let cancelled = false
    let canvasRenderTask: { promise: Promise<void>; cancel?: () => void } | null = null
    let textLayerRenderTask: { promise: Promise<void>; cancel?: () => void } | null = null

    async function render() {
      if (!canvasRef.current) return
      if (showTextLayer && !textLayerRef.current) return

      setRendered(false)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      const textLayer = textLayerRef.current
      const outputScale = pixelRatio || 1
      const pdfjs = await getPdfjs()

      canvas.width = Math.ceil(viewport.width * outputScale)
      canvas.height = Math.ceil(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)

      if (textLayer) {
        textLayer.replaceChildren()
        textLayer.style.width = `${viewport.width}px`
        textLayer.style.height = `${viewport.height}px`
        textLayer.style.setProperty('--scale-factor', `${scale}`)
      }

      canvasRenderTask = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      })
      await canvasRenderTask.promise

      if (cancelled) return

      if (showTextLayer && textLayer) {
        const textContent = await page.getTextContent()
        if (cancelled) return

        textLayerRenderTask = pdfjs.renderTextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
          textDivs: [],
          textDivProperties: new WeakMap(),
        })
        await textLayerRenderTask.promise

        if (cancelled) return
      }

      setRendered(true)
    }

    render()

    return () => {
      cancelled = true
      canvasRenderTask?.cancel?.()
      textLayerRenderTask?.cancel?.()
    }
  }, [page, scale, pixelRatio, showTextLayer])

  // 文本选择处理
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!interactive) return
    // 点击菜单内部时不触发
    if (menuRef.current?.contains(e.target as Node)) return

    window.requestAnimationFrame(() => {
      const selected = window.getSelection()
      if (!selected || selected.isCollapsed) {
        setSelection(null)
        setShowHighlightMenu(false)
        setNoteMenuOpen(false)
        setNoteText('')
        return
      }

      const text = selected.toString().trim()
      if (!text) {
        setSelection(null)
        setShowHighlightMenu(false)
        setNoteMenuOpen(false)
        setNoteText('')
        return
      }

      const range = selected.getRangeAt(0)
      const rects = Array.from(range.getClientRects())

      if (rects.length > 0 && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect()
        const anchorRect = rects[rects.length - 1]
        const nextX = Math.min(
          Math.max(anchorRect.right - containerRect.left + 10, 8),
          Math.max(containerRef.current.clientWidth - 210, 8),
        )
        const nextY = Math.min(
          Math.max(anchorRect.top - containerRect.top - 6, 8),
          Math.max(containerRef.current.clientHeight - 52, 8),
        )

        setSelection({ text, rects })
        setFreeNoteDraft(null)
        setHighlightPosition({
          x: nextX,
          y: nextY,
        })
        setShowHighlightMenu(true)
      }
    })
  }, [interactive])

  // 从选区计算坐标
  const buildRectsFromSelection = useCallback(() => {
    if (!selection || !canvasRef.current) return null
    const viewportRect = canvasRef.current.getBoundingClientRect()
    return selection.rects.map(rect => ({
      x: (rect.left - viewportRect.left) / scale,
      y: (rect.top - viewportRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    }))
  }, [selection, scale])

  // 添加高亮
  const handleAddHighlight = useCallback(async (color: HighlightColor) => {
    if (!selection || !canvasRef.current) return
    const rects = buildRectsFromSelection()
    if (!rects) return

    const annotation: PDFAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      documentId: documentId || '',
      type: 'highlight',
      pageNum: page.pageNumber,
      selectedText: selection.text,
      startOffset: 0,
      endOffset: selection.text.length,
      rects,
      color,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveAnnotation(annotation)
    onAnnotationAdd?.(annotation)
    setShowHighlightMenu(false)
    setNoteMenuOpen(false)
    setNoteText('')
    setFreeNoteDraft(null)
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [selection, page.pageNumber, documentId, onAnnotationAdd, buildRectsFromSelection])

  // 添加笔记（带高亮 + 文字内容）
  const handleAddNote = useCallback(async () => {
    if (!selection || !canvasRef.current) return
    const rects = buildRectsFromSelection()
    if (!rects) return

    const annotation: PDFAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      documentId: documentId || '',
      type: 'note',
      pageNum: page.pageNumber,
      selectedText: selection.text,
      startOffset: 0,
      endOffset: selection.text.length,
      rects,
      color: noteSelectedColor,
      content: noteText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveAnnotation(annotation)
    onAnnotationAdd?.(annotation)
    setShowHighlightMenu(false)
    setNoteMenuOpen(false)
    setNoteText('')
    setNoteSelectedColor('yellow')
    setFreeNoteDraft(null)
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [selection, page.pageNumber, documentId, onAnnotationAdd, buildRectsFromSelection, noteText, noteSelectedColor])

  const resetFreeNoteDraft = useCallback(() => {
    setFreeNoteDraft(null)
    setNoteText('')
    setNoteSelectedColor('yellow')
    freeNoteDismissRef.current = false
  }, [])

  const handleAddFreeNote = useCallback(async () => {
    if (!freeNoteDraft || !canvasRef.current || !noteText.trim()) return

    if (freeNoteDraft.annotationId) {
      const existingAnnotation = annotations?.find(annotation => annotation.id === freeNoteDraft.annotationId)
      const updatedAnnotation: PDFAnnotation = {
        id: freeNoteDraft.annotationId,
        documentId: documentId || '',
        type: 'note',
        pageNum: page.pageNumber,
        selectedText: '',
        startOffset: 0,
        endOffset: 0,
        rects: [freeNoteDraft.rect],
        color: noteSelectedColor,
        content: noteText,
        createdAt: existingAnnotation?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      await updateAnnotation(freeNoteDraft.annotationId, {
        color: noteSelectedColor,
        content: noteText,
        rects: [freeNoteDraft.rect],
      })
      onAnnotationUpdate?.(updatedAnnotation)
      resetFreeNoteDraft()
      return
    }

    const annotation: PDFAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      documentId: documentId || '',
      type: 'note',
      pageNum: page.pageNumber,
      selectedText: '',
      startOffset: 0,
      endOffset: 0,
      rects: [freeNoteDraft.rect],
      color: noteSelectedColor,
      content: noteText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveAnnotation(annotation)
    onAnnotationAdd?.(annotation)
    resetFreeNoteDraft()
  }, [annotations, documentId, freeNoteDraft, noteSelectedColor, noteText, onAnnotationAdd, onAnnotationUpdate, page.pageNumber, resetFreeNoteDraft])

  const handleEditFreeNote = useCallback((annotation: PDFAnnotation) => {
    const rect = annotation.rects[0]
    if (!rect || !containerRef.current) return

    setActiveNoteId(null)
    setShowHighlightMenu(false)
    setSelection(null)
    setNoteMenuOpen(false)
    setNoteText(annotation.content || '')
    setNoteSelectedColor(annotation.color)
    setFreeNoteDraft({
      annotationId: annotation.id,
      x: rect.x * scale,
      y: rect.y * scale,
      rect,
    })
  }, [scale])

  const handleDeleteFreeNote = useCallback(() => {
    if (!freeNoteDraft?.annotationId) {
      resetFreeNoteDraft()
      return
    }

    onAnnotationDelete?.(freeNoteDraft.annotationId)
    resetFreeNoteDraft()
  }, [freeNoteDraft?.annotationId, onAnnotationDelete, resetFreeNoteDraft])

  const handleBlankAreaDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive) return
    if (menuRef.current?.contains(event.target as Node)) return
    if (selection) return
    if (window.getSelection()?.toString().trim()) return

    const target = event.target as HTMLElement
    if (target.closest('[data-annotation-hit="true"]')) return
    if (target.tagName.toLowerCase() === 'span' && target.closest('.pdf-text-layer')) return

    if (!containerRef.current) return

    const containerRect = containerRef.current.getBoundingClientRect()
    const clickX = event.clientX - containerRect.left
    const clickY = event.clientY - containerRect.top

    setActiveNoteId(null)
    setShowHighlightMenu(false)
    setNoteMenuOpen(false)
    setSelection(null)
    setNoteText('')
    setFreeNoteDraft({
      x: Math.min(Math.max(clickX, 8), Math.max(containerRef.current.clientWidth - 248, 8)),
      y: Math.min(Math.max(clickY, 8), Math.max(containerRef.current.clientHeight - 156, 8)),
      rect: {
        x: Math.max(clickX / scale, 0),
        y: Math.max(clickY / scale, 0),
        width: 236 / scale,
        height: 148 / scale,
      },
    })
  }, [interactive, scale, selection])

  const viewport = page.getViewport({ scale })
  const activeNoteAnnotation = annotations?.find(annotation => annotation.id === activeNoteId && annotation.content)
  const activeNoteAnchorRect = activeNoteAnnotation?.rects[0]

  // 渲染翻译覆盖层
  const pageBlocks = blocks?.filter(
    b => b.pageNum === page.pageNumber
      && b.translated
      && showTranslation
      && b.sourceLabel !== 'Picture',
  ) || []
  const translationLayouts = showTranslation
    ? pageBlocks.map(block => ({
      block,
      layout: buildTranslationLayout(block, scale, viewport),
    }))
    : []

  return (
    <div
      ref={containerRef}
      className={`pdf-page relative shadow-lg ${pageMode === 'translated' ? 'bg-[#fcfcfa]' : 'bg-white'}`}
      style={{ width: viewport.width, height: viewport.height }}
      onMouseUp={interactive ? handleMouseUp : undefined}
      onDoubleClick={interactive ? handleBlankAreaDoubleClick : undefined}
    >
      <canvas
        ref={canvasRef}
        className="pdf-canvas block"
        style={pageMode === 'translated'
          ? { opacity: 0.22, filter: 'grayscale(1) brightness(1.08) contrast(0.92)' }
          : undefined}
      />

      <div
        ref={textLayerRef}
        className={`pdf-text-layer absolute inset-0 overflow-hidden z-2 ${showTextLayer ? 'select-text' : 'pointer-events-none opacity-0'}`}
      />

      <div className="absolute inset-0 overflow-hidden pointer-events-none z-3">
        {annotations?.map(annotation => (
          annotation.rects.map((rect, rectIndex) => {
            const isNote = annotation.type === 'note' && Boolean(annotation.content)
            const isPointNote = isNote && !annotation.selectedText
            return (
              isPointNote ? (
                <div
                  key={`${annotation.id}-${rectIndex}`}
                  data-annotation-hit="true"
                  className="absolute pointer-events-auto"
                  style={{
                    left: rect.x * scale,
                    top: rect.y * scale,
                    width: rect.width * scale,
                    minHeight: rect.height * scale,
                  }}
                  title="双击编辑文本批注"
                  onDoubleClick={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    handleEditFreeNote(annotation)
                  }}
                >
                  <div
                    className="text-xs leading-relaxed whitespace-pre-wrap wrap-break-word"
                    style={{
                      color: HIGHLIGHT_COLORS[annotation.color].border,
                      textShadow: '0 1px 2px rgba(255,255,255,0.8)',
                    }}
                  >
                    {annotation.content}
                  </div>
                </div>
              ) : (
                <button
                  key={`${annotation.id}-${rectIndex}`}
                  type="button"
                  data-annotation-hit="true"
                  className={`absolute rounded-sm transition-opacity ${isNote ? 'pointer-events-auto cursor-pointer hover:opacity-90' : 'pointer-events-none'}`}
                  style={{
                    left: rect.x * scale,
                    top: rect.y * scale,
                    width: rect.width * scale,
                    height: rect.height * scale,
                    backgroundColor: HIGHLIGHT_COLORS[annotation.color].bg,
                    borderRadius: 3,
                    boxShadow: `inset 0 0 0 1px ${HIGHLIGHT_COLORS[annotation.color].border}`,
                  }}
                  title={isNote ? '点击查看批注' : undefined}
                  onClick={event => {
                    if (isNote) {
                      event.preventDefault()
                      event.stopPropagation()
                      setActiveNoteId(current => current === annotation.id ? null : annotation.id)
                    }
                  }}
                />
              )
            )
          })
        ))}

        {activeNoteAnnotation && activeNoteAnchorRect && (
          <Popover
            isOpen
            placement="top"
            showArrow
            offset={12}
            onOpenChange={open => {
              if (!open) {
                setActiveNoteId(null)
              }
            }}
          >
            <PopoverTrigger>
              <button
                type="button"
                aria-label="annotation-note-anchor"
                className="absolute opacity-0 pointer-events-none"
                style={{
                  left: activeNoteAnchorRect.x * scale,
                  top: activeNoteAnchorRect.y * scale,
                  width: Math.max(activeNoteAnchorRect.width * scale, 1),
                  height: Math.max(activeNoteAnchorRect.height * scale, 1),
                }}
              />
            </PopoverTrigger>
            <PopoverContent className="max-w-72 bg-[#161a23] border border-[#2b3242] px-3 py-2">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: HIGHLIGHT_COLORS[activeNoteAnnotation.color].border }}
                  />
                  <span>第 {activeNoteAnnotation.pageNum} 页批注</span>
                </div>
                <p className="text-xs leading-relaxed text-gray-200">
                  {activeNoteAnnotation.content}
                </p>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* 翻译覆盖层 */}
      {translationLayouts.map(({ block, layout }) => {

        return (
          <div
            key={block.id}
            className="translation-overlay"
            data-block-id={block.id}
            style={{
              position: 'absolute',
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
              fontSize: `${layout.fontSize}px`,
              color: '#1a1a1a',
              backgroundColor: pageMode === 'translated' ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.92)',
              padding: `${layout.paddingY}px ${layout.paddingX}px`,
              borderRadius: '4px',
              pointerEvents: 'none',
              zIndex: 10,
              lineHeight: `${layout.lineHeight}px`,
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.08)',
              border: '1px solid rgba(148, 163, 184, 0.12)',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
              hyphens: 'auto',
              fontWeight: block.type === 'title' || block.type === 'subtitle' ? 600 : 400,
            }}
          >
            {block.translated}
          </div>
        )
      })}

      {focusedBlock && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: focusedBlock.bbox.x * scale,
            top: focusedBlock.bbox.y * scale,
            width: focusedBlock.bbox.width * scale,
            height: focusedBlock.bbox.height * scale,
          }}
        >
          <div className="absolute inset-0 rounded-md border-2 border-sky-400/80 bg-sky-300/12 shadow-[0_0_0_4px_rgba(56,189,248,0.18)] animate-pulse" />
          {(focusTarget?.title || focusTarget?.note) && (
            <div
              className="absolute left-0 max-w-72 rounded-xl border border-sky-400/30 bg-[#0f172ae6] px-3 py-2 text-white shadow-xl"
              style={{
                top: focusedBlock.bbox.y * scale > 96
                  ? -10
                  : focusedBlock.bbox.height * scale + 10,
                transform: focusedBlock.bbox.y * scale > 96 ? 'translateY(-100%)' : 'none',
              }}
            >
              {focusTarget.title && (
                <p className="text-xs font-medium text-sky-200">{focusTarget.title}</p>
              )}
              {focusTarget.note && (
                <p className="mt-1 text-[11px] leading-relaxed text-slate-200">{focusTarget.note}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 高亮 & 笔记菜单 */}
      {showHighlightMenu && selection && (
        <div
          ref={menuRef}
          className="highlight-menu absolute bg-[#1e1e2e] border border-gray-700 rounded-xl shadow-2xl p-2 z-50"
          style={{
            left: highlightPosition.x,
            top: highlightPosition.y,
            minWidth: '190px',
            maxWidth: '260px',
          }}
        >
          {/* 快速高亮颜色行 */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 mr-1">高亮</span>
            {(['yellow', 'green', 'blue', 'pink', 'purple'] as HighlightColor[]).map(color => (
              <button
                key={color}
                className="w-5 h-5 rounded-full border-2 border-transparent hover:border-white hover:scale-110 transition-all"
                style={{ backgroundColor: HIGHLIGHT_COLORS[color].border }}
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleAddHighlight(color)}
                title={`高亮 (${color})`}
              />
            ))}
            <div className="w-px h-4 bg-gray-600 mx-1" />
            <button
              className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs transition-colors ${
                noteMenuOpen
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => setNoteMenuOpen(v => !v)}
              title="添加笔记"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/>
              </svg>
            </button>
          </div>

          {/* 笔记输入区 */}
          {noteMenuOpen && (
            <div className="mt-2 border-t border-gray-700 pt-2">
              <p className="text-[10px] text-gray-500 mb-1.5 line-clamp-2">
                &ldquo;{selection.text.slice(0, 80)}{selection.text.length > 80 ? '…' : ''}&rdquo;
              </p>
              <textarea
                className="w-full bg-[#2a2a3e] text-gray-100 text-xs rounded-lg px-2.5 py-2 resize-none focus:outline-none border border-gray-600 focus:border-blue-500 placeholder-gray-600"
                rows={3}
                placeholder="写下你的想法..."
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                autoFocus
              />
              <div className="flex items-center gap-1 mt-1.5">
                <div className="flex gap-1">
                  {(['yellow', 'green', 'blue', 'pink', 'purple'] as HighlightColor[]).map(color => (
                    <button
                      key={color}
                      className={`w-4 h-4 rounded-full transition-all ${
                        noteSelectedColor === color
                          ? 'ring-2 ring-white ring-offset-1 ring-offset-[#1e1e2e] scale-110'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: HIGHLIGHT_COLORS[color].border }}
                      onMouseDown={e => e.preventDefault()}
                      title={color}
                      onClick={() => setNoteSelectedColor(color)}
                    />
                  ))}
                </div>
                <div className="flex-1" />
                <button
                  className="text-[11px] text-gray-400 hover:text-gray-200 px-2 py-0.5 rounded transition-colors"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setNoteMenuOpen(false); setNoteText('') }}
                >
                  取消
                </button>
                <button
                  className="text-[11px] bg-blue-600 hover:bg-blue-500 text-white rounded px-2.5 py-0.5 transition-colors"
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleAddNote}
                >
                  保存
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {freeNoteDraft && (
        <div
          ref={menuRef}
          className="absolute z-50 rounded-xl border border-gray-300 bg-white shadow-xl"
          style={{
            left: freeNoteDraft.x,
            top: freeNoteDraft.y,
            width: freeNoteDraft.rect.width * scale,
            minHeight: freeNoteDraft.rect.height * scale,
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-2 py-1.5">
            <div className="flex gap-1">
              {(['yellow', 'green', 'blue', 'pink', 'purple'] as HighlightColor[]).map(color => (
                <button
                  key={color}
                  className={`w-4 h-4 rounded-full transition-all ${
                    noteSelectedColor === color
                      ? 'ring-2 ring-white ring-offset-1 ring-offset-[#1e1e2e] scale-110'
                      : 'opacity-60 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: HIGHLIGHT_COLORS[color].border }}
                  onMouseDown={e => e.preventDefault()}
                  title={color}
                  onClick={() => setNoteSelectedColor(color)}
                />
              ))}
            </div>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              onMouseDown={e => {
                e.preventDefault()
                freeNoteDismissRef.current = true
              }}
              onClick={handleDeleteFreeNote}
              title={freeNoteDraft.annotationId ? '删除' : '关闭'}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z" />
              </svg>
            </button>
          </div>

          <textarea
            className="w-full resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-gray-300"
            rows={5}
            placeholder="输入批注..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            style={{ color: HIGHLIGHT_COLORS[noteSelectedColor].border }}
            autoFocus
            onBlur={() => {
              if (freeNoteDismissRef.current) {
                freeNoteDismissRef.current = false
                return
              }

              if (noteText.trim()) {
                void handleAddFreeNote()
                return
              }

              resetFreeNoteDraft()
            }}
          />
        </div>
      )}

      {/* 加载指示器 */}
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/50">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      )}
    </div>
  )
}

export default function PDFViewer({
  pdfData,
  scale,
  documentId,
  currentPage = 1,
  onPageChange,
  onTotalPagesChange,
  blocks,
  showTranslation = false,
  annotations = [],
  onAnnotationAdd,
  onAnnotationDelete,
  onAnnotationUpdate,
  jumpToBlock,
  focusTarget,
  translationDisplayMode = 'overlay',
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scrollReleaseTimerRef = useRef<number | null>(null)
  const suppressPageSyncRef = useRef(false)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PDFPageProxy[]>([])
  const [visiblePage, setVisiblePage] = useState(1)

  const releasePageSync = useCallback(() => {
    if (scrollReleaseTimerRef.current !== null) {
      window.clearTimeout(scrollReleaseTimerRef.current)
    }

    scrollReleaseTimerRef.current = window.setTimeout(() => {
      suppressPageSyncRef.current = false
    }, 140)
  }, [])

  const scrollToPage = useCallback((pageNum: number, behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current
    if (!container) return false

    const pageEl = container.querySelector(`[data-page-number="${pageNum}"]`) as HTMLElement | null
    if (!pageEl) return false

    suppressPageSyncRef.current = true
    container.scrollTo({
      top: Math.max(pageEl.offsetTop - 16, 0),
      behavior,
    })
    setVisiblePage(pageNum)
    releasePageSync()
    return true
  }, [releasePageSync])

  // 加载 PDF
  useEffect(() => {
    let mounted = true
    async function loadPDF() {
      try {
        const pdfjs = await getPdfjs()
        const doc = await pdfjs.getDocument({ data: pdfData }).promise
        if (mounted) {
          setPdfDoc(doc)
          onTotalPagesChange?.(doc.numPages)

          // 预加载所有页面
          const loadedPages: PDFPageProxy[] = []
          for (let i = 1; i <= doc.numPages; i++) {
            const p = await doc.getPage(i)
            loadedPages.push(p)
          }
          if (mounted) {
            setPages(loadedPages)
          }
        }
      } catch (err) {
        console.error('加载 PDF 失败:', err)
      }
    }
    loadPDF()
    return () => { mounted = false }
  }, [pdfData, onTotalPagesChange])

  // 监听滚动更新当前页码
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const pageElements = container.querySelectorAll('.pdf-page-spread')
      const containerRect = container.getBoundingClientRect()
      const containerCenter = containerRect.top + containerRect.height / 2

      let closestPage = 1
      let minDistance = Infinity

      pageElements.forEach((el, index) => {
        const rect = el.getBoundingClientRect()
        const pageCenter = rect.top + rect.height / 2
        const distance = Math.abs(pageCenter - containerCenter)
        if (distance < minDistance) {
          minDistance = distance
          closestPage = index + 1
        }
      })

      setVisiblePage(closestPage)
      if (!suppressPageSyncRef.current) {
        onPageChange?.(closestPage)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [pages.length, onPageChange])

  // 滚动到指定页
  useEffect(() => {
    if (currentPage && pages.length > 0 && currentPage !== visiblePage) {
      scrollToPage(currentPage, 'auto')
    }
  }, [currentPage, pages.length, scrollToPage, visiblePage])

  // 跳转到指定文本块
  useEffect(() => {
    if (jumpToBlock && containerRef.current) {
      const { blockId, pageNum } = jumpToBlock
      const container = containerRef.current
      const pageEl = container.querySelector(`[data-page-number="${pageNum}"]`)
      if (pageEl && scrollToPage(pageNum, 'auto')) {
        // 然后尝试高亮文本块
        setTimeout(() => {
          const blockEl = pageEl.querySelector(`[data-block-id="${blockId}"]`)
          if (blockEl) {
            blockEl.scrollIntoView({ block: 'center' })
            // 添加临时高亮效果
            blockEl.classList.add('block-highlight')
            setTimeout(() => blockEl.classList.remove('block-highlight'), 2000)
          }
        }, 300)
      }
    }
  }, [jumpToBlock, scrollToPage])

  useEffect(() => {
    return () => {
      if (scrollReleaseTimerRef.current !== null) {
        window.clearTimeout(scrollReleaseTimerRef.current)
      }
    }
  }, [])

  // 按页面分组的批注
  const annotationsByPage = new Map<number, PDFAnnotation[]>()
  annotations.forEach(ann => {
    const existing = annotationsByPage.get(ann.pageNum) || []
    existing.push(ann)
    annotationsByPage.set(ann.pageNum, existing)
  })

  return (
    <div
      ref={containerRef}
      className="pdf-viewer-container overflow-auto h-full"
      style={{ backgroundColor: '#525659' }}
    >
      <div className="pdf-pages-container flex flex-col items-center py-4">
        {pages.map((page, index) => (
          <div
            key={`page-${index + 1}`}
            data-page-number={index + 1}
            className={`pdf-page-spread mb-4 ${showTranslation && translationDisplayMode === 'parallel' ? 'flex items-start gap-6' : ''}`}
          >
            <PDFPage
              page={page}
              scale={scale}
              documentId={documentId}
              blocks={blocks}
              showTranslation={showTranslation && translationDisplayMode === 'overlay'}
              pageMode="source"
              showTextLayer
              interactive
              annotations={annotationsByPage.get(index + 1) || []}
              onAnnotationAdd={onAnnotationAdd}
              onAnnotationDelete={onAnnotationDelete}
              onAnnotationUpdate={onAnnotationUpdate}
              focusTarget={focusTarget}
            />

            {showTranslation && translationDisplayMode === 'parallel' && (
              <PDFPage
                page={page}
                scale={scale}
                documentId={documentId}
                blocks={blocks}
                showTranslation
                pageMode="translated"
                showTextLayer={false}
                interactive={false}
                annotations={[]}
                focusTarget={focusTarget}
              />
            )}
          </div>
        ))}
      </div>

      {/* 页码指示器 */}
      {pdfDoc && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-gray-800/90 text-white px-3 py-1 rounded-full text-sm z-40">
          {visiblePage} / {pdfDoc.numPages}
        </div>
      )}

      <style jsx global>{`
        .pdf-text-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
          line-height: 1;
          text-size-adjust: none;
          forced-color-adjust: none;
          transform-origin: 0 0;
        }

        .pdf-text-layer span,
        .pdf-text-layer br {
          position: absolute;
          color: transparent;
          white-space: pre;
          cursor: text;
          transform-origin: 0 0;
        }

        .pdf-text-layer span.markedContent {
          top: 0;
          height: 0;
        }

        .pdf-text-layer .endOfContent {
          display: block;
          position: absolute;
          left: 0;
          top: 100%;
          right: 0;
          bottom: 0;
          z-index: -1;
          cursor: default;
          user-select: none;
        }

        .pdf-text-layer ::selection {
          background: rgba(59, 130, 246, 0.35);
        }
      `}</style>
    </div>
  )
}

export { getPdfjs }
