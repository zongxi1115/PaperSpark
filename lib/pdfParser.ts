import type { TextBlock, TextItem, BoundingBox, TextStyle, PDFPageCache, PDFMetadata } from './types'

// PDF.js 类型定义
interface PDFDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PDFPageProxy>
  getMetadata(): Promise<{ info: Record<string, unknown> | null }>
}

interface PDFPageProxy {
  getViewport(params: { scale: number }): { width: number; height: number }
  getTextContent(): Promise<{ items: Array<{ str: string; transform: number[]; width?: number; fontName?: string }> }>
}

interface PDFJSLib {
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PDFDocumentProxy> }
  GlobalWorkerOptions: { workerSrc: string }
  version: string
}

let pdfjsPromise: Promise<PDFJSLib> | null = null

// 通过 CDN 加载 PDF.js
async function getPdfjs(): Promise<PDFJSLib> {
  if (pdfjsPromise) return pdfjsPromise

  pdfjsPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('PDF 解析只能在客户端进行'))
      return
    }

    // 检查是否已加载
    const win = window as unknown as { pdfjsLib?: PDFJSLib }
    if (win.pdfjsLib) {
      resolve(win.pdfjsLib)
      return
    }

    // 使用 jsDelivr CDN 加载稳定版本
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

// 生成唯一 ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 9) + Date.now().toString(36)
}

// 解析 PDF 文档
export interface ParseResult {
  pages: PDFPageCache[]
  metadata: Partial<PDFMetadata>
  fullText: string
}

/**
 * 从 ArrayBuffer 解析 PDF 文档
 */
export async function parsePDF(
  arrayBuffer: ArrayBuffer,
  documentId: string,
  onProgress?: (current: number, total: number) => void
): Promise<ParseResult> {
  const pdfjs = await getPdfjs()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const numPages = pdf.numPages
  const pages: PDFPageCache[] = []
  const metadata: Partial<PDFMetadata> = {}
  let fullText = ''

  // 提取 PDF 元数据
  try {
    const info = await pdf.getMetadata()
    if (info.info) {
      const pdfInfo = info.info as Record<string, unknown>
      metadata.title = (pdfInfo['Title'] as string) || ''
      metadata.authors = pdfInfo['Author'] ? [(pdfInfo['Author'] as string)] : []
    }
  } catch {
    // 忽略元数据提取错误
  }

  // 解析每一页
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (onProgress) {
      onProgress(pageNum, numPages)
    }

    const page = await pdf.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()

    // 提取文本项
    const textItems: TextItem[] = []
    
    for (const item of textContent.items) {
      if ('str' in item && item.str.trim()) {
        const tx = item.transform
        
        // pdfjs 的 transform 数组: [scaleX, skewX, skewY, scaleY, translateX, translateY]
        const x = tx[4]
        const y = viewport.height - tx[5] // 转换坐标系
        const fontSize = Math.abs(tx[0]) || Math.abs(tx[3]) || 12
        
        const bbox: BoundingBox = {
          x: x,
          y: y - fontSize,
          width: (item.width || 0) || tx[0] * item.str.length * 0.6,
          height: fontSize,
        }

        const style: TextStyle = {
          fontSize: fontSize,
          fontFamily: item.fontName || 'sans-serif',
          isBold: item.fontName?.toLowerCase().includes('bold') || false,
          isItalic: item.fontName?.toLowerCase().includes('italic') || item.fontName?.toLowerCase().includes('oblique') || false,
        }

        textItems.push({
          id: generateId(),
          text: item.str,
          bbox,
          style,
          pageNum,
        })
      }
    }

    // 合并相邻文本项为文本块
    const blocks = mergeTextItemsToBlocks(textItems, documentId, pageNum)

    pages.push({
      id: `${documentId}_page_${pageNum}`,
      documentId,
      pageNum,
      width: viewport.width,
      height: viewport.height,
      blocks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // 收集全文
    fullText += blocks.map(b => b.text).join('\n') + '\n\n'
  }

  return { pages, metadata, fullText }
}

/**
 * 合并相邻的文本项为文本块
 */
function mergeTextItemsToBlocks(
  items: TextItem[],
  documentId: string,
  pageNum: number
): TextBlock[] {
  if (items.length === 0) return []

  const blocks: TextBlock[] = []
  let currentBlock: TextBlock | null = null

  // 按 y 坐标排序，然后按 x 坐标排序
  const sortedItems = [...items].sort((a, b) => {
    const yDiff = a.bbox.y - b.bbox.y
    if (Math.abs(yDiff) > 5) return yDiff
    return a.bbox.x - b.bbox.x
  })

  for (const item of sortedItems) {
    const blockType = getBlockType(item)
    
    // 判断是否应该开始新的块
    const shouldStartNewBlock = !currentBlock || 
      blockType !== currentBlock.type ||
      Math.abs(item.bbox.y - currentBlock.bbox.y) > currentBlock.style.fontSize * 1.5 ||
      (Math.abs(item.bbox.y - currentBlock.bbox.y) < currentBlock.style.fontSize * 0.5 &&
       item.bbox.x - (currentBlock.bbox.x + currentBlock.bbox.width) > currentBlock.style.fontSize * 2)

    if (shouldStartNewBlock) {
      if (currentBlock) {
        blocks.push(currentBlock)
      }
      currentBlock = {
        id: generateId(),
        type: blockType,
        text: item.text,
        bbox: { ...item.bbox },
        style: { ...item.style },
        pageNum,
        itemIds: [item.id],
      }
    } else {
      currentBlock.text += ' ' + item.text
      currentBlock.bbox.width = item.bbox.x + item.bbox.width - currentBlock.bbox.x
      currentBlock.bbox.height = Math.max(currentBlock.bbox.height, item.bbox.height)
      currentBlock.itemIds.push(item.id)
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock)
  }

  return blocks
}

/**
 * 根据文本项判断块类型
 */
function getBlockType(item: TextItem): TextBlock['type'] {
  const text = item.text.trim()
  
  if (item.style.fontSize > 14 && text.length < 100 && !text.endsWith('.')) {
    return 'title'
  }
  
  if (item.style.fontSize > 12 && item.style.fontSize <= 14 && text.length < 150) {
    return 'subtitle'
  }
  
  if (/[=+\-*/^∑∏∫√∞≈≠≤≥]/.test(text)) {
    return 'formula'
  }
  
  if (/^\[\d+\]|\(\w+,\s*\d{4}\)/.test(text)) {
    return 'reference'
  }
  
  if (/^(Figure|Table|图|表|Fig\.|Tab\.)\s*\d+/i.test(text)) {
    return 'caption'
  }
  
  if (/^(\d+\.|\d+\)|[•●○\-—])\s/.test(text)) {
    return 'list'
  }
  
  if (item.bbox.y < 50 || item.bbox.y > 700) {
    if (text.length < 50) {
      return item.bbox.y < 50 ? 'header' : 'footer'
    }
  }
  
  if (text.length < 30 && /\d/.test(text) && /[\s\t]/.test(text)) {
    return 'table'
  }
  
  return 'paragraph'
}

/**
 * 从 Base64 解析 PDF
 */
export async function parsePDFFromBase64(
  base64: string,
  documentId: string,
  onProgress?: (current: number, total: number) => void
): Promise<ParseResult> {
  const base64Data = base64.replace(/^data:application\/pdf;base64,/, '')
  const binaryString = atob(base64Data)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return parsePDF(bytes.buffer, documentId, onProgress)
}