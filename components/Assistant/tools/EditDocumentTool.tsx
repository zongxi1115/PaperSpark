'use client'
import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getEditor } from '@/lib/editorContext'
import type { PartialBlock } from '@blocknote/core'

export type EditOperation =
  | { type: 'insert'; position: 'before' | 'after'; referenceId?: string; blocks: PartialBlock<any, any, any>[] }
  | { type: 'update'; blockId: string; block: PartialBlock<any, any, any> }
  | { type: 'delete'; blockId: string }

export interface EditDocumentRequest {
  operations: EditOperation[]
}

// Delay helpers matching xl-ai timing
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
const jitter = () => Math.random() * 0.3 + 0.85

async function animateInsertBlock(
  editor: ReturnType<typeof getEditor>,
  block: PartialBlock<any, any, any>,
  referenceId: string,
  position: 'before' | 'after',
  onProgress: (msg: string) => void,
) {
  if (!editor) return

  // Get the text content we'll be "typing"
  const getText = (b: PartialBlock<any, any, any>): string => {
    const content = (b as any).content
    if (!content) return ''
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('')
    }
    return ''
  }

  const fullText = getText(block)

  if (!fullText || fullText.length < 6) {
    // Short content: just insert directly
    editor.insertBlocks([block], referenceId, position)
    return
  }

  // Insert an empty block first
  const emptyBlock: PartialBlock<any, any, any> = { type: block.type || 'paragraph', content: [] }
  const inserted = editor.insertBlocks([emptyBlock], referenceId, position)
  const newId = inserted[0]?.id
  if (!newId) return

  onProgress(`正在写入…`)

  // Simulate typing character by character (batched for performance)
  const BATCH = 4
  let current = ''
  for (let i = 0; i < fullText.length; i += BATCH) {
    current += fullText.slice(i, i + BATCH)
    const updatedContent = buildContent(block, current)
    editor.updateBlock(newId, { ...block, content: updatedContent } as any)
    await delay(10 * jitter())
  }

  // Final update with full block (props, children, etc.)
  editor.updateBlock(newId, block as any)
}

function buildContent(
  block: PartialBlock<any, any, any>,
  text: string,
): any[] {
  const original = (block as any).content
  if (!Array.isArray(original) || original.length === 0) {
    return [{ type: 'text', text, styles: {} }]
  }
  // Rebuild inline content preserving styles but with partial text
  let remaining = text
  return original.map((item: any) => {
    if (item.type !== 'text') return item
    const chunk = remaining.slice(0, item.text.length)
    remaining = remaining.slice(item.text.length)
    return { ...item, text: chunk }
  })
}

export async function applyEditOperations(
  request: EditDocumentRequest,
  onProgress: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  const editor = getEditor()
  if (!editor) return { success: false, error: '未找到编辑器，请先打开一个文档' }

  const blocks = editor.document
  const lastBlockId = blocks[blocks.length - 1]?.id

  for (const op of request.operations) {
    if (signal?.aborted) break

    if (op.type === 'insert') {
      const refId = op.referenceId || lastBlockId
      if (!refId) {
        return { success: false, error: '文档为空，无法插入' }
      }
      for (const block of op.blocks) {
        if (signal?.aborted) break
        await animateInsertBlock(editor, block, refId, op.position, onProgress)
        await delay(80 * jitter())
      }
    } else if (op.type === 'update') {
      onProgress(`更新块 ${op.blockId}…`)
      editor.updateBlock(op.blockId, op.block as any)
      await delay(150 * jitter())
    } else if (op.type === 'delete') {
      onProgress(`删除块…`)
      editor.removeBlocks([op.blockId])
      await delay(100 * jitter())
    }
  }

  return { success: true }
}

interface EditDocumentToolProps {
  request: EditDocumentRequest
  onDone?: () => void
}

export function EditDocumentTool({ request, onDone }: EditDocumentToolProps) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const handleApply = async () => {
    setStatus('running')
    setProgress('准备中…')
    abortRef.current = new AbortController()

    const result = await applyEditOperations(
      request,
      (msg) => setProgress(msg),
      abortRef.current.signal,
    )

    if (result.success) {
      setStatus('done')
      setProgress('')
      onDone?.()
    } else {
      setStatus('error')
      setError(result.error || '操作失败')
    }
  }

  const handleAbort = () => {
    abortRef.current?.abort()
    setStatus('idle')
    setProgress('')
  }

  const opSummary = request.operations.map(op => {
    if (op.type === 'insert') return `插入 ${op.blocks.length} 个块`
    if (op.type === 'update') return `更新块`
    if (op.type === 'delete') return `删除块`
    return ''
  }).join('、')

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
        borderBottom: status === 'running' ? '1px solid var(--border-color)' : 'none',
      }}>
        <EditIcon />
        <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>
          编辑文档
          {opSummary && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
              — {opSummary}
            </span>
          )}
        </span>

        {status === 'idle' && (
          <button
            onClick={handleApply}
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
            应用
          </button>
        )}
        {status === 'running' && (
          <button
            onClick={handleAbort}
            style={{
              background: 'transparent',
              color: '#ef4444',
              border: '1px solid #ef4444',
              borderRadius: 5,
              padding: '3px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            停止
          </button>
        )}
        {status === 'done' && (
          <span style={{ color: '#10b981', fontSize: 11 }}>✓ 已完成</span>
        )}
        {status === 'error' && (
          <span style={{ color: '#ef4444', fontSize: 11 }}>✗ 失败</span>
        )}
      </div>

      <AnimatePresence>
        {status === 'running' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              padding: '6px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--bg-primary)',
            }}
          >
            <TypingDots />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{progress}</span>
          </motion.div>
        )}
        {status === 'error' && error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{
              padding: '6px 12px',
              color: '#ef4444',
              fontSize: 11,
              background: 'var(--bg-primary)',
            }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TypingDots() {
  return (
    <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: 'var(--accent-color)',
            display: 'inline-block',
          }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#f59e0b', flexShrink: 0 }}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}
