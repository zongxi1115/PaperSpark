'use client'

import { Icon } from '@iconify/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GuideFocusTarget, HighlightColor, PDFAnnotation, TextBlock } from '@/lib/types'
import { saveAnnotation } from '@/lib/pdfCache'
import SelectionToolbar from './SelectionToolbar'

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

interface PDFJSLib {
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PDFDocumentProxy> }
  GlobalWorkerOptions: { workerSrc: string }
}

interface HTMLReaderProps {
  pdfBlob: Blob
  documentId?: string
  scale: number
  currentPage?: number
  onPageChange?: (page: number) => void
  onTotalPagesChange?: (total: number) => void
  blocks?: TextBlock[]
  showTranslation?: boolean
  translationDisplayMode?: 'overlay' | 'parallel'
  jumpToBlock?: { blockId: string; pageNum: number } | null
  focusTarget?: GuideFocusTarget | null
  onAskSelection?: (selection: { text: string; pageNum: number; blockId?: string }) => void
  onAnnotationAdd?: (annotation: PDFAnnotation) => void
}

const PAGE_IMAGE_RENDER_SCALE = 1.8

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
      const nextWin = window as unknown as { pdfjsLib?: PDFJSLib }
      if (nextWin.pdfjsLib) {
        nextWin.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
        resolve(nextWin.pdfjsLib)
      } else {
        reject(new Error('PDF.js 加载失败'))
      }
    }
    script.onerror = () => reject(new Error('PDF.js 脚本加载失败'))
    document.head.appendChild(script)
  })

  return pdfjsPromise
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function sortBlocks(blocks: TextBlock[]) {
  return [...blocks].sort((left, right) => {
    if (left.pageNum !== right.pageNum) return left.pageNum - right.pageNum
    if ((left.order ?? 0) !== (right.order ?? 0)) return (left.order ?? 0) - (right.order ?? 0)
    if (left.bbox.y !== right.bbox.y) return left.bbox.y - right.bbox.y
    return left.bbox.x - right.bbox.x
  })
}

function normalizeBlockText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim()
}

function getZoomRatio(scale: number) {
  return clamp(scale / 1.2, 0.78, 1.72)
}

function normalizeWrappedText(text: string) {
  let normalized = normalizeBlockText(text)
  if (!normalized) return ''

  normalized = normalized
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, '$1$2')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')

  return normalized.trim()
}

function normalizeStructuredText(text: string) {
  const normalized = normalizeBlockText(text)
  if (!normalized) return ''

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map(part => normalizeWrappedText(part))
    .filter(Boolean)

  return paragraphs.join('\n\n')
}

function normalizeListText(text: string) {
  const normalized = normalizeBlockText(text)
  if (!normalized) return ''

  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length <= 1) {
    return normalizeWrappedText(normalized)
  }

  return lines.map(line => normalizeWrappedText(line)).join('\n')
}

function getReadableBlockText(block: TextBlock, preferTranslated = false) {
  const raw = preferTranslated ? (block.translated || '') : block.text
  if (!raw) return ''

  if (block.type === 'formula' || block.type === 'table') {
    return normalizeStructuredText(raw)
  }

  if (block.type === 'list') {
    return normalizeListText(raw)
  }

  return normalizeWrappedText(raw)
}

function getBlockTypography(block: TextBlock, zoomRatio: number) {
  const detectedFontSize = block.style.fontSize || 16

  if (block.type === 'title') {
    return {
      fontSize: `${clamp(detectedFontSize * 1.18 * zoomRatio, 28, 42)}px`,
      lineHeight: 1.12,
      letterSpacing: '-0.04em',
      fontWeight: 700,
    }
  }

  if (block.type === 'subtitle') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.96 * zoomRatio, 20, 30)}px`,
      lineHeight: 1.24,
      letterSpacing: '-0.025em',
      fontWeight: 640,
    }
  }

  if (block.type === 'caption') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.92 * zoomRatio, 12, 15)}px`,
      lineHeight: 1.55,
      letterSpacing: '0',
      fontWeight: 500,
    }
  }

  if (block.type === 'reference') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.9 * zoomRatio, 13, 15)}px`,
      lineHeight: 1.72,
      letterSpacing: '0',
      fontWeight: 500,
    }
  }

  if (block.type === 'formula' || block.type === 'table') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.96 * zoomRatio, 14, 18)}px`,
      lineHeight: 1.65,
      letterSpacing: '0',
      fontWeight: 520,
    }
  }

  if (block.type === 'header' || block.type === 'footer') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.82 * zoomRatio, 11, 13)}px`,
      lineHeight: 1.4,
      letterSpacing: '0.06em',
      fontWeight: 600,
    }
  }

  return {
    fontSize: `${clamp(detectedFontSize * 0.98 * zoomRatio, 15, 19)}px`,
    lineHeight: 1.8,
    letterSpacing: '0',
    fontWeight: 500,
  }
}

function getBlockWrapperClass(block: TextBlock) {
  if (block.sourceLabel === 'Picture') {
    return 'my-8'
  }

  switch (block.type) {
    case 'title':
      return 'mb-5 pt-1'
    case 'subtitle':
      return 'mt-8 mb-3'
    case 'caption':
      return 'mt-2 mb-6'
    case 'formula':
      return 'my-5 overflow-x-auto border-l-2 border-[#63728d] pl-4'
    case 'table':
      return 'my-5 overflow-x-auto border-l-2 border-white/10 pl-4'
    case 'reference':
      return 'my-2'
    case 'header':
    case 'footer':
      return 'my-2'
    default:
      return 'my-3'
  }
}

function getPictureCropStyle(block: TextBlock) {
  const sourcePageWidth = Math.max(block.sourcePageWidth || 1, 1)
  const sourcePageHeight = Math.max(block.sourcePageHeight || 1, 1)
  const cropWidthRatio = clamp(block.bbox.width / sourcePageWidth, 0.01, 1)
  const cropHeightRatio = clamp(block.bbox.height / sourcePageHeight, 0.01, 1)
  const cropLeftRatio = clamp(block.bbox.x / sourcePageWidth, 0, 1 - cropWidthRatio)
  const cropTopRatio = clamp(block.bbox.y / sourcePageHeight, 0, 1 - cropHeightRatio)

  return {
    aspectRatio: `${Math.max(block.bbox.width, 1)} / ${Math.max(block.bbox.height, 1)}`,
    image: {
      left: `-${(cropLeftRatio / cropWidthRatio) * 100}%`,
      top: `-${(cropTopRatio / cropHeightRatio) * 100}%`,
      width: `${100 / cropWidthRatio}%`,
      height: `${100 / cropHeightRatio}%`,
    },
  }
}

function HTMLReaderBlock({
  block,
  showTranslation,
  translationDisplayMode,
  zoomRatio,
  focused,
  pageImageSrc,
}: {
  block: TextBlock
  showTranslation: boolean
  translationDisplayMode: 'overlay' | 'parallel'
  zoomRatio: number
  focused: boolean
  pageImageSrc: string | null
}) {
  const originalText = getReadableBlockText(block, false)
  const translatedText = getReadableBlockText(block, true)
  const typography = getBlockTypography(block, zoomRatio)
  const baseWrapper = getBlockWrapperClass(block)

  if (block.sourceLabel === 'Picture') {
    const cropStyle = getPictureCropStyle(block)

    return (
      <div
        data-block-id={block.id}
        className={`${baseWrapper} ${focused ? 'ring-2 ring-[#d97706]/60 ring-offset-2 ring-offset-white' : ''}`}
      >
        <div
          className="relative overflow-hidden rounded-2xl border border-[#d6d6d6] bg-[#fafafa]"
          style={{ aspectRatio: cropStyle.aspectRatio }}
        >
          {pageImageSrc ? (
            <img
              src={pageImageSrc}
              alt={`第 ${block.pageNum} 页图片区域`}
              className="pointer-events-none absolute max-w-none select-none"
              style={cropStyle.image}
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#f5f5f5] text-[#7a7a7a]">
              <Icon icon="mdi:image-outline" className="text-3xl" />
              <p className="text-sm font-medium">正在渲染图片</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!originalText && !translatedText) {
    return null
  }

  const textToneClass = block.type === 'caption'
    ? 'text-[#60656f]'
    : block.type === 'reference'
      ? 'text-[#5e6470]'
      : block.type === 'header' || block.type === 'footer'
        ? 'text-[#7a7f88]'
        : 'text-[#181818]'

  const contentClass = block.type === 'formula' || block.type === 'table'
    ? 'whitespace-pre-wrap break-words font-medium'
    : block.type === 'list'
      ? 'whitespace-pre-wrap break-words'
      : 'whitespace-normal break-words'

  const translatedPanel = translatedText ? (
    translationDisplayMode === 'parallel' && block.type !== 'title' && block.type !== 'subtitle' ? (
      <div className="mt-4 grid gap-4 border-t border-[#ececec] pt-4 md:grid-cols-2">
        <div className="border-l border-[#d9d9d9] pl-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#777]">Original</p>
          <div className={contentClass}>{originalText}</div>
        </div>
        <div className="border-l border-[#f2b37a] pl-4 text-[#b45309]">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#c26a17]">译文</p>
          <div className={contentClass}>{translatedText}</div>
        </div>
      </div>
    ) : (
      <div className="mt-4 border-l-2 border-[#f2b37a] pl-4 text-[#b45309]">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#c26a17]">译文</p>
        <div className={contentClass}>{translatedText}</div>
      </div>
    )
  ) : null

  return (
    <div
      data-block-id={block.id}
      className={`${baseWrapper} ${focused ? 'rounded-xl ring-2 ring-[#d97706]/55 ring-offset-2 ring-offset-white' : ''}`}
      style={typography}
    >
      {translatedPanel && translationDisplayMode === 'parallel' && block.type !== 'title' && block.type !== 'subtitle' ? (
        translatedPanel
      ) : (
        <>
          {originalText && (
            <div className={`${contentClass} ${textToneClass}`}>
              {originalText}
            </div>
          )}
          {showTranslation && translatedPanel}
        </>
      )}
    </div>
  )
}

function HTMLReaderPage({
  page,
  blocks,
  scale,
  showTranslation,
  translationDisplayMode,
  focusTarget,
}: {
  page: PDFPageProxy
  blocks: TextBlock[]
  scale: number
  showTranslation: boolean
  translationDisplayMode: 'overlay' | 'parallel'
  focusTarget?: GuideFocusTarget | null
}) {
  const pageBlocks = useMemo(
    () => sortBlocks(blocks.filter(block => block.pageNum === page.pageNumber)),
    [blocks, page.pageNumber],
  )
  const pictureBlockCount = pageBlocks.filter(block => block.sourceLabel === 'Picture').length
  const [pageImageSrc, setPageImageSrc] = useState<string | null>(null)
  const zoomRatio = getZoomRatio(scale)

  useEffect(() => {
    if (pictureBlockCount === 0) {
      setPageImageSrc(null)
      return
    }

    let cancelled = false
    let renderTask: { promise: Promise<void>; cancel?: () => void } | null = null

    async function renderPageRaster() {
      const viewport = page.getViewport({ scale: PAGE_IMAGE_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      renderTask = page.render({
        canvasContext: context,
        viewport,
      })

      await renderTask.promise
      if (cancelled) return

      setPageImageSrc(canvas.toDataURL('image/webp', 0.9))
    }

    void renderPageRaster()

    return () => {
      cancelled = true
      renderTask?.cancel?.()
    }
  }, [page, pictureBlockCount])

  return (
    <section
      data-page-number={page.pageNumber}
      className="html-reader-page relative scroll-mt-5 border-t border-[#e9e9e9] pt-10 first:border-t-0 first:pt-2"
    >
      <div className="mx-auto w-full max-w-[960px] px-5 text-[#181818] md:px-8">
        <div className="space-y-1">
          {pageBlocks.map(block => (
            <HTMLReaderBlock
              key={block.id}
              block={block}
              showTranslation={showTranslation}
              translationDisplayMode={translationDisplayMode}
              zoomRatio={zoomRatio}
              focused={focusTarget?.blockId === block.id && focusTarget.pageNum === block.pageNum}
              pageImageSrc={pageImageSrc}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export default function HTMLReader({
  pdfBlob,
  documentId,
  scale,
  currentPage = 1,
  onPageChange,
  onTotalPagesChange,
  blocks = [],
  showTranslation = false,
  translationDisplayMode = 'overlay',
  jumpToBlock,
  focusTarget,
  onAskSelection,
  onAnnotationAdd,
}: HTMLReaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const scrollReleaseTimerRef = useRef<number | null>(null)
  const suppressPageSyncRef = useRef(false)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PDFPageProxy[]>([])
  const [visiblePage, setVisiblePage] = useState(1)
  const [showHighlightMenu, setShowHighlightMenu] = useState(false)
  const [highlightPosition, setHighlightPosition] = useState({ x: 0, y: 0 })
  const [selection, setSelection] = useState<{ text: string; pageNum: number; blockId?: string } | null>(null)
  const [noteMenuOpen, setNoteMenuOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSelectedColor, setNoteSelectedColor] = useState<HighlightColor>('yellow')

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
      top: Math.max(pageEl.offsetTop - 20, 0),
      behavior,
    })
    setVisiblePage(pageNum)
    releasePageSync()
    return true
  }, [releasePageSync])

  useEffect(() => {
    let mounted = true

    async function loadPDF() {
      try {
        const arrayBuffer = await pdfBlob.arrayBuffer()
        const pdfjs = await getPdfjs()
        const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
        if (!mounted) return

        setPdfDoc(doc)
        onTotalPagesChange?.(doc.numPages)

        const loadedPages: PDFPageProxy[] = []
        for (let i = 1; i <= doc.numPages; i += 1) {
          const nextPage = await doc.getPage(i)
          loadedPages.push(nextPage)
        }

        if (mounted) {
          setPages(loadedPages)
        }
      } catch (error) {
        console.error('HTML reader load PDF failed:', error)
      }
    }

    void loadPDF()

    return () => {
      mounted = false
    }
  }, [onTotalPagesChange, pdfBlob])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const pageElements = container.querySelectorAll('.html-reader-page')
      const containerRect = container.getBoundingClientRect()
      const containerCenter = containerRect.top + containerRect.height / 2

      let closestPage = 1
      let minDistance = Number.POSITIVE_INFINITY

      pageElements.forEach((element, index) => {
        const rect = element.getBoundingClientRect()
        const center = rect.top + rect.height / 2
        const distance = Math.abs(center - containerCenter)
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
  }, [onPageChange, pages.length])

  useEffect(() => {
    if (currentPage && pages.length > 0 && currentPage !== visiblePage) {
      scrollToPage(currentPage, 'auto')
    }
  }, [currentPage, pages.length, scrollToPage, visiblePage])

  useEffect(() => {
    if (!jumpToBlock || !containerRef.current) return

    const container = containerRef.current
    const blockEl = container.querySelector(`[data-block-id="${jumpToBlock.blockId}"]`) as HTMLElement | null
    if (blockEl) {
      suppressPageSyncRef.current = true
      blockEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
      blockEl.classList.add('html-reader-focus-flash')
      window.setTimeout(() => {
        blockEl.classList.remove('html-reader-focus-flash')
      }, 1800)
      releasePageSync()
      return
    }

    scrollToPage(jumpToBlock.pageNum, 'smooth')
  }, [jumpToBlock, releasePageSync, scrollToPage])

  useEffect(() => {
    return () => {
      if (scrollReleaseTimerRef.current !== null) {
        window.clearTimeout(scrollReleaseTimerRef.current)
      }
    }
  }, [])

  const resetSelectionState = useCallback(() => {
    setShowHighlightMenu(false)
    setSelection(null)
    setNoteMenuOpen(false)
    setNoteText('')
  }, [])

  const handleHtmlMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (menuRef.current?.contains(event.target as Node)) return

    window.requestAnimationFrame(() => {
      const selected = window.getSelection()
      if (!selected || selected.isCollapsed) {
        resetSelectionState()
        return
      }

      if (selected.rangeCount <= 0 || !containerRef.current) return

      const text = selected.toString().trim()
      if (!text) {
        resetSelectionState()
        return
      }

      const range = selected.getRangeAt(0)
      const clientRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0)
      if (!clientRects.length) return

      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()
      const intersectsReader = clientRects.some(rect =>
        rect.right > containerRect.left &&
        rect.left < containerRect.right &&
        rect.bottom > containerRect.top &&
        rect.top < containerRect.bottom,
      )
      if (!intersectsReader) return

      const union = clientRects.reduce((acc, rect) => {
        if (!acc) {
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          }
        }

        return {
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom),
        }
      }, null as null | { left: number; top: number; right: number; bottom: number })

      if (!union) return

      const desiredWidth = 360
      const unionWidth = union.right - union.left
      const menuX = union.left + unionWidth / 2 - containerRect.left + container.scrollLeft - desiredWidth / 2
      const menuY = union.top - containerRect.top + container.scrollTop - 14
      const clampMenu = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

      const rangeParent = range.commonAncestorContainer instanceof HTMLElement
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement
      const pageEl = rangeParent?.closest('[data-page-number]') as HTMLElement | null
      const blockEl = rangeParent?.closest('[data-block-id]') as HTMLElement | null

      const pageNum = Number(pageEl?.dataset.pageNumber || 0) || currentPage
      const blockId = blockEl?.dataset.blockId

      setHighlightPosition({
        x: clampMenu(menuX, 8, Math.max(container.scrollWidth - desiredWidth - 8, 8)),
        y: clampMenu(menuY, 8, Math.max(container.scrollHeight - 40, 8)),
      })
      setSelection({
        text: text.length > 1200 ? `${text.slice(0, 1200)}…` : text,
        pageNum,
        blockId,
      })
      setNoteMenuOpen(false)
      setShowHighlightMenu(true)
      setNoteText('')
    })
  }, [currentPage, resetSelectionState])

  const clearBrowserSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges?.()
  }, [])

  const handleAddHighlight = useCallback(async (color: HighlightColor) => {
    if (!selection || !documentId) return

    const annotation: PDFAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      documentId,
      type: 'highlight',
      pageNum: selection.pageNum,
      selectedText: selection.text,
      startOffset: 0,
      endOffset: 0,
      rects: [],
      color,
      content: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveAnnotation(annotation)
    onAnnotationAdd?.(annotation)
    clearBrowserSelection()
    resetSelectionState()
  }, [clearBrowserSelection, documentId, onAnnotationAdd, resetSelectionState, selection])

  const handleAddNote = useCallback(async () => {
    if (!selection || !documentId || !noteText.trim()) return

    const annotation: PDFAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      documentId,
      type: 'note',
      pageNum: selection.pageNum,
      selectedText: selection.text,
      startOffset: 0,
      endOffset: 0,
      rects: [],
      color: noteSelectedColor,
      content: noteText.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await saveAnnotation(annotation)
    onAnnotationAdd?.(annotation)
    clearBrowserSelection()
    resetSelectionState()
  }, [clearBrowserSelection, documentId, noteSelectedColor, noteText, onAnnotationAdd, resetSelectionState, selection])

  const handleAskSelectedText = useCallback(() => {
    if (!selection?.text?.trim()) return

    onAskSelection?.({
      text: selection.text,
      pageNum: selection.pageNum,
      blockId: selection.blockId,
    })
    clearBrowserSelection()
    resetSelectionState()
  }, [clearBrowserSelection, onAskSelection, resetSelectionState, selection])

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto bg-white"
      onMouseUp={handleHtmlMouseUp}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-5 md:px-6 md:py-6">
        {pages.length === 0 && (
          <div className="px-6 py-14 text-center text-[#7a7a7a]">
            <Icon icon="mdi:text-box-search-outline" className="mx-auto mb-3 text-4xl text-[#9a9a9a]" />
            <p className="text-sm font-medium">正在构建 HTML 阅览视图…</p>
          </div>
        )}

        {pages.map(page => (
          <HTMLReaderPage
            key={`html-page-${page.pageNumber}`}
            page={page}
            blocks={blocks}
            scale={scale}
            showTranslation={showTranslation}
            translationDisplayMode={translationDisplayMode}
            focusTarget={focusTarget}
          />
        ))}
      </div>

      {showHighlightMenu && selection && (
        <SelectionToolbar
          toolbarRef={menuRef}
          position={highlightPosition}
          selectionText={selection.text}
          noteMenuOpen={noteMenuOpen}
          noteText={noteText}
          noteSelectedColor={noteSelectedColor}
          onHighlight={color => { void handleAddHighlight(color) }}
          onToggleNote={() => setNoteMenuOpen(value => !value)}
          onAskAI={handleAskSelectedText}
          onDictionary={() => {}}
          onTranslate={() => {}}
          onExplain={() => {}}
          onNoteTextChange={setNoteText}
          onNoteColorChange={setNoteSelectedColor}
          onNoteCancel={() => {
            setNoteMenuOpen(false)
            setNoteText('')
          }}
          onNoteSave={() => { void handleAddNote() }}
        />
      )}

      {pdfDoc && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-[#dddddd] bg-white/92 px-3 py-1 text-sm text-[#222] shadow-[0_12px_24px_rgba(15,23,42,0.12)] backdrop-blur">
          {visiblePage} / {pdfDoc.numPages}
        </div>
      )}

      <style jsx global>{`
        .html-reader-focus-flash {
          animation: html-reader-focus-flash 1.8s ease;
        }

        @keyframes html-reader-focus-flash {
          0% {
            box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.28);
            transform: translateY(0);
          }
          35% {
            box-shadow: 0 0 0 14px rgba(217, 119, 6, 0.08);
            transform: translateY(-2px);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(217, 119, 6, 0);
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}
