import JSZip from 'jszip'
import type { AppDocument } from '@/lib/types'
import type { CitationData } from '@/components/Editor/CitationBlock'

type ImageAsset = {
  filename: string
  blob: Blob
}

type UnknownBlock = {
  type?: string
  content?: unknown
  children?: UnknownBlock[]
  props?: Record<string, unknown>
}

const IMAGE_NAME_PREFIX = 'image_'

export type LatexExportLanguage = 'auto' | 'zh' | 'en'

export interface LatexExportOptions {
  language?: LatexExportLanguage
  markdownContent?: string
}

type ParsedAbstract = {
  text: string
  startIndex: number
  endIndex: number
}

export async function exportToLatex(
  editor: { document: unknown[] },
  doc: AppDocument,
  citationsInput: CitationData[] = [],
  options: LatexExportOptions = {}
): Promise<Blob> {
  const blocks = (editor.document || []) as UnknownBlock[]
  const parsedAbstract = !(doc.articleAbstract || '').trim() ? parseAbstractSection(blocks) : null
  const abstractText = (doc.articleAbstract || '').trim() || parsedAbstract?.text || ''
  const contentBlocks = parsedAbstract
    ? blocks.filter((_, idx) => idx < parsedAbstract.startIndex || idx > parsedAbstract.endIndex)
    : blocks

  const imageMap = new Map<string, ImageAsset>()

  await collectImages(blocks, imageMap)

  const latexContent = convertBlocks(contentBlocks, imageMap)
  const latexDoc = generateLatexDocument(doc, latexContent, citationsInput, {
    language: options.language || 'auto',
    abstractText,
  })

  const zip = new JSZip()
  zip.file('main.tex', latexDoc)
  zip.file('HOW_TO_COMPILE.md', buildCompileGuide(options.language || 'auto'))
  if (options.markdownContent && options.markdownContent.trim()) {
    zip.file('document.md', options.markdownContent)
  }

  for (const asset of imageMap.values()) {
    zip.file(`images/${asset.filename}`, asset.blob)
  }

  return zip.generateAsync({ type: 'blob' })
}

async function collectImages(blocks: UnknownBlock[], imageMap: Map<string, ImageAsset>) {
  const usedNames = new Set<string>(Array.from(imageMap.values()).map(v => v.filename))
  let imageIndex = imageMap.size + 1

  async function walk(nodes: UnknownBlock[]) {
    for (const block of nodes) {
      if (block.type === 'image') {
        const url = String(block.props?.url || '')
        if (url && !imageMap.has(url)) {
          const blob = await resolveImageBlob(url)
          if (blob) {
            const ext = pickImageExtension(url, blob.type)
            const filename = uniqueImageName(`${IMAGE_NAME_PREFIX}${imageIndex}.${ext}`, usedNames)
            imageMap.set(url, { filename, blob })
            imageIndex += 1
          }
        }
      }

      if (Array.isArray(block.children) && block.children.length > 0) {
        await walk(block.children)
      }
    }
  }

  await walk(blocks)
}

async function resolveImageBlob(url: string): Promise<Blob | null> {
  try {
    if (url.startsWith('data:')) {
      const res = await fetch(url)
      return await res.blob()
    }

    const localFile = await tryResolveLocalFile(url)
    if (localFile) return localFile

    const res = await fetch(url)
    if (!res.ok) return null
    return await res.blob()
  } catch {
    return null
  }
}

async function tryResolveLocalFile(url: string): Promise<Blob | null> {
  try {
    const mod = await import('@/lib/localFiles')
    if (!mod.isLocalFileUrl(url)) return null

    const id = url.replace(mod.LOCAL_FILE_URL_PREFIX, '')
    const record = await mod.getStoredFile(id)
    return record?.blob ?? null
  } catch {
    return null
  }
}

function pickImageExtension(url: string, mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
  }

  if (mimeMap[mimeType]) return mimeMap[mimeType]

  const cleanUrl = url.split('?')[0].split('#')[0]
  const match = cleanUrl.match(/\.([a-zA-Z0-9]+)$/)
  if (match?.[1]) return match[1].toLowerCase()

  return 'png'
}

function uniqueImageName(baseName: string, used: Set<string>): string {
  if (!used.has(baseName)) {
    used.add(baseName)
    return baseName
  }

  const dotIdx = baseName.lastIndexOf('.')
  const name = dotIdx >= 0 ? baseName.slice(0, dotIdx) : baseName
  const ext = dotIdx >= 0 ? baseName.slice(dotIdx) : ''

  let i = 1
  while (used.has(`${name}_${i}${ext}`)) {
    i += 1
  }

  const next = `${name}_${i}${ext}`
  used.add(next)
  return next
}

function convertBlocks(blocks: UnknownBlock[], imageMap: Map<string, ImageAsset>): string {
  const parts: string[] = []

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    const type = block.type || ''

    if (type === 'bulletListItem' || type === 'numberedListItem') {
      const listResult = convertList(blocks, i, imageMap)
      parts.push(listResult.latex)
      i = listResult.nextIndex - 1
      continue
    }

    const converted = convertSingleBlock(block, imageMap)
    if (converted) parts.push(converted)
  }

  return parts.filter(Boolean).join('\n\n')
}

function convertSingleBlock(block: UnknownBlock, imageMap: Map<string, ImageAsset>): string {
  const type = block.type || ''

  if (type === 'heading') {
    const level = Number(block.props?.level || 1)
    const text = convertInlineContent(block.content)
    const command = headingCommand(level)
    return `\\${command}{${text}}`
  }

  if (type === 'paragraph') {
    const text = convertInlineContent(block.content)
    if (!text.trim()) return ''

    const child = convertChildBlocks(block.children, imageMap)
    return child ? `${text}\n\n${child}` : text
  }

  if (type === 'table') {
    return convertTable(block)
  }

  if (type === 'codeBlock') {
    const code = extractPlainTextFromInline(block.content)
    return `\\begin{verbatim}\n${code}\n\\end{verbatim}`
  }

  if (type === 'quote') {
    const quote = convertInlineContent(block.content)
    const child = convertChildBlocks(block.children, imageMap)
    const body = child ? `${quote}\n${child}` : quote
    return `\\begin{quote}\n${body}\n\\end{quote}`
  }

  if (type === 'image') {
    const url = String(block.props?.url || '')
    const caption = escapeLatex(String(block.props?.caption || convertInlineContent(block.content) || ''))
    const imageAsset = imageMap.get(url)

    if (!imageAsset) {
      if (!url) return ''
      return `\\begin{quote}\nImage source: \\url{${escapeLatexUrl(url)}}\n\\end{quote}`
    }

    const lines = [
      '\\begin{figure}[h]',
      '\\centering',
      `\\includegraphics[width=0.8\\textwidth]{images/${escapeLatexPath(imageAsset.filename)}}`,
    ]

    if (caption.trim()) {
      lines.push(`\\caption{${caption}}`)
    }

    lines.push('\\end{figure}')
    return lines.join('\n')
  }

  const fallback = convertInlineContent(block.content)
  if (fallback.trim()) return fallback

  return convertChildBlocks(block.children, imageMap)
}

function convertTable(block: UnknownBlock): string {
  const content = block.content as { rows?: Array<{ cells?: unknown[] }> }
  const rows = Array.isArray(content?.rows) ? content.rows : []
  if (rows.length === 0) return ''

  const colCount = Math.max(1, rows[0]?.cells?.length || 1)
  const colSpec = `|${'c|'.repeat(colCount)}`
  const lines: string[] = [`\\begin{tabular}{${colSpec}}`, '\\hline']

  for (const row of rows) {
    const cells = Array.isArray(row.cells) ? row.cells : []
    const normalized = Array.from({ length: colCount }, (_, idx) => cells[idx] ?? '')
    const cellText = normalized.map(convertTableCell).join(' & ')
    lines.push(`${cellText} \\\\`)
    lines.push('\\hline')
  }

  lines.push('\\end{tabular}')
  return lines.join('\n')
}

function convertTableCell(cell: unknown): string {
  if (typeof cell === 'string') return escapeLatex(cell)

  if (Array.isArray(cell)) {
    return convertInlineContent(cell)
  }

  if (cell && typeof cell === 'object') {
    const obj = cell as { content?: unknown; text?: string }
    if (obj.content != null) return convertInlineContent(obj.content)
    if (typeof obj.text === 'string') return escapeLatex(obj.text)
  }

  return ''
}

function convertList(
  blocks: UnknownBlock[],
  startIndex: number,
  imageMap: Map<string, ImageAsset>
): { latex: string; nextIndex: number } {
  const firstType = blocks[startIndex]?.type
  const env = firstType === 'numberedListItem' ? 'enumerate' : 'itemize'
  const lines: string[] = [`\\begin{${env}}`]

  let i = startIndex
  while (i < blocks.length && blocks[i]?.type === firstType) {
    const item = blocks[i]
    const text = convertInlineContent(item.content)
    const nested = convertChildBlocks(item.children, imageMap)

    if (nested) {
      lines.push(`\\item ${text}`)
      lines.push(nested)
    } else {
      lines.push(`\\item ${text}`)
    }

    i += 1
  }

  lines.push(`\\end{${env}}`)
  return { latex: lines.join('\n'), nextIndex: i }
}

function convertChildBlocks(children: UnknownBlock[] | undefined, imageMap: Map<string, ImageAsset>): string {
  if (!Array.isArray(children) || children.length === 0) return ''
  return convertBlocks(children, imageMap)
}

function convertInlineContent(content: unknown): string {
  if (typeof content === 'string') return escapeLatex(content)
  if (!Array.isArray(content)) return ''

  const chunks: string[] = []

  for (const inline of content) {
    if (typeof inline === 'string') {
      chunks.push(escapeLatex(inline))
      continue
    }

    if (!inline || typeof inline !== 'object') continue

    const node = inline as {
      type?: string
      text?: string
      styles?: Record<string, unknown>
      content?: unknown
      href?: string
      props?: Record<string, unknown>
    }

    if (node.type === 'text') {
      let text = escapeLatex(node.text || '')
      text = applyInlineStyles(text, node.styles)
      chunks.push(text)
      continue
    }

    if (node.type === 'formula') {
      const latex = String(node.props?.latex || '')
      chunks.push(`$${latex}$`)
      continue
    }

    if (node.type === 'citation') {
      const index = Number(node.props?.citationIndex || 1)
      chunks.push(`\\cite{ref${index}}`)
      continue
    }

    if (node.type === 'link') {
      const href = String(node.href || '')
      const text = convertInlineContent(node.content)
      if (text.trim()) {
        chunks.push(`\\href{${escapeLatexUrl(href)}}{${text}}`)
      } else {
        chunks.push(`\\url{${escapeLatexUrl(href)}}`)
      }
      continue
    }

    if (node.type === 'code') {
      chunks.push(`\\texttt{${escapeLatex(node.text || '')}}`)
      continue
    }

    if (typeof node.text === 'string') {
      chunks.push(escapeLatex(node.text))
      continue
    }

    if (node.content != null) {
      chunks.push(convertInlineContent(node.content))
      continue
    }
  }

  return chunks.join('')
}

function applyInlineStyles(text: string, styles?: Record<string, unknown>): string {
  if (!styles) return text

  let out = text
  if (styles.code) out = `\\texttt{${out}}`
  if (styles.bold) out = `\\textbf{${out}}`
  if (styles.italic) out = `\\textit{${out}}`
  if (styles.underline) out = `\\underline{${out}}`
  return out
}

function extractPlainTextFromInline(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'text' in item) {
        return String((item as { text?: string }).text || '')
      }
      return ''
    })
    .join('')
}

function headingCommand(level: number): string {
  if (level <= 1) return 'section'
  if (level === 2) return 'subsection'
  if (level === 3) return 'subsubsection'
  if (level === 4) return 'paragraph'
  return 'subparagraph'
}

function generateLatexDocument(
  doc: AppDocument,
  content: string,
  citationsInput: CitationData[],
  context: { language: LatexExportLanguage; abstractText: string }
): string {
  const title = escapeLatex(doc.articleTitle || doc.title || 'Untitled')
  const author = formatAuthors(doc)
  const date = escapeLatex(doc.articleDate || '')
  const abstract = escapeLatex(context.abstractText)
  const keywords = (doc.articleKeywords || []).map(escapeLatex).join(', ')
  const useChinese = context.language === 'zh'
    ? true
    : context.language === 'en'
      ? false
      : containsChinese([title, author, abstract, keywords, content].join('\n'))

  const bibliography = buildBibliography(citationsInput)

  const preamble = useChinese
    ? [
        '\\documentclass[12pt,a4paper]{ctexart}',
        '\\usepackage{graphicx}',
        '\\usepackage{amsmath}',
        '\\usepackage{hyperref}',
        '\\usepackage{listings}',
        '\\usepackage{xcolor}',
      ]
    : [
        '\\documentclass[12pt,a4paper]{article}',
        '\\usepackage[utf8]{inputenc}',
        '\\usepackage[T1]{fontenc}',
        '\\usepackage{graphicx}',
        '\\usepackage{amsmath}',
        '\\usepackage{hyperref}',
        '\\usepackage{listings}',
        '\\usepackage{xcolor}',
      ]

  return [
    ...preamble,
    '',
    `\\title{${title}}`,
    `\\author{${author}}`,
    `\\date{${date}}`,
    '',
    '\\begin{document}',
    '',
    '\\maketitle',
    '',
    '\\begin{abstract}',
    abstract,
    '\\end{abstract}',
    '',
    keywords ? `\\textbf{Keywords:} ${keywords}` : '',
    '',
    content,
    '',
    bibliography,
    '',
    '\\end{document}',
    '',
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n')
}

function formatAuthors(doc: AppDocument): string {
  const authors = doc.articleAuthors || []
  if (authors.length === 0) return 'Unknown Author'

  const authorEntries = authors
    .map((author) => {
      const lines: string[] = []
      if (author.name?.trim()) {
        lines.push(escapeLatex(author.name.trim()))
      }
      if (author.affiliation?.trim()) {
        lines.push(escapeLatex(author.affiliation.trim()))
      }
      if (author.email?.trim()) {
        const safeMail = escapeLatex(author.email.trim())
        lines.push(`\\texttt{${safeMail}}`)
      }

      return lines.join(' \\\\ ')
    })
    .filter(Boolean)

  if (authorEntries.length === 0) return 'Unknown Author'
  return authorEntries.join(' \\and ')
}

function parseAbstractSection(blocks: UnknownBlock[]): ParsedAbstract | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    const blockText = extractBlockText(block).trim()
    if (!blockText) continue

    const normalized = blockText.toLowerCase().replace(/\s+/g, ' ')
    const isAbstractHeading = normalized === 'abstract' || normalized === 'abstract:' || blockText === '摘要' || blockText === '摘要：'
    const inlineMatch = blockText.match(/^\s*(abstract|摘要)\s*[:：]\s*(.+)$/i)

    if (isAbstractHeading) {
      const lines: string[] = []
      let endIndex = i

      for (let j = i + 1; j < blocks.length; j += 1) {
        const next = blocks[j]
        if (next.type === 'heading') break
        const nextText = extractBlockText(next).trim()
        if (nextText) lines.push(nextText)
        endIndex = j
      }

      return {
        text: lines.join('\n').trim(),
        startIndex: i,
        endIndex,
      }
    }

    if (inlineMatch) {
      return {
        text: inlineMatch[2].trim(),
        startIndex: i,
        endIndex: i,
      }
    }
  }

  return null
}

function extractAbstractFromBlocks(blocks: UnknownBlock[]): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''

  let abstractStart = -1
  let inlineAbstractText = ''

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]
    const blockText = extractBlockText(block).trim()
    if (!blockText) continue

    const normalized = blockText.toLowerCase().replace(/\s+/g, ' ')
    const isAbstractHeading = normalized === 'abstract' || normalized === 'abstract:' || blockText === '摘要' || blockText === '摘要：'
    const inlineMatch = blockText.match(/^\s*(abstract|摘要)\s*[:：]\s*(.+)$/i)

    if (isAbstractHeading) {
      abstractStart = i + 1
      break
    }

    if (inlineMatch) {
      abstractStart = i + 1
      inlineAbstractText = inlineMatch[2].trim()
      break
    }
  }

  if (abstractStart < 0) return ''

  const lines: string[] = []
  if (inlineAbstractText) lines.push(inlineAbstractText)

  for (let i = abstractStart; i < blocks.length; i += 1) {
    const block = blocks[i]
    if (block.type === 'heading') break

    const text = extractBlockText(block).trim()
    if (!text) continue
    lines.push(text)
  }

  return lines.join('\n')
}

function extractBlockText(block: UnknownBlock): string {
  const textFromContent = extractPlainTextFromRichInline(block.content)
  if (textFromContent.trim()) return textFromContent

  if (!Array.isArray(block.children) || block.children.length === 0) return ''
  return block.children.map((child) => extractBlockText(child)).filter(Boolean).join('\n')
}

function extractPlainTextFromRichInline(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((item) => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''

      const node = item as { text?: string; type?: string; content?: unknown; props?: Record<string, unknown> }
      if (typeof node.text === 'string') return node.text
      if (node.type === 'formula') return String(node.props?.latex || '')
      if (node.content != null) return extractPlainTextFromRichInline(node.content)
      return ''
    })
    .join('')
}

function containsChinese(text: string): boolean {
  return /[\u3400-\u9FFF]/.test(text)
}

function buildBibliography(citationsInput: CitationData[]): string {
  if (!Array.isArray(citationsInput) || citationsInput.length === 0) return ''

  const citations = [...citationsInput].sort((a, b) => a.index - b.index)
  const lines = ['\\begin{thebibliography}{99}']

  for (const c of citations) {
    const text = formatCitationText(c)
    lines.push(`\\bibitem{ref${c.index}} ${text}`)
  }

  lines.push('\\end{thebibliography}')
  return lines.join('\n')
}

function formatCitationText(citation: CitationData): string {
  const bib = citation.bib?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  if (bib) return escapeLatex(bib)

  const segments = [
    citation.authors?.length ? citation.authors.join(', ') : '',
    citation.title || '',
    citation.journal || '',
    citation.year || '',
  ]
    .map((s) => s.trim())
    .filter(Boolean)

  if (citation.doi) {
    segments.push(`DOI: ${citation.doi}`)
  } else if (citation.url) {
    segments.push(citation.url)
  }

  return escapeLatex(segments.join('. '))
}

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function escapeLatexPath(text: string): string {
  return text.replace(/\\/g, '/').replace(/ /g, '\\ ')
}

function escapeLatexUrl(url: string): string {
  return url.replace(/\\/g, '/').replace(/}/g, '%7D').replace(/{/g, '%7B')
}

function buildCompileGuide(language: LatexExportLanguage): string {
  const languageLabel = language === 'zh' ? '中文模板（ctex）' : language === 'en' ? '英文模板（article）' : '自动检测模板（auto）'

  return [
    '# LaTeX Export Compile Guide',
    '',
    `导出模板：${languageLabel}`,
    '',
    '## 目录说明',
    '- main.tex: 主 LaTeX 文件',
    '- images/: 图片资源目录',
    '- document.md: 编辑器内容对应的 Markdown（便于二次处理）',
    '',
    '## 编译 main.tex',
    '',
    '### 中文模板（ctex）推荐',
    '```bash',
    'xelatex -interaction=nonstopmode main.tex',
    'xelatex -interaction=nonstopmode main.tex',
    '```',
    '',
    '### 英文模板（article）可用',
    '```bash',
    'pdflatex -interaction=nonstopmode main.tex',
    'pdflatex -interaction=nonstopmode main.tex',
    '```',
    '',
    '## Markdown 如何编译',
    '使用 pandoc 可直接把 document.md 转成 PDF/LaTeX：',
    '',
    '### Markdown -> PDF',
    '```bash',
    'pandoc document.md -o document.pdf',
    '```',
    '',
    '### Markdown -> LaTeX',
    '```bash',
    'pandoc document.md -o document_from_md.tex',
    '```',
    '',
    '提示：如果你只关心论文排版，优先编译 main.tex（它包含作者、摘要、关键词、引用和图片路径）。',
    '',
  ].join('\n')
}
