'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TextBlock, PDFAnnotation, HIGHLIGHT_COLORS, HighlightColor } from '@/lib/types'
import { saveAnnotation } from '@/lib/pdfCache'

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
}

interface TranslationLayout {
  left: number
  top: number
  width: number
  height: number
  fontSize: number
  lineHeight: number
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

function wrapTextToWidth(text: string, width: number, fontSize: number, fontFamily: string) {
  const context = getTranslationMeasureContext()
  if (!context || width <= 0) {
    return text.split(/\n+/).filter(Boolean)
  }

  context.font = `${fontSize}px ${fontFamily}`
  const paragraphs = text.split(/\n+/).filter(Boolean)
  const lines: string[] = []

  paragraphs.forEach(paragraph => {
    let current = ''
    for (const char of Array.from(paragraph)) {
      const candidate = `${current}${char}`
      if (current && context.measureText(candidate).width > width) {
        lines.push(current)
        current = char.trim() ? char : ''
      } else {
        current = candidate
      }
    }

    if (current.trim()) {
      lines.push(current)
    }
  })

  return lines.length > 0 ? lines : [text]
}

function buildTranslationLayout(block: TextBlock, scale: number, viewport: PDFViewport): TranslationLayout {
  const paddingX = 6
  const paddingY = 4
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
  const contentWidth = Math.max(24, width - paddingX * 2)
  const contentHeight = Math.max(12, height - paddingY * 2)
  const fontFamily = block.style.fontFamily || 'serif'
  const preferredFontSize = Math.max(
    10,
    Math.min(block.style.fontSize * unitScale * 0.82, contentHeight),
  )
  const minFontSize = Math.max(8, Math.min(12, preferredFontSize))
  let low = minFontSize
  let high = preferredFontSize
  let bestFontSize = minFontSize
  let bestLineHeight = minFontSize * 1.45

  for (let i = 0; i < 7; i++) {
    const candidateFontSize = (low + high) / 2
    const candidateLineHeight = candidateFontSize * 1.45
    const wrappedLines = wrapTextToWidth(
      block.translated || '',
      contentWidth,
      candidateFontSize,
      fontFamily,
    )
    const totalHeight = wrappedLines.length * candidateLineHeight

    if (totalHeight <= contentHeight) {
      bestFontSize = candidateFontSize
      bestLineHeight = candidateLineHeight
      low = candidateFontSize
    } else {
      high = candidateFontSize
    }
  }

  return {
    left,
    top,
    width,
    height,
    fontSize: bestFontSize,
    lineHeight: bestLineHeight / bestFontSize,
  }
}

// 单个页面组件
function PDFPage({
  page,
  scale,
  documentId,
  blocks,
  showTranslation,
  annotations,
  onAnnotationAdd,
}: {
  page: PDFPageProxy
  scale: number
  documentId?: string
  blocks?: TextBlock[]
  showTranslation?: boolean
  annotations?: PDFAnnotation[]
  onAnnotationAdd?: (annotation: PDFAnnotation) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const highlightLayerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(false)
  const [selection, setSelection] = useState<{ text: string; rects: DOMRect[] } | null>(null)
  const [showHighlightMenu, setShowHighlightMenu] = useState(false)
  const [highlightPosition, setHighlightPosition] = useState({ x: 0, y: 0 })

  // 获取设备像素比
  const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1

  // 渲染页面
  useEffect(() => {
    let cancelled = false
    let canvasRenderTask: { promise: Promise<void>; cancel?: () => void } | null = null
    let textLayerRenderTask: { promise: Promise<void>; cancel?: () => void } | null = null

    async function render() {
      if (!canvasRef.current || !textLayerRef.current) return

      setRendered(false)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      const textLayer = textLayerRef.current
      const highlightLayer = highlightLayerRef.current
      const outputScale = pixelRatio || 1
      const pdfjs = await getPdfjs()

      canvas.width = Math.ceil(viewport.width * outputScale)
      canvas.height = Math.ceil(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)

      textLayer.replaceChildren()
      textLayer.style.width = `${viewport.width}px`
      textLayer.style.height = `${viewport.height}px`
      textLayer.style.setProperty('--scale-factor', `${scale}`)

      if (highlightLayer) {
        highlightLayer.replaceChildren()
        highlightLayer.style.width = `${viewport.width}px`
        highlightLayer.style.height = `${viewport.height}px`
      }

      canvasRenderTask = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      })
      await canvasRenderTask.promise

      if (cancelled) return

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

      setRendered(true)
    }

    render()

    return () => {
      cancelled = true
      canvasRenderTask?.cancel?.()
      textLayerRenderTask?.cancel?.()
    }
  }, [page, scale, pixelRatio])

  // 渲染高亮
  useEffect(() => {
    if (!highlightLayerRef.current) return

    const highlightLayer = highlightLayerRef.current
    highlightLayer.replaceChildren()
    if (!annotations?.length) return

    annotations.forEach(ann => {
      ann.rects.forEach(rect => {
        const div = document.createElement('div')
        div.className = 'highlight-rect'
        div.style.cssText = `
          position: absolute;
          left: ${rect.x * scale}px;
          top: ${rect.y * scale}px;
          width: ${rect.width * scale}px;
          height: ${rect.height * scale}px;
          background-color: ${HIGHLIGHT_COLORS[ann.color].bg};
          border-left: 3px solid ${HIGHLIGHT_COLORS[ann.color].border};
          pointer-events: none;
        `
        div.dataset.annotationId = ann.id
        highlightLayer.appendChild(div)
      })
    })
  }, [annotations, scale])

  // 文本选择处理
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed) {
      setSelection(null)
      setShowHighlightMenu(false)
      return
    }

    const text = selected.toString().trim()
    if (!text) {
      setSelection(null)
      setShowHighlightMenu(false)
      return
    }

    const range = selected.getRangeAt(0)
    const rects = Array.from(range.getClientRects())

    if (rects.length > 0 && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect()
      setSelection({ text, rects })
      setHighlightPosition({
        x: rects[0].left - containerRect.left + rects[0].width / 2,
        y: rects[0].top - containerRect.top - 40,
      })
      setShowHighlightMenu(true)
    }
  }, [])

  // 添加高亮
  const handleAddHighlight = useCallback(async (color: HighlightColor) => {
    if (!selection || !canvasRef.current) return

    const viewportRect = canvasRef.current.getBoundingClientRect()

    const rects = selection.rects.map(rect => ({
      x: (rect.left - viewportRect.left) / scale,
      y: (rect.top - viewportRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    }))

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
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [selection, page.pageNumber, scale, documentId, onAnnotationAdd])

  const viewport = page.getViewport({ scale })

  // 渲染翻译覆盖层
  const pageBlocks = blocks?.filter(b => b.pageNum === page.pageNumber && b.translated && showTranslation) || []

  return (
    <div
      ref={containerRef}
      className="pdf-page relative bg-white shadow-lg mb-4"
      style={{ width: viewport.width, height: viewport.height }}
      onMouseUp={handleMouseUp}
    >
      <canvas ref={canvasRef} className="pdf-canvas block" />
      
      <div
        ref={highlightLayerRef}
        className="absolute inset-0 overflow-hidden pointer-events-none z-[1]"
      />

      <div
        ref={textLayerRef}
        className="pdf-text-layer absolute inset-0 overflow-hidden select-text z-[2]"
      />

      {/* 翻译覆盖层 */}
      {pageBlocks.map(block => {
        const layout = buildTranslationLayout(block, scale, viewport)

        return (
          <div
            key={block.id}
            className="translation-overlay"
            style={{
              position: 'absolute',
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
              fontSize: `${layout.fontSize}px`,
              color: '#1a1a1a',
              backgroundColor: 'rgba(255, 255, 255, 0.92)',
              padding: '4px 6px',
              borderRadius: '3px',
              pointerEvents: 'none',
              zIndex: 10,
              lineHeight: layout.lineHeight,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontWeight: block.type === 'title' || block.type === 'subtitle' ? 600 : 400,
            }}
          >
            {block.translated}
          </div>
        )
      })}

      {/* 高亮菜单 */}
      {showHighlightMenu && selection && (
        <div
          className="highlight-menu absolute bg-gray-800 rounded-lg shadow-xl flex items-center gap-1 p-1 z-50"
          style={{
            left: highlightPosition.x,
            top: highlightPosition.y,
            transform: 'translateX(-50%)',
          }}
        >
          {(['yellow', 'green', 'blue', 'pink', 'purple'] as HighlightColor[]).map(color => (
            <button
              key={color}
              className="w-6 h-6 rounded-full border-2 border-white hover:scale-110 transition-transform"
              style={{ backgroundColor: HIGHLIGHT_COLORS[color].border }}
              onClick={() => handleAddHighlight(color)}
            />
          ))}
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
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PDFPageProxy[]>([])
  const [visiblePage, setVisiblePage] = useState(1)

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
      const pageElements = container.querySelectorAll('.pdf-page')
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
      onPageChange?.(closestPage)
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [pages.length, onPageChange])

  // 滚动到指定页
  useEffect(() => {
    if (currentPage && containerRef.current) {
      const pageEl = containerRef.current.querySelector(`.pdf-page:nth-child(${currentPage})`)
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [currentPage])

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
          <PDFPage
            key={`page-${index + 1}`}
            page={page}
            scale={scale}
            documentId={documentId}
            blocks={blocks}
            showTranslation={showTranslation}
            annotations={annotationsByPage.get(index + 1) || []}
            onAnnotationAdd={onAnnotationAdd}
          />
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
