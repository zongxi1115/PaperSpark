'use client'
import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getEditor } from '@/lib/editorContext'
import { AIExtension } from '@blocknote/xl-ai'
import type { PartialBlock } from '@blocknote/core'
import { insertBlocks } from '@blocknote/core'

export type EditOperation =
  | { type: 'insert'; position: 'before' | 'after'; referenceId?: string; blocks: PartialBlock<any, any, any>[] }
  | { type: 'update'; blockId: string; block: PartialBlock<any, any, any> }
  | { type: 'delete'; blockId: string }

export interface EditDocumentRequest {
  operations: EditOperation[]
}

export type EditStatus = 'idle' | 'running' | 'reviewing' | 'accepted' | 'rejected' | 'error'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))
const jitter = () => Math.random() * 0.3 + 0.85

function getBlockText(block: PartialBlock<any, any, any>): string {
  const content = (block as any).content
  if (!content) return ''
  if (Array.isArray(content)) {
    return content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('')
  }
  return ''
}

function buildPartialContent(block: PartialBlock<any, any, any>, text: string): any[] {
  const original = (block as any).content
  if (!Array.isArray(original) || original.length === 0) {
    return [{ type: 'text', text, styles: {} }]
  }
  let remaining = text
  return original.map((item: any) => {
    if (item.type !== 'text') return item
    const chunk = remaining.slice(0, item.text.length)
    remaining = remaining.slice(item.text.length)
    return { ...item, text: chunk }
  })
}

function markBlockAsInsertion(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  blockId: string,
) {
  const schema = editor.prosemirrorState.schema
  const insertionMark = schema.marks['insertion']
  if (!insertionMark) return

  const doc = editor.prosemirrorState.doc
  let blockFrom = -1
  let blockTo = -1

  doc.descendants((node, pos) => {
    if (blockFrom >= 0) return false
    if (node.attrs?.id === blockId) {
      blockFrom = pos
      blockTo = pos + node.nodeSize
      return false
    }
    return true
  })

  if (blockFrom < 0) return

  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    tr.addNodeMark(blockFrom, insertionMark.create())
    const innerFrom = blockFrom + 1
    const innerTo = blockTo - 1
    if (innerFrom < innerTo) {
      tr.addMark(innerFrom, innerTo, insertionMark.create())
      doc.nodesBetween(innerFrom, innerTo, (node, pos) => {
        if (node.isBlock) tr.addNodeMark(pos, insertionMark.create())
        return true
      })
    }
  })
}

async function animateInsertWithMark(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  block: PartialBlock<any, any, any>,
  referenceId: string,
  position: 'before' | 'after',
  signal: AbortSignal,
): Promise<string | null> {
  const emptyBlock: PartialBlock<any, any, any> = { type: block.type || 'paragraph', content: [] }
  let insertedId: string | null = null

  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    const inserted = insertBlocks(tr, [emptyBlock], referenceId, position)
    insertedId = inserted[0]?.id ?? null
  })

  if (!insertedId) return null

  const fullText = getBlockText(block)

  if (!fullText) {
    markBlockAsInsertion(editor, insertedId)
    insertedBlockIds.add(insertedId)
    return insertedId
  }

  const BATCH = 3
  for (let i = BATCH; i <= fullText.length; i += BATCH) {
    if (signal.aborted) return insertedId
    const partial = fullText.slice(0, i)
    editor.updateBlock(insertedId!, { ...block, content: buildPartialContent(block, partial) } as any)
    markBlockAsInsertion(editor, insertedId!)
    await delay(12 * jitter())
  }

  editor.updateBlock(insertedId, block as any)
  markBlockAsInsertion(editor, insertedId)
  insertedBlockIds.add(insertedId)
  return insertedId
}

// 存储插入的块ID，用于后续接受/撤销
const insertedBlockIds = new Set<string>()

// 移除所有 insertionMark 标记（接受更改时调用）
export function acceptInsertionChanges(): void {
  const editor = getEditor()
  if (!editor) return

  const schema = editor.prosemirrorState.schema
  const insertionMark = schema.marks['insertion']
  if (!insertionMark) return

  // 使用事务移除所有 insertionMark
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    
    // 移除文本级别的 mark
    tr.removeMark(0, tr.doc.content.size, insertionMark)
    
    // 移除块节点上的 nodeMark
    tr.doc.descendants((node, pos) => {
      if (node.isBlock && node.marks?.length) {
        const filteredMarks = node.marks.filter((m: any) => m.type !== insertionMark)
        if (filteredMarks.length !== node.marks.length) {
          tr.setNodeMarkup(pos, undefined, undefined, filteredMarks)
        }
      }
      return true
    })
  })

  // 清空记录
  insertedBlockIds.clear()
}

// 删除所有带 insertionMark 的块（撤销更改时调用）
export function rejectInsertionChanges(): void {
  const editor = getEditor()
  if (!editor) return

  const schema = editor.prosemirrorState.schema
  const insertionMark = schema.marks['insertion']
  if (!insertionMark) return

  const blocksToRemove: string[] = []

  editor.prosemirrorState.doc.descendants((node) => {
    if (node.isBlock && node.attrs?.id) {
      // 检查块本身是否有 insertionMark
      const hasMark = node.marks?.some((m: any) => m.type === insertionMark)
      if (hasMark) {
        blocksToRemove.push(node.attrs.id as string)
      }
    }
    return true
  })

  if (blocksToRemove.length > 0) {
    editor.removeBlocks(blocksToRemove)
  }

  // 清空记录
  insertedBlockIds.clear()
}

export async function applyEditOperations(
  request: EditDocumentRequest,
  onProgress: (msg: string) => void,
  signal: AbortSignal,
): Promise<{ success: boolean; error?: string }> {
  const editor = getEditor()
  if (!editor) return { success: false, error: '未找到编辑器，请先打开一个文档' }

  const blocks = editor.document
  const lastBlockId = blocks[blocks.length - 1]?.id

  for (const op of request.operations) {
    if (signal.aborted) break

    if (op.type === 'insert') {
      const refId = op.referenceId || lastBlockId
      if (!refId) return { success: false, error: '文档为空，无法插入' }
      let prevId = refId
      for (const block of op.blocks) {
        if (signal.aborted) break
        onProgress('正在写入…')
        const newId = await animateInsertWithMark(editor, block, prevId, op.position, signal)
        if (newId) prevId = newId
        await delay(60 * jitter())
      }
    } else if (op.type === 'update') {
      onProgress('更新中…')
      editor.updateBlock(op.blockId, op.block as any)
      await delay(120 * jitter())
    } else if (op.type === 'delete') {
      onProgress('删除中…')
      editor.removeBlocks([op.blockId])
      await delay(80 * jitter())
    }
  }

  return { success: true }
}

// ─── Display component (state lives in parent) ───────────────────────────────

interface EditDocumentToolProps {
  request: EditDocumentRequest
  status: EditStatus
  progress: string
  error: string
  onAccept: () => void
  onReject: () => void
}

export function EditDocumentTool({ request, status, progress, error, onAccept, onReject }: EditDocumentToolProps) {
  const opSummary = request.operations.map(op => {
    if (op.type === 'insert') return `插入 ${op.blocks.length} 个块`
    if (op.type === 'update') return `更新块`
    if (op.type === 'delete') return `删除块`
    return ''
  }).filter(Boolean).join('、')

  const isSettled = status === 'accepted' || status === 'rejected'

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      overflow: 'hidden',
      fontSize: 12,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
      opacity: isSettled ? 0.45 : 1,
      transition: 'opacity 0.25s',
      pointerEvents: isSettled ? 'none' : 'auto',
      margin: '4px 0',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: (status === 'running' || status === 'reviewing') ? '1px solid var(--border-color)' : 'none',
      }}>
        <EditIcon />
        <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>
          编辑文档
          {opSummary && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>— {opSummary}</span>
          )}
        </span>
        {status === 'accepted' && <span style={{ color: '#10b981', fontSize: 11 }}>✓ 已接受</span>}
        {status === 'rejected' && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>已撤销</span>}
        {status === 'error' && <span style={{ color: '#ef4444', fontSize: 11 }}>✗ 失败</span>}
        {status === 'idle' && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>等待中…</span>}
      </div>

      <AnimatePresence>
        {status === 'running' && (
          <motion.div key="progress"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
            style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-primary)' }}
          >
            <TypingDots />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{progress}</span>
          </motion.div>
        )}

        {status === 'reviewing' && (
          <motion.div key="review"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
            style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-primary)' }}
          >
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>内容已插入文档，请确认</span>
            <button onClick={onAccept} style={btnStyle('accent')}>接受</button>
            <button onClick={onReject} style={btnStyle('ghost')}>撤销</button>
          </motion.div>
        )}

        {status === 'error' && error && (
          <motion.div key="error"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
            style={{ padding: '6px 12px', color: '#ef4444', fontSize: 11, background: 'var(--bg-primary)' }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function btnStyle(variant: 'accent' | 'ghost'): React.CSSProperties {
  const base: React.CSSProperties = { border: 'none', borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer', flexShrink: 0 }
  if (variant === 'accent') return { ...base, background: 'var(--accent-color)', color: '#fff' }
  return { ...base, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }
}

function TypingDots() {
  return (
    <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <motion.span key={i}
          style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent-color)', display: 'inline-block' }}
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
