import type { Block, BlockNoteEditor } from '@blocknote/core'
import { getEditor } from './editorContext'

export interface DocumentReadResult {
  markdown: string
  blockCount: number
  charCount: number
}

export interface DocumentBlockInfo {
  id: string
  type: string
  text: string
  level?: number
}

type AnyEditor = BlockNoteEditor<any, any, any> | null | undefined

function resolveEditor(editor?: AnyEditor): BlockNoteEditor<any, any, any> | null {
  return editor ?? getEditor()
}

export function extractInlineText(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(extractInlineText).join('')
  if (typeof content !== 'object') return ''

  const record = content as Record<string, unknown>
  if (record.type === 'text') return typeof record.text === 'string' ? record.text : ''
  if (record.type === 'formula') {
    const props = typeof record.props === 'object' && record.props !== null
      ? record.props as Record<string, unknown>
      : null
    return typeof props?.latex === 'string' ? `$${props.latex}$` : ''
  }
  if (record.type === 'link') return extractInlineText(record.content)
  if (record.type === 'tableContent' && Array.isArray(record.rows)) {
    return record.rows.map((row: any) =>
      (row.cells || []).map((cell: any) => extractInlineText(cell)).join(' | ')
    ).join(' / ')
  }

  return extractInlineText(record.content) || extractInlineText(record.text)
}

function blockToMarkdown(block: Block<any, any, any>, depth = 0): string {
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  const rawBlock = block as Record<string, unknown>
  const type = rawBlock.type as string
  const props = (rawBlock.props as Record<string, unknown>) || {}
  const content = rawBlock.content
  const children = (rawBlock.children as Block<any, any, any>[]) || []

  let prefix = ''
  let text = ''

  if (type === 'heading') {
    const level = (props.level as number) || 1
    prefix = '#'.repeat(level) + ' '
    text = extractInlineText(content)
  } else if (type === 'paragraph') {
    text = extractInlineText(content)
  } else if (type === 'bulletListItem') {
    prefix = indent + '- '
    text = extractInlineText(content)
  } else if (type === 'numberedListItem') {
    prefix = indent + '1. '
    text = extractInlineText(content)
  } else if (type === 'checkListItem') {
    const checked = props.checked ? '[x]' : '[ ]'
    prefix = indent + `- ${checked} `
    text = extractInlineText(content)
  } else if (type === 'codeBlock') {
    const language = (props.language as string) || ''
    const code = extractInlineText(content)
    lines.push(`\`\`\`${language}`)
    lines.push(code)
    lines.push('```')
    return lines.join('\n')
  } else if (type === 'table') {
    const tableContent = content as Record<string, unknown> | null
    if (tableContent?.type === 'tableContent' && Array.isArray(tableContent.rows)) {
      tableContent.rows.forEach((row: any, rowIndex) => {
        const cells = (row.cells || []).map((cell: unknown) => extractInlineText(cell).replace(/\|/g, '\\|').trim())
        lines.push(`| ${cells.join(' | ')} |`)
        if (rowIndex === 0) {
          lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
        }
      })
    }
    return lines.join('\n')
  } else if (type === 'image') {
    const url = (props.url as string) || ''
    const caption = (props.caption as string) || ''
    return `![${caption}](${url})`
  } else {
    text = extractInlineText(content)
  }

  if (text.trim() || prefix) {
    lines.push(prefix + text)
  }

  for (const child of children) {
    const childMarkdown = blockToMarkdown(child, depth + 1)
    if (childMarkdown) lines.push(childMarkdown)
  }

  return lines.join('\n')
}

export function readDocument(editor?: AnyEditor): DocumentReadResult | null {
  const activeEditor = resolveEditor(editor)
  if (!activeEditor) return null

  const blocks = activeEditor.document as Block<any, any, any>[]
  const parts: string[] = []

  for (const block of blocks) {
    const markdown = blockToMarkdown(block)
    if (markdown.trim()) parts.push(markdown)
  }

  const markdown = parts.join('\n\n')
  return {
    markdown,
    charCount: markdown.length,
    blockCount: blocks.length,
  }
}

export function getDocumentStructure(editor?: AnyEditor): DocumentBlockInfo[] | null {
  const activeEditor = resolveEditor(editor)
  if (!activeEditor) return null

  const blocks = activeEditor.document as Block<any, any, any>[]
  return blocks.map(block => {
    const rawBlock = block as Record<string, unknown>
    const type = (rawBlock.type as string) || 'paragraph'
    const props = (rawBlock.props as Record<string, unknown>) || {}

    return {
      id: block.id,
      type,
      text: extractInlineText(rawBlock.content).slice(0, 160),
      level: type === 'heading' ? (props.level as number) : undefined,
    }
  })
}
