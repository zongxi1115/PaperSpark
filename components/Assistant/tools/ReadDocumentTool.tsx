'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getEditor } from '@/lib/editorContext'
import type { Block } from '@blocknote/core'

export interface DocumentReadResult {
  markdown: string
  blockCount: number
  charCount: number
}

// Convert a BlockNote block tree to readable markdown text
function blockToMarkdown(block: Block<any, any, any>, depth = 0): string {
  const indent = '  '.repeat(depth)
  const lines: string[] = []

  const inlineToText = (inline: unknown): string => {
    if (!inline) return ''
    if (Array.isArray(inline)) return inline.map(inlineToText).join('')
    if (typeof inline === 'string') return inline
    if (typeof inline !== 'object') return ''
    const r = inline as Record<string, unknown>
    if (r.type === 'text') return typeof r.text === 'string' ? r.text : ''
    if (r.type === 'link') return inlineToText(r.content)
    return inlineToText(r.content) || inlineToText(r.text)
  }

  const b = block as Record<string, unknown>
  const type = b.type as string
  const props = (b.props as Record<string, unknown>) || {}
  const content = b.content
  const children = (b.children as Block<any, any, any>[]) || []

  let prefix = ''
  let text = ''

  if (type === 'heading') {
    const level = (props.level as number) || 1
    prefix = '#'.repeat(level) + ' '
    text = inlineToText(content)
  } else if (type === 'paragraph') {
    text = inlineToText(content)
  } else if (type === 'bulletListItem') {
    prefix = indent + '- '
    text = inlineToText(content)
  } else if (type === 'numberedListItem') {
    prefix = indent + '1. '
    text = inlineToText(content)
  } else if (type === 'checkListItem') {
    const checked = props.checked ? '[x]' : '[ ]'
    prefix = indent + `- ${checked} `
    text = inlineToText(content)
  } else if (type === 'codeBlock') {
    const lang = (props.language as string) || ''
    const code = inlineToText(content)
    lines.push(`\`\`\`${lang}`)
    lines.push(code)
    lines.push('```')
    return lines.join('\n')
  } else if (type === 'table') {
    // table content is { type: 'tableContent', rows: [...] }
    const tableContent = content as Record<string, unknown> | null
    if (tableContent && tableContent.type === 'tableContent') {
      const rows = (tableContent.rows as Array<{ cells: unknown[][] }>) || []
      rows.forEach((row, rowIdx) => {
        const cells = row.cells.map(cell => inlineToText(cell).replace(/\|/g, '\\|').trim())
        lines.push('| ' + cells.join(' | ') + ' |')
        if (rowIdx === 0) {
          lines.push('| ' + cells.map(() => '---').join(' | ') + ' |')
        }
      })
    }
    return lines.join('\n')
  } else if (type === 'image') {
    const url = (props.url as string) || ''
    const caption = (props.caption as string) || ''
    return `![${caption}](${url})`
  } else {
    text = inlineToText(content)
  }

  if (text.trim() || prefix) {
    lines.push(prefix + text)
  }

  for (const child of children) {
    const childMd = blockToMarkdown(child, depth + 1)
    if (childMd) lines.push(childMd)
  }

  return lines.join('\n')
}

export function readDocument(): DocumentReadResult | null {
  const editor = getEditor()
  if (!editor) return null

  const blocks = editor.document as Block<any, any, any>[]
  const parts: string[] = []

  for (const block of blocks) {
    const md = blockToMarkdown(block)
    if (md.trim()) parts.push(md)
  }

  const markdown = parts.join('\n\n')
  const charCount = markdown.length
  const blockCount = blocks.length

  return { markdown, blockCount, charCount }
}

interface ReadDocumentToolProps {
  onResult: (result: DocumentReadResult) => void
}

export function ReadDocumentTool({ onResult }: ReadDocumentToolProps) {
  const [status, setStatus] = useState<'idle' | 'reading' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<string | null>(null)

  const handleRead = () => {
    setStatus('reading')
    setTimeout(() => {
      const result = readDocument()
      if (!result) {
        setStatus('error')
        return
      }
      setPreview(result.markdown.slice(0, 300) + (result.markdown.length > 300 ? '…' : ''))
      setStatus('done')
      onResult(result)
    }, 120)
  }

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      overflow: 'hidden',
      fontSize: 12,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: status !== 'idle' ? '1px solid var(--border-color)' : 'none',
      }}>
        <DocIcon />
        <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>读取文档</span>
        {status === 'idle' && (
          <button
            onClick={handleRead}
            style={{
              background: 'var(--accent-color)',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '3px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            读取
          </button>
        )}
        {status === 'reading' && (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>读取中…</span>
        )}
        {status === 'done' && (
          <span style={{ color: '#10b981', fontSize: 11 }}>✓ 已读取</span>
        )}
        {status === 'error' && (
          <span style={{ color: '#ef4444', fontSize: 11 }}>未找到编辑器</span>
        )}
      </div>

      <AnimatePresence>
        {status === 'done' && preview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 120,
              overflowY: 'auto',
              background: 'var(--bg-primary)',
            }}
          >
            {preview}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-color)', flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}
