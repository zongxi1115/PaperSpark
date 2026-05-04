'use client'

import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Icon } from '@iconify/react'
import { Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GuideFocusTarget, HighlightColor, PDFAnnotation, TextBlock } from '@/lib/types'
import { saveAnnotation } from '@/lib/pdfCache'
import { getSettings, getSelectedSmallModel } from '@/lib/storage'
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

function getRawBlockText(block: TextBlock, preferTranslated = false) {
  const raw = preferTranslated ? (block.translated || '') : block.text
  return raw || ''
}

function getReadableBlockText(block: TextBlock, preferTranslated = false) {
  const raw = getRawBlockText(block, preferTranslated)
  if (!raw) return ''

  if (block.type === 'formula') {
    return normalizeStructuredText(raw)
  }

  if (block.type === 'table') {
    return /<table[\s>]/i.test(raw) ? raw : normalizeStructuredText(raw)
  }

  if (block.type === 'list') {
    return normalizeListText(raw)
  }

  return normalizeWrappedText(raw)
}

const SERIF_FONT = '"STIX Two Text", Charter, Georgia, "Noto Serif", "Source Han Serif SC", SimSun, serif'

function getBlockTypography(block: TextBlock, zoomRatio: number) {
  const detectedFontSize = block.style.fontSize || 16

  if (block.type === 'title') {
    return {
      fontSize: `${clamp(detectedFontSize * 1.18 * zoomRatio, 28, 42)}px`,
      lineHeight: 1.12,
      letterSpacing: '-0.04em',
      fontWeight: 700,
      fontFamily: SERIF_FONT,
    }
  }

  if (block.type === 'subtitle') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.96 * zoomRatio, 20, 30)}px`,
      lineHeight: 1.28,
      letterSpacing: '-0.02em',
      fontWeight: 640,
      fontFamily: SERIF_FONT,
    }
  }

  if (block.type === 'caption') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.92 * zoomRatio, 12, 15)}px`,
      lineHeight: 1.55,
      letterSpacing: '0',
      fontWeight: 500,
      fontFamily: SERIF_FONT,
    }
  }

  if (block.type === 'reference') {
    return {
      fontSize: `${clamp(detectedFontSize * 0.9 * zoomRatio, 13, 15)}px`,
      lineHeight: 1.72,
      letterSpacing: '0',
      fontWeight: 500,
      fontFamily: SERIF_FONT,
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
    lineHeight: 1.85,
    letterSpacing: '0',
    fontWeight: 500,
    fontFamily: SERIF_FONT,
  }
}

function getBlockWrapperClass(block: TextBlock) {
  if (block.sourceLabel === 'Picture') {
    return 'my-8'
  }

  switch (block.type) {
    case 'title':
      return 'mb-6 pt-2'
    case 'subtitle':
      return 'mt-10 mb-4 pb-2 border-b border-[#d6d6d6]'
    case 'caption':
      return 'mt-2 mb-6 text-center italic'
    case 'formula':
      return 'my-6 overflow-x-auto bg-[#f8f8fc] border border-[#e4e4ec] rounded-lg px-4 py-3'
    case 'table':
      return 'my-5 overflow-x-auto bg-[#fafafa] border border-[#e0e0e0] rounded-lg px-3 py-2'
    case 'reference':
      return 'my-2 pl-4 border-l-2 border-[#c0c0c0]'
    case 'header':
    case 'footer':
      return 'my-1'
    default:
      return 'my-4'
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

// ─── KaTeX rendering helpers ──────────────────────────────────────────────

const LATEX_INLINE_RE = /\$([^\$]+?)\$/g
const LATEX_DISPLAY_RE = /\$\$([^\$]+?)\$\$/g
const LATEX_DELIMITER_RE = /^\s*(\$\$[\s\S]+\$\$|\$[\s\S]+\$)\s*$/
const LATEX_COMMAND_RE = /\\(?:begin|end|frac|dfrac|tfrac|sqrt|sum|prod|int|lim|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|mathbf|mathrm|mathit|text|label|ref|eqref|left|right|cdot|times|leq|geq|neq|approx|infty|partial|nabla|vec|hat|bar|overline|underline|operatorname)\b/
const MATH_SYMBOL_RE = /[=<>±×÷∑∏∫√∞≈≠≤≥∂∇∈∉⊂⊆⊃⊇∪∩∝→←↔]/g
const SUB_SUP_RE = /[_^](\{[^}]+\}|[A-Za-z0-9()+\-])/g
const NATURAL_WORD_RE = /\b[A-Za-z]{3,}\b/g
const CJK_CHAR_RE = /[\u3400-\u9fff]/g

function isLikelyFormulaText(text: string) {
  const normalized = normalizeBlockText(text)
  if (!normalized) return false

  if (LATEX_DELIMITER_RE.test(normalized) || LATEX_COMMAND_RE.test(normalized)) {
    return true
  }

  const mathSymbolCount = (normalized.match(MATH_SYMBOL_RE) || []).length
  const subSupCount = (normalized.match(SUB_SUP_RE) || []).length
  const naturalWordCount = (normalized.match(NATURAL_WORD_RE) || []).length
  const cjkCharCount = (normalized.match(CJK_CHAR_RE) || []).length
  const lineCount = normalized.split('\n').filter(Boolean).length

  if (cjkCharCount >= 4 && mathSymbolCount === 0 && subSupCount === 0) {
    return false
  }

  if (naturalWordCount >= 7 && mathSymbolCount < 2 && subSupCount === 0) {
    return false
  }

  return (
    (mathSymbolCount >= 2 && naturalWordCount <= 6 && normalized.length <= 160) ||
    (subSupCount >= 1 && naturalWordCount <= 8 && normalized.length <= 180) ||
    (lineCount >= 2 && (mathSymbolCount >= 1 || subSupCount >= 1) && naturalWordCount <= 10)
  )
}

function getRenderableBlockType(block: TextBlock, text: string): TextBlock['type'] {
  if (block.type === 'formula' && !isLikelyFormulaText(text)) {
    return 'paragraph'
  }

  return block.type
}

function renderLatexToHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode })
  } catch {
    return latex
  }
}

function renderTextWithLatex(text: string): React.ReactNode {
  // Handle display math ($$...$$) first, then inline ($...$)
  const segments: Array<{ type: 'text' | 'math'; content: string; display?: boolean }> = []

  // Split on $$...$$ first
  const displayParts = text.split(LATEX_DISPLAY_RE)
  for (let i = 0; i < displayParts.length; i++) {
    if (i % 2 === 1) {
      segments.push({ type: 'math', content: displayParts[i], display: true })
    } else if (displayParts[i]) {
      // Then split each text part on $...$
      const inlineParts = displayParts[i].split(LATEX_INLINE_RE)
      for (let j = 0; j < inlineParts.length; j++) {
        if (j % 2 === 1) {
          segments.push({ type: 'math', content: inlineParts[j], display: false })
        } else if (inlineParts[j]) {
          segments.push({ type: 'text', content: inlineParts[j] })
        }
      }
    }
  }

  if (segments.length === 0) return text
  if (segments.length === 1 && segments[0].type === 'text') return text

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'math' ? (
          <span
            key={i}
            className={seg.display ? 'block my-3 text-center' : 'inline'}
            dangerouslySetInnerHTML={{ __html: renderLatexToHtml(seg.content, !!seg.display) }}
          />
        ) : (
          <span key={i}>{seg.content}</span>
        ),
      )}
    </>
  )
}

function renderFormulaBlock(text: string): React.ReactNode {
  // Strip surrounding $$ or $ delimiters if present
  let latex = text.trim()
  if (latex.startsWith('$$') && latex.endsWith('$$')) {
    latex = latex.slice(2, -2).trim()
  } else if (latex.startsWith('$') && latex.endsWith('$')) {
    latex = latex.slice(1, -1).trim()
  }

  // Try display mode first
  const html = renderLatexToHtml(latex, true)
  if (!html.includes('katex-error')) {
    return <div className="text-center my-2" dangerouslySetInnerHTML={{ __html: html }} />
  }

  // Fall back to inline rendering
  const withInline = renderTextWithLatex(text)
  if (withInline !== text) return withInline

  // Last resort: show raw text
  return <code className="text-sm bg-gray-50 px-1.5 py-0.5 rounded">{text}</code>
}

function splitReferenceEntries(text: string) {
  const normalized = normalizeBlockText(text)
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()

  if (!normalized) return []

  const numberedEntries = normalized.match(/\[\d+\]\s*[\s\S]*?(?=(?:\s+\[\d+\]\s*)|$)/g)
    ?.map(entry => entry.trim())
    .filter(Boolean)

  if (numberedEntries && numberedEntries.length > 0) {
    return numberedEntries
  }

  const lineEntries = normalizeBlockText(text)
    .split('\n')
    .map(line => normalizeWrappedText(line))
    .filter(Boolean)

  return lineEntries.length > 0 ? lineEntries : [normalizeWrappedText(text)]
}

function renderReferenceBlock(text: string): React.ReactNode {
  const entries = splitReferenceEntries(text)
  if (entries.length === 0) return null

  return (
    <div className="space-y-2">
      {entries.map((entry, index) => (
        <div key={index} className="hanging-indent leading-[1.72]">
          {renderTextWithLatex(entry)}
        </div>
      ))}
    </div>
  )
}

type ParsedTableCell = {
  content: string
  isHeader: boolean
  colSpan: number
  rowSpan: number
}

type ParsedTableRow = ParsedTableCell[]

function hasHtmlTableMarkup(text: string) {
  return /<table[\s>][\s\S]*<\/table>/i.test(text)
}

function parseHtmlTable(text: string): ParsedTableRow[] | null {
  if (typeof window === 'undefined' || !hasHtmlTableMarkup(text)) {
    return null
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(text, 'text/html')
    const table = doc.querySelector('table')
    if (!table) return null

    const rows = Array.from(table.querySelectorAll('tr'))
      .map((row) => {
        const cells = Array.from(row.querySelectorAll('th, td')).map((cell) => ({
          content: normalizeWrappedText(cell.textContent || ''),
          isHeader: cell.tagName.toLowerCase() === 'th',
          colSpan: Math.max(Number(cell.getAttribute('colspan') || 1), 1),
          rowSpan: Math.max(Number(cell.getAttribute('rowspan') || 1), 1),
        }))

        return cells.filter(cell => cell.content)
      })
      .filter(row => row.length > 0)

    return rows.length > 0 ? rows : null
  } catch {
    return null
  }
}

function renderTableBlock(text: string): React.ReactNode {
  const parsedTable = parseHtmlTable(text)
  if (!parsedTable) {
    return <div className="whitespace-pre-wrap break-words font-mono text-sm">{normalizeStructuredText(text)}</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-[0.95em] leading-6">
        <tbody>
          {parsedTable.map((row, rowIndex) => (
            <tr key={rowIndex} className={rowIndex === 0 ? 'border-b border-[#d6d6d6]' : 'border-b border-[#ececec]'}>
              {row.map((cell, cellIndex) => {
                const CellTag = cell.isHeader || rowIndex === 0 ? 'th' : 'td'
                return (
                  <CellTag
                    key={`${rowIndex}-${cellIndex}`}
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan}
                    className={`px-3 py-2 align-top ${CellTag === 'th' ? 'bg-[#f3f4f6] font-semibold text-[#222]' : 'text-[#333]'}`}
                  >
                    {renderTextWithLatex(cell.content)}
                  </CellTag>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Block rendering ────────────────────────────────────────────────────

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
  const rawOriginalText = getRawBlockText(block, false)
  const rawTranslatedText = getRawBlockText(block, true)
  const originalText = getReadableBlockText(block, false)
  const translatedText = getReadableBlockText(block, true)
  const renderableType = getRenderableBlockType(block, originalText)
  const renderBlock = renderableType === block.type ? block : { ...block, type: renderableType }
  const typography = getBlockTypography(renderBlock, zoomRatio)
  const baseWrapper = getBlockWrapperClass(renderBlock)

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

  const textToneClass = renderableType === 'caption'
    ? 'text-[#60656f]'
    : renderableType === 'reference'
      ? 'text-[#5e6470]'
      : renderableType === 'header' || renderableType === 'footer'
        ? 'text-[#7a7f88]'
        : 'text-[#181818]'

  const contentClass = renderableType === 'table'
    ? 'whitespace-pre-wrap break-words font-mono text-sm'
    : renderableType === 'formula'
      ? ''
      : renderableType === 'reference'
        ? ''
      : renderableType === 'list'
        ? 'whitespace-pre-wrap break-words'
        : 'whitespace-normal break-words'

  const translatedPanel = translatedText ? (
    translationDisplayMode === 'parallel' && renderableType !== 'title' && renderableType !== 'subtitle' ? (
      <div className="mt-4 grid gap-4 border-t border-[#ececec] pt-4 md:grid-cols-2">
        <div className="border-l border-[#d9d9d9] pl-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#777]">Original</p>
          <div className={contentClass}>
            {renderableType === 'table'
              ? renderTableBlock(rawOriginalText)
              : renderableType === 'reference'
                ? renderReferenceBlock(rawOriginalText)
                : originalText}
          </div>
        </div>
        <div className="border-l border-[#f2b37a] pl-4 text-[#b45309]" style={{ fontFamily: '"Times New Roman", SimSun, serif' }}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#c26a17]">译文</p>
          <div className={contentClass}>
            {renderableType === 'table'
              ? renderTableBlock(rawTranslatedText || translatedText)
              : renderableType === 'reference'
                ? renderReferenceBlock(rawTranslatedText || translatedText)
                : translatedText}
          </div>
        </div>
      </div>
    ) : (
      <div className="mt-4 border-l-2 border-[#f2b37a] pl-4 text-[#b45309]" style={{ fontFamily: '"Times New Roman", SimSun, serif' }}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#c26a17]">译文</p>
        <div className={contentClass}>
          {renderableType === 'table'
            ? renderTableBlock(rawTranslatedText || translatedText)
            : renderableType === 'reference'
              ? renderReferenceBlock(rawTranslatedText || translatedText)
              : translatedText}
        </div>
      </div>
    )
  ) : null

  return (
    <div
      data-block-id={block.id}
      className={`${baseWrapper} ${focused ? 'rounded-xl ring-2 ring-[#d97706]/55 ring-offset-2 ring-offset-white' : ''}`}
      style={typography}
    >
      {translatedPanel && translationDisplayMode === 'parallel' && renderableType !== 'title' && renderableType !== 'subtitle' ? (
        translatedPanel
      ) : (
        <>
          {originalText && (
            <div className={`${contentClass} ${textToneClass}`}>
              {renderableType === 'table'
                ? renderTableBlock(rawOriginalText)
                : renderableType === 'reference'
                  ? renderReferenceBlock(rawOriginalText)
                : renderableType === 'formula'
                  ? renderFormulaBlock(originalText)
                  : renderTextWithLatex(originalText)}
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
      className="html-reader-page relative scroll-mt-5 pt-8 first:pt-2"
    >
      <div className="mb-3 flex items-center gap-2 text-[11px] text-[#999] font-mono select-none">
        <span className="w-5 h-px bg-[#d0d0d0]" />
        {page.pageNumber}
        <span className="flex-1 h-px bg-[#d0d0d0]" />
      </div>
      <div className="mx-auto w-full max-w-[840px] px-5 text-[#181818] md:px-10">
        <div className="border-l-[3px] border-[#c8c8c8] pl-4 space-y-0.5">
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
  const [quickAction, setQuickAction] = useState<{
    type: 'dictionary' | 'translate' | 'explain'
    text: string
    result: string
    loading: boolean
  } | null>(null)

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

  const SYSTEM_PROMPTS: Record<string, string> = {
    dictionary: '你是一个学术词典助手。请给出以下词汇或短语的释义，包括：中文释义、词性、学术语境中的含义。用中文回答，简洁明了。',
    translate: '你是一个专业学术翻译助手。请将以下文本翻译为自然、准确的中文。只输出译文，不要解释。保留公式和专有名词。绝对不要输出英文原文。',
    explain: '你是一个学术文献解读助手。请用通俗易懂的中文解释以下文本的含义，帮助读者理解其学术含义。解释要简洁明了。',
  }

  const handleQuickAction = useCallback(async (type: 'dictionary' | 'translate' | 'explain') => {
    if (!selection?.text?.trim()) return

    setQuickAction({ type, text: selection.text, result: '', loading: true })
    clearBrowserSelection()
    resetSelectionState()

    const settings = getSettings()
    const modelConfig = getSelectedSmallModel(settings)
    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      setQuickAction(prev => prev ? { ...prev, loading: false, result: '请先在设置中配置小参数模型的 API Key' } : null)
      return
    }

    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: selection.text.trim() }],
          modelConfig,
          systemPrompt: SYSTEM_PROMPTS[type],
        }),
      })

      if (!response.ok) {
        setQuickAction(prev => prev ? { ...prev, loading: false, result: '请求失败' } : null)
        return
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const parsed = JSON.parse(line)
              if (parsed.type === 'text-delta') {
                fullContent += parsed.delta
                setQuickAction(prev => prev ? { ...prev, result: fullContent } : null)
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }

      setQuickAction(prev => prev ? { ...prev, loading: false, result: fullContent || '无结果' } : null)
    } catch {
      setQuickAction(prev => prev ? { ...prev, loading: false, result: '请求出错' } : null)
    }
  }, [clearBrowserSelection, resetSelectionState, selection])

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto bg-[#fefefe]"
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
          onDictionary={() => handleQuickAction('dictionary')}
          onTranslate={() => handleQuickAction('translate')}
          onExplain={() => handleQuickAction('explain')}
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

      {/* 快捷操作结果弹窗 */}
      {quickAction && (
        <Popover
          isOpen
          placement="top"
          showArrow
          offset={12}
          onOpenChange={open => {
            if (!open) setQuickAction(null)
          }}
        >
          <PopoverTrigger>
            <button
              type="button"
              aria-label="quick-action-anchor"
              className="fixed opacity-0 pointer-events-none"
              style={{ left: '50%', top: '40%', width: 1, height: 1 }}
            />
          </PopoverTrigger>
          <PopoverContent className="max-w-80 bg-[#161a23] border border-[#2b3242] px-3 py-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium text-gray-400">
                  {quickAction.type === 'dictionary' ? '词典' : quickAction.type === 'translate' ? '翻译' : '解释'}
                </span>
                <button
                  type="button"
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  onClick={() => setQuickAction(null)}
                >
                  <Icon icon="mdi:close" className="text-xs" />
                </button>
              </div>
              <p className="text-[11px] text-gray-500 line-clamp-2">
                {quickAction.text.slice(0, 80)}{quickAction.text.length > 80 ? '…' : ''}
              </p>
              {quickAction.loading ? (
                <div className="flex items-center gap-2 py-1">
                  <Icon icon="mdi:loading" className="text-sm text-blue-400 animate-spin" />
                  <span className="text-xs text-gray-400">处理中…</span>
                </div>
              ) : (
                <p className="text-xs leading-relaxed text-gray-200 whitespace-pre-wrap" style={{ fontFamily: '"Times New Roman", SimSun, serif' }}>
                  {quickAction.result}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
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

        .hanging-indent {
          text-indent: -1.5em;
          padding-left: 1.5em;
        }

        .html-reader-page + .html-reader-page {
          margin-top: 2rem;
        }

        .katex-display {
          margin: 0.5em 0 !important;
        }
      `}</style>
    </div>
  )
}
