import type { Block, BlockNoteEditor, PartialBlock } from '@blocknote/core'

type FormulaKind = 'inline' | 'block'

type FormulaToken = {
  token: string
  latex: string
  kind: FormulaKind
}

type AnyEditor = Pick<
  BlockNoteEditor<any, any, any>,
  'tryParseMarkdownToBlocks' | 'getTextCursorPosition' | 'insertBlocks' | 'replaceBlocks' | 'insertInlineContent'
>

type TableCellLike = {
  type?: 'tableCell'
  content?: unknown
  props?: Record<string, unknown>
}

type TableContentLike = {
  type?: 'tableContent'
  rows?: Array<{ cells?: TableCellLike[] | unknown[] }>
  headerRows?: number
  headerCols?: number
  columnWidths?: Array<number | undefined>
}

const INLINE_FORMULA_TOKEN_PREFIX = 'PAPERSPARKINLINEFORMULA'
const BLOCK_FORMULA_TOKEN_PREFIX = 'PAPERSPARKBLOCKFORMULA'
const FORMULA_TOKEN_SUFFIX = 'TOKEN'
const FORMULA_TOKEN_PATTERN = /PAPERSPARK(?:INLINE|BLOCK)FORMULA\d+TOKEN/g

export function looksLikeMarkdownContent(text: string): boolean {
  const normalized = normalizeMarkdown(text).trim()
  if (!normalized) return false

  if (/^\s{0,3}#{1,6}\s/m.test(normalized)) return true
  if (/^\s*>\s/m.test(normalized)) return true
  if (/^\s*(?:[-*+]\s|\d+\.\s)/m.test(normalized)) return true
  if (/^\s*```/m.test(normalized)) return true
  if (/^\s*(?:---|\*\*\*|___)\s*$/m.test(normalized)) return true
  if (hasMarkdownTable(normalized)) return true
  if (/\$\$[\s\S]+?\$\$/m.test(normalized)) return true
  if (/(^|[^\$\\])\$[^$\n]+\$/.test(normalized)) return true
  if (/\*\*[^*]+\*\*/.test(normalized)) return true

  return false
}

export function convertMarkdownToBlocks(
  editor: Pick<BlockNoteEditor<any, any, any>, 'tryParseMarkdownToBlocks'> | null | undefined,
  markdown: string,
): PartialBlock<any, any, any>[] {
  const normalizedMarkdown = normalizeMarkdown(markdown)
  const prepared = tokenizeFormulas(normalizedMarkdown)

  let parsedBlocks: PartialBlock<any, any, any>[] = []

  if (editor) {
    try {
      parsedBlocks = editor.tryParseMarkdownToBlocks(prepared.markdown)
    } catch {
      parsedBlocks = []
    }
  }

  if (parsedBlocks.length === 0) {
    parsedBlocks = fallbackMarkdownToBlocks(prepared.markdown, prepared.formulas)
  }

  return restoreFormulaBlocks(parsedBlocks, prepared.formulas)
}

export function insertMarkdownBlocksAtCursor(editor: AnyEditor, markdown: string): boolean {
  const blocks = convertMarkdownToBlocks(editor, markdown)
  if (blocks.length === 0) return false

  if (blocks.length === 1 && isInlinePasteBlock(blocks[0])) {
    const inlineContent = Array.isArray(blocks[0].content) ? blocks[0].content : []
    if (inlineContent.length > 0) {
      editor.insertInlineContent(inlineContent as any)
      return true
    }
  }

  const cursorPosition = editor.getTextCursorPosition()
  const currentBlock = cursorPosition.block

  if (isEmptyParagraphBlock(currentBlock)) {
    editor.replaceBlocks([currentBlock.id], blocks)
  } else {
    editor.insertBlocks(blocks, currentBlock.id, 'after')
  }

  return true
}

function normalizeMarkdown(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function createFormulaToken(kind: FormulaKind, index: number): string {
  const prefix = kind === 'block' ? BLOCK_FORMULA_TOKEN_PREFIX : INLINE_FORMULA_TOKEN_PREFIX
  return `${prefix}${index}${FORMULA_TOKEN_SUFFIX}`
}

function tokenizeFormulas(markdown: string): { markdown: string; formulas: Map<string, FormulaToken> } {
  const formulas = new Map<string, FormulaToken>()
  const blockTokenized = tokenizeBlockFormulas(markdown, formulas)
  const inlineTokenized = tokenizeInlineFormulas(blockTokenized, formulas)

  return {
    markdown: inlineTokenized,
    formulas,
  }
}

function tokenizeBlockFormulas(markdown: string, formulas: Map<string, FormulaToken>): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let inFence = false
  let activeBlockFormula: { lines: string[] } | null = null

  const pushBlockFormula = (latex: string) => {
    const normalizedLatex = latex.trim()
    if (!normalizedLatex) {
      result.push('$$')
      return
    }

    const token = createFormulaToken('block', formulas.size)
    formulas.set(token, { token, latex: normalizedLatex, kind: 'block' })
    result.push(token)
  }

  for (const line of lines) {
    const trimmedLine = line.trim()

    if (!activeBlockFormula && isFenceLine(trimmedLine)) {
      inFence = !inFence
      result.push(line)
      continue
    }

    if (inFence) {
      result.push(line)
      continue
    }

    if (activeBlockFormula) {
      if (trimmedLine === '$$') {
        pushBlockFormula(activeBlockFormula.lines.join('\n'))
        activeBlockFormula = null
        continue
      }

      const endIndex = line.lastIndexOf('$$')
      if (trimmedLine.endsWith('$$') && endIndex >= 0) {
        const beforeClose = line.slice(0, endIndex)
        if (beforeClose.trim()) {
          activeBlockFormula.lines.push(beforeClose)
        }
        pushBlockFormula(activeBlockFormula.lines.join('\n'))
        activeBlockFormula = null
        continue
      }

      activeBlockFormula.lines.push(line)
      continue
    }

    const startMatch = line.match(/^\s*\$\$(.*)$/)
    if (!startMatch) {
      result.push(line)
      continue
    }

    const trailing = startMatch[1] ?? ''
    const trimmedTrailing = trailing.trim()

    if (trimmedTrailing.endsWith('$$')) {
      const closeIndex = trailing.lastIndexOf('$$')
      const latex = trailing.slice(0, closeIndex).trim()
      if (!latex) {
        result.push(line)
        continue
      }
      pushBlockFormula(latex)
      continue
    }

    activeBlockFormula = { lines: [] }
    if (trimmedTrailing) {
      activeBlockFormula.lines.push(trailing)
    }
  }

  if (activeBlockFormula) {
    result.push('$$')
    result.push(...activeBlockFormula.lines)
  }

  return result.join('\n')
}

function tokenizeInlineFormulas(markdown: string, formulas: Map<string, FormulaToken>): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let inFence = false

  for (const line of lines) {
    const trimmedLine = line.trim()

    if (isFenceLine(trimmedLine)) {
      inFence = !inFence
      result.push(line)
      continue
    }

    if (inFence) {
      result.push(line)
      continue
    }

    result.push(replaceInlineFormulasInLine(line, formulas))
  }

  return result.join('\n')
}

function replaceInlineFormulasInLine(line: string, formulas: Map<string, FormulaToken>): string {
  let result = ''

  for (let index = 0; index < line.length; index += 1) {
    const currentChar = line[index]

    if (currentChar === '`') {
      const closingBacktick = line.indexOf('`', index + 1)
      if (closingBacktick >= 0) {
        result += line.slice(index, closingBacktick + 1)
        index = closingBacktick
        continue
      }
    }

    if (currentChar === '$' && line[index + 1] !== '$' && (index === 0 || line[index - 1] !== '\\')) {
      let closingIndex = index + 1

      while (closingIndex < line.length) {
        if (line[closingIndex] === '$' && line[closingIndex - 1] !== '\\') {
          break
        }
        closingIndex += 1
      }

      if (closingIndex < line.length && line[closingIndex] === '$') {
        const latex = line.slice(index + 1, closingIndex).trim()
        if (latex) {
          const token = createFormulaToken('inline', formulas.size)
          formulas.set(token, { token, latex, kind: 'inline' })
          result += token
          index = closingIndex
          continue
        }
      }
    }

    result += currentChar
  }

  return result
}

function restoreFormulaBlocks(
  blocks: PartialBlock<any, any, any>[],
  formulas: Map<string, FormulaToken>,
): PartialBlock<any, any, any>[] {
  return blocks.map((block) => restoreFormulaBlock(block, formulas))
}

function restoreFormulaBlock(
  block: PartialBlock<any, any, any>,
  formulas: Map<string, FormulaToken>,
): PartialBlock<any, any, any> {
  const nextChildren = Array.isArray(block.children)
    ? restoreFormulaBlocks(block.children as PartialBlock<any, any, any>[], formulas)
    : block.children

  if (isTableContent(block.content)) {
    return {
      ...block,
      content: restoreFormulaTableContent(block.content, formulas) as any,
      children: nextChildren,
    }
  }

  if (Array.isArray(block.content)) {
    const standaloneToken = extractStandaloneToken(block.content, formulas)
    if (standaloneToken) {
      const formula = formulas.get(standaloneToken)
      if (formula?.kind === 'block') {
        return {
          ...block,
          type: 'paragraph',
          props: {
            ...(isRecord(block.props) ? block.props : {}),
            textAlignment: 'center',
          },
          content: [
            {
              type: 'formula',
              props: {
                latex: formula.latex,
              },
            },
          ] as any,
          children: nextChildren,
        }
      }
    }

    return {
      ...block,
      content: restoreFormulaInlineContent(block.content, formulas) as any,
      children: nextChildren,
    }
  }

  return {
    ...block,
    children: nextChildren,
  }
}

function restoreFormulaTableContent(
  content: TableContentLike,
  formulas: Map<string, FormulaToken>,
): TableContentLike {
  return {
    ...content,
    rows: (content.rows ?? []).map((row) => ({
      ...row,
      cells: (row.cells ?? []).map((cell) => {
        if (!isRecord(cell)) return cell
        const typedCell = cell as TableCellLike
        return {
          ...typedCell,
          type: typedCell.type ?? 'tableCell',
          content: Array.isArray(typedCell.content)
            ? restoreFormulaInlineContent(typedCell.content, formulas)
            : typedCell.content,
        }
      }),
    })),
  }
}

function restoreFormulaInlineContent(content: unknown[], formulas: Map<string, FormulaToken>): any[] {
  const result: any[] = []

  content.forEach((item) => {
    if (typeof item === 'string') {
      result.push(...splitTextWithFormulaTokens(item, {}, formulas))
      return
    }

    if (!isRecord(item)) {
      result.push(item)
      return
    }

    if (item.type === 'text' && typeof item.text === 'string') {
      result.push(...splitTextWithFormulaTokens(item.text, isRecord(item.styles) ? item.styles : {}, formulas))
      return
    }

    if (item.type === 'link' && Array.isArray(item.content)) {
      result.push({
        ...item,
        content: restoreFormulaInlineContent(item.content, formulas),
      })
      return
    }

    result.push(item)
  })

  return result
}

function splitTextWithFormulaTokens(
  text: string,
  styles: Record<string, unknown>,
  formulas: Map<string, FormulaToken>,
): Array<Record<string, unknown>> {
  const matches = Array.from(text.matchAll(new RegExp(FORMULA_TOKEN_PATTERN)))
  if (matches.length === 0) {
    return text ? [{ type: 'text', text, styles }] : []
  }

  const result: Array<Record<string, unknown>> = []
  let cursor = 0

  matches.forEach((match) => {
    const token = match[0]
    const start = match.index ?? 0
    const formula = formulas.get(token)

    if (start > cursor) {
      const plainText = text.slice(cursor, start)
      if (plainText) {
        result.push({ type: 'text', text: plainText, styles })
      }
    }

    if (formula) {
      result.push({
        type: 'formula',
        props: {
          latex: formula.latex,
        },
      })
    } else {
      result.push({ type: 'text', text: token, styles })
    }

    cursor = start + token.length
  })

  if (cursor < text.length) {
    const trailingText = text.slice(cursor)
    if (trailingText) {
      result.push({ type: 'text', text: trailingText, styles })
    }
  }

  return result
}

function extractStandaloneToken(content: unknown[], formulas: Map<string, FormulaToken>): string | null {
  const combined = content.map((item) => {
    if (typeof item === 'string') return item
    if (!isRecord(item)) return null
    if (item.type === 'text' && typeof item.text === 'string') return item.text
    return null
  })

  if (combined.some((item) => item === null)) {
    return null
  }

  const token = combined.join('').trim()
  return formulas.has(token) ? token : null
}

function fallbackMarkdownToBlocks(
  markdown: string,
  formulas: Map<string, FormulaToken>,
): PartialBlock<any, any, any>[] {
  const lines = markdown.split('\n')
  const blocks: PartialBlock<any, any, any>[] = []
  let paragraphLines: string[] = []

  const flushParagraph = () => {
    const text = paragraphLines.join('\n').trim()
    if (text) {
      blocks.push({
        type: 'paragraph',
        content: inlineTextToContent(text, formulas) as any,
      })
    }
    paragraphLines = []
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      flushParagraph()
      continue
    }

    if (hasMarkdownTableAt(lines, index)) {
      flushParagraph()
      const { block, nextIndex } = parseMarkdownTable(lines, index, formulas)
      blocks.push(block)
      index = nextIndex
      continue
    }

    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(trimmedLine)) {
      flushParagraph()
      blocks.push({ type: 'divider' })
      continue
    }

    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      blocks.push({
        type: 'heading',
        props: { level: headingMatch[1].length },
        content: inlineTextToContent(headingMatch[2], formulas) as any,
      })
      continue
    }

    const quoteMatch = trimmedLine.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushParagraph()
      const quoteLines = [quoteMatch[1]]
      while (index + 1 < lines.length && /^\s*>\s?/.test(lines[index + 1])) {
        index += 1
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''))
      }
      blocks.push({
        type: 'quote',
        content: inlineTextToContent(quoteLines.join('\n'), formulas) as any,
      })
      continue
    }

    const bulletMatch = trimmedLine.match(/^[-*+]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      blocks.push({
        type: 'bulletListItem',
        content: inlineTextToContent(bulletMatch[1], formulas) as any,
      })
      continue
    }

    const numberedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/)
    if (numberedMatch) {
      flushParagraph()
      blocks.push({
        type: 'numberedListItem',
        content: inlineTextToContent(numberedMatch[1], formulas) as any,
      })
      continue
    }

    paragraphLines.push(line)
  }

  flushParagraph()

  return blocks
}

function inlineTextToContent(text: string, formulas: Map<string, FormulaToken>): Array<Record<string, unknown>> {
  const content = splitTextWithFormulaTokens(text, {}, formulas)
  return content.length > 0 ? content : [{ type: 'text', text, styles: {} }]
}

function hasMarkdownTable(markdown: string): boolean {
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    if (hasMarkdownTableAt(lines, index)) {
      return true
    }
  }
  return false
}

function hasMarkdownTableAt(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false
  return isMarkdownTableRow(lines[index]) && isMarkdownTableDelimiter(lines[index + 1])
}

function isMarkdownTableRow(line: string): boolean {
  const trimmedLine = line.trim()
  if (!trimmedLine.includes('|')) return false
  return trimmedLine.startsWith('|') || trimmedLine.endsWith('|') || trimmedLine.split('|').length >= 3
}

function isMarkdownTableDelimiter(line: string): boolean {
  const normalizedLine = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells = normalizedLine.split('|').map((cell) => cell.trim())
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function parseMarkdownTable(
  lines: string[],
  startIndex: number,
  formulas: Map<string, FormulaToken>,
): { block: PartialBlock<any, any, any>; nextIndex: number } {
  const headerRow = splitMarkdownTableRow(lines[startIndex])
  const bodyRows: string[][] = []
  let index = startIndex + 2

  while (index < lines.length && isMarkdownTableRow(lines[index])) {
    bodyRows.push(splitMarkdownTableRow(lines[index]))
    index += 1
  }

  const columnCount = Math.max(
    headerRow.length,
    ...bodyRows.map((row) => row.length),
  )

  const toCells = (row: string[]) => Array.from({ length: columnCount }, (_, cellIndex) => ({
    type: 'tableCell' as const,
    content: inlineTextToContent(row[cellIndex] ?? '', formulas) as any,
  }))

  return {
    block: {
      type: 'table',
      content: {
        type: 'tableContent',
        headerRows: 1,
        headerCols: 0,
        columnWidths: Array.from({ length: columnCount }, () => undefined),
        rows: [
          { cells: toCells(headerRow) },
          ...bodyRows.map((row) => ({ cells: toCells(row) })),
        ],
      } as any,
    },
    nextIndex: index - 1,
  }
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmedLine = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmedLine.split('|').map((cell) => cell.trim())
}

function isInlinePasteBlock(block: PartialBlock<any, any, any>): boolean {
  if (block.type !== 'paragraph') return false
  if (Array.isArray(block.children) && block.children.length > 0) return false
  if (!Array.isArray(block.content)) return false

  const textAlignment = isRecord(block.props) ? block.props.textAlignment : undefined
  return textAlignment === undefined || textAlignment === 'left'
}

function isEmptyParagraphBlock(block: Block<any, any, any>): boolean {
  if (block.type !== 'paragraph') return false
  if (Array.isArray(block.children) && block.children.length > 0) return false

  if (Array.isArray(block.content)) {
    const text = block.content.map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) return ''
      const textItem = item as Record<string, unknown>
      if (textItem.type === 'text' && typeof textItem.text === 'string') return textItem.text
      return ''
    }).join('').trim()

    return text.length === 0
  }

  return true
}

function isTableContent(value: unknown): value is TableContentLike {
  return isRecord(value) && value.type === 'tableContent' && Array.isArray(value.rows)
}

function isFenceLine(line: string): boolean {
  return /^(```|~~~)/.test(line)
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}
