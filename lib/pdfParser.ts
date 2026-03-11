import type { TextBlock, TextItem, BoundingBox, TextStyle, PDFPageCache, PDFMetadata } from './types'

// 动态导入 pdfjs-dist，确保只在客户端运行
let pdfjsLib: typeof import('pdfjs-dist') | null = null

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib
  
  if (typeof window === 'undefined') {
    throw new Error('PDF 解析只能在客户端进行')
  }
  
  pdfjsLib = await import('pdfjs-dist')
  
  // 设置 worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
  
  return pdfjsLib
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
        // 我们需要转换为标准的 bbox 格式
        const x = tx[4]
        const y = viewport.height - tx[5] // 转换坐标系（PDF 的 y 轴是从下往上）
        const fontSize = Math.abs(tx[0]) || Math.abs(tx[3]) || 12
        
        const bbox: BoundingBox = {
          x: x,
          y: y - fontSize, // 调整 y 坐标到文本基线
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
    if (Math.abs(yDiff) > 5) return yDiff // 不同行
    return a.bbox.x - b.bbox.x // 同一行按 x 排序
  })

  for (const item of sortedItems) {
    // 判断是否应该开始新的块
    const shouldStartNewBlock = !currentBlock || 
      // 不同的文本块类型
      getBlockType(item) !== currentBlock.type ||
      // y 坐标差距过大（超过 1.5 倍行高）
      Math.abs(item.bbox.y - currentBlock.bbox.y) > currentBlock.style.fontSize * 1.5 ||
      // 同一行但 x 间距过大（超过 2 个空格宽度）
      (Math.abs(item.bbox.y - currentBlock.bbox.y) < currentBlock.style.fontSize * 0.5 &&
       item.bbox.x - (currentBlock.bbox.x + currentBlock.bbox.width) > currentBlock.style.fontSize * 2)

    if (shouldStartNewBlock) {
      // 保存当前块
      if (currentBlock) {
        blocks.push(currentBlock)
      }
      // 开始新块
      currentBlock = {
        id: generateId(),
        type: getBlockType(item),
        text: item.text,
        bbox: { ...item.bbox },
        style: { ...item.style },
        pageNum,
        itemIds: [item.id],
      }
    } else {
      // 扩展当前块
      currentBlock.text += ' ' + item.text
      // 扩展边界框
      currentBlock.bbox.width = item.bbox.x + item.bbox.width - currentBlock.bbox.x
      currentBlock.bbox.height = Math.max(currentBlock.bbox.height, item.bbox.height)
      currentBlock.itemIds.push(item.id)
    }
  }

  // 添加最后一个块
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
  
  // 标题判断：字号大且文本较短
  if (item.style.fontSize > 14 && text.length < 100 && !text.endsWith('.')) {
    return 'title'
  }
  
  // 副标题
  if (item.style.fontSize > 12 && item.style.fontSize <= 14 && text.length < 150) {
    return 'subtitle'
  }
  
  // 公式判断：包含数学符号
  if (/[=+\-*/^∑∏∫√∞≈≠≤≥]/.test(text)) {
    return 'formula'
  }
  
  // 引用判断：类似 [1] 或 (Author, 2020) 格式
  if (/^\[\d+\]|\(\w+,\s*\d{4}\)/.test(text)) {
    return 'reference'
  }
  
  // 图表标题判断：以 Figure, Table, 图, 表 开头
  if (/^(Figure|Table|图|表|Fig\.|Tab\.)\s*\d+/i.test(text)) {
    return 'caption'
  }
  
  // 列表项判断：以数字或符号开头
  if (/^(\d+\.|\d+\)|[•●○\-—])\s/.test(text)) {
    return 'list'
  }
  
  // 页眉页脚判断：位于页面顶部或底部，文本很短
  if (item.bbox.y < 50 || item.bbox.y > 700) {
    if (text.length < 50) {
      return item.bbox.y < 50 ? 'header' : 'footer'
    }
  }
  
  // 表格内容判断：文本很短且数字较多
  if (text.length < 30 && /\d/.test(text) && /[\s\t]/.test(text)) {
    return 'table'
  }
  
  // 默认为段落
  return 'paragraph'
}

/**
 * 从 URL 解析 PDF（用于 Zotero 附件）
 */
export async function parsePDFFromURL(
  url: string,
  documentId: string,
  onProgress?: (current: number, total: number) => void
): Promise<ParseResult> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return parsePDF(arrayBuffer, documentId, onProgress)
}

/**
 * 从 Base64 解析 PDF
 */
export async function parsePDFFromBase64(
  base64: string,
  documentId: string,
  onProgress?: (current: number, total: number) => void
): Promise<ParseResult> {
  // 移除 data URL 前缀
  const base64Data = base64.replace(/^data:application\/pdf;base64,/, '')
  const binaryString = atob(base64Data)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return parsePDF(bytes.buffer, documentId, onProgress)
}
