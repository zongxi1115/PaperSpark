'use client'
import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getEditor } from '@/lib/editorContext'
import { AIExtension } from '@blocknote/xl-ai'
import type { PartialBlock, Block } from '@blocknote/core'
import { insertBlocks } from '@blocknote/core'

// ─────────────────────────────────────────────────────────────────────────────
// 操作类型定义
// ─────────────────────────────────────────────────────────────────────────────

export type EditOperation =
  | { type: 'insert'; position: 'before' | 'after'; referenceId?: string; blocks: PartialBlock<any, any, any>[] }
  | { type: 'update'; blockId: string; block: PartialBlock<any, any, any> }
  | { type: 'delete'; blockId: string }

export interface EditDocumentRequest {
  operations: EditOperation[]
}

export type EditStatus = 'idle' | 'running' | 'reviewing' | 'accepted' | 'rejected' | 'error'

// ─────────────────────────────────────────────────────────────────────────────
// 文档结构信息
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentBlockInfo {
  id: string
  type: string
  text: string
  level?: number
}

/**
 * 获取当前文档的块结构信息
 */
export function getDocumentStructure(): DocumentBlockInfo[] | null {
  const editor = getEditor()
  if (!editor) return null

  const blocks = editor.document as Block<any, any, any>[]
  
  return blocks.map(block => {
    const b = block as Record<string, unknown>
    const type = (b.type as string) || 'paragraph'
    const props = (b.props as Record<string, unknown>) || {}
    const content = b.content
    
    // 提取文本内容
    const extractText = (c: unknown): string => {
      if (!c) return ''
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return c.map(extractText).join('')
      if (typeof c !== 'object') return ''
      const r = c as Record<string, unknown>
      if (r.type === 'text') return typeof r.text === 'string' ? r.text : ''
      if (r.type === 'link') return extractText(r.content)
      if (r.type === 'tableContent' && Array.isArray(r.rows)) {
        return r.rows.map((row: any) => 
          (row.cells || []).map((cell: any) => extractText(cell)).join(' | ')
        ).join(' / ')
      }
      return extractText(r.content) || extractText(r.text)
    }
    
    const text = extractText(content).slice(0, 100)
    
    return {
      id: block.id,
      type,
      text,
      level: type === 'heading' ? (props.level as number) : undefined,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 简化格式解析
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedToolCall {
  type: 'insert' | 'delete' | 'update' | 'read_document'
  params: Record<string, string>
  content: string
}

/**
 * 解析简化的工具调用格式
 * 
 * 格式示例：
 * ::insert after block-123
 * 要插入的内容
 * ::
 * 
 * ::delete block-123
 * 
 * ::update block-123
 * 更新后的内容
 * ::
 * 
 * ::read_document
 */
export function parseSimpleToolCalls(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = []
  
  // 匹配 ::read_document
  const readRegex = /::read_document\b/g
  let match
  while ((match = readRegex.exec(text)) !== null) {
    results.push({
      type: 'read_document',
      params: {},
      content: '',
    })
  }
  
  // 匹配 ::insert [position] [referenceId]
  const insertRegex = /::insert\s+(before|after)?\s*(\S*)?\n([\s\S]*?)::/g
  while ((match = insertRegex.exec(text)) !== null) {
    const position = (match[1] as 'before' | 'after') || 'after'
    const referenceId = match[2] || undefined
    const content = match[3].trim()
    results.push({
      type: 'insert',
      params: { position, referenceId: referenceId || '' },
      content,
    })
  }
  
  // 匹配 ::delete blockId
  const deleteRegex = /::delete\s+(\S+)/g
  while ((match = deleteRegex.exec(text)) !== null) {
    const blockId = match[1]
    results.push({
      type: 'delete',
      params: { blockId },
      content: '',
    })
  }
  
  // 匹配 ::update blockId
  const updateRegex = /::update\s+(\S+)\n([\s\S]*?)::/g
  while ((match = updateRegex.exec(text)) !== null) {
    const blockId = match[1]
    const content = match[2].trim()
    results.push({
      type: 'update',
      params: { blockId },
      content,
    })
  }
  
  return results
}

/**
 * 将简化工具调用转换为 EditDocumentRequest
 */
export function convertToolCallsToRequest(toolCalls: ParsedToolCall[]): EditDocumentRequest {
  const operations: EditOperation[] = []
  
  for (const call of toolCalls) {
    if (call.type === 'insert') {
      // 将文本内容转换为块
      const blocks = textToBlocks(call.content)
      operations.push({
        type: 'insert',
        position: (call.params.position as 'before' | 'after') || 'after',
        referenceId: call.params.referenceId || undefined,
        blocks,
      })
    } else if (call.type === 'delete') {
      operations.push({
        type: 'delete',
        blockId: call.params.blockId,
      })
    } else if (call.type === 'update') {
      const blocks = textToBlocks(call.content)
      if (blocks.length > 0) {
        operations.push({
          type: 'update',
          blockId: call.params.blockId,
          block: blocks[0],
        })
      }
    }
  }
  
  return { operations }
}

/**
 * 将文本转换为 BlockNote 块数组
 * 支持 Markdown 格式：标题 (#)、无序列表 (-)、有序列表 (1.)
 */
export function textToBlocks(text: string): PartialBlock<any, any, any>[] {
  const lines = text.split('\n')
  const blocks: PartialBlock<any, any, any>[] = []
  let currentParagraph: string[] = []
  
  const flushParagraph = () => {
    const content = currentParagraph.join('\n').trim()
    if (content) {
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text: content, styles: {} }],
      })
    }
    currentParagraph = []
  }
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()
    
    // 空行：结束当前段落
    if (!trimmedLine) {
      flushParagraph()
      continue
    }
    
    // 标题：# ## ### 等
    const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      const level = headingMatch[1].length
      const text = headingMatch[2]
      blocks.push({
        type: 'heading',
        props: { level },
        content: [{ type: 'text', text, styles: {} }],
      })
      continue
    }
    
    // 无序列表：- * +
    const bulletMatch = trimmedLine.match(/^[-*+]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      blocks.push({
        type: 'bulletListItem',
        content: [{ type: 'text', text: bulletMatch[1], styles: {} }],
      })
      continue
    }
    
    // 有序列表：1. 2. 等
    const numberedMatch = trimmedLine.match(/^(\d+)\.\s+(.+)$/)
    if (numberedMatch) {
      flushParagraph()
      blocks.push({
        type: 'numberedListItem',
        content: [{ type: 'text', text: numberedMatch[2], styles: {} }],
      })
      continue
    }
    
    // 普通文本：累积到当前段落
    currentParagraph.push(trimmedLine)
  }
  
  // 处理剩余内容
  flushParagraph()
  
  // 如果没有任何块，创建一个空段落
  if (blocks.length === 0) {
    return [{
      type: 'paragraph',
      content: [{ type: 'text', text: text.trim(), styles: {} }],
    }]
  }
  
  return blocks
}

// ─────────────────────────────────────────────────────────────────────────────
// 核心操作逻辑
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// 显示组件
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// 单独的工具组件（用于简化格式显示）
// ─────────────────────────────────────────────────────────────────────────────

interface SimpleToolProps {
  type: 'insert' | 'delete' | 'update' | 'read_document'
  params: Record<string, string>
  content: string
  status: EditStatus
  progress: string
  error: string
  onAccept: () => void
  onReject: () => void
  readResult?: { blockCount: number; charCount: number } | null
}

export function SimpleTool({ type, params, content, status, progress, error, onAccept, onReject, readResult }: SimpleToolProps) {
  const typeLabel = {
    insert: '插入内容',
    delete: '删除块',
    update: '更新块',
    read_document: '读取文档',
  }[type]
  
  const typeIcon = {
    insert: <InsertIcon />,
    delete: <DeleteIcon />,
    update: <UpdateIcon />,
    read_document: <DocIcon />,
  }[type]
  
  const isSettled = status === 'accepted' || status === 'rejected' || status === 'success'
  
  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      overflow: 'hidden',
      fontSize: 12,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
      opacity: isSettled ? 0.7 : 1,
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
        {typeIcon}
        <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>
          {typeLabel}
          {type === 'insert' && params.position && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
              — {params.position === 'after' ? '之后' : '之前'}
            </span>
          )}
          {(type === 'delete' || type === 'update') && params.blockId && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 10, fontFamily: 'monospace' }}>
              {params.blockId.slice(0, 8)}…
            </span>
          )}
        </span>
        {status === 'accepted' && <span style={{ color: '#10b981', fontSize: 11 }}>✓ 已接受</span>}
        {status === 'rejected' && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>已撤销</span>}
        {status === 'success' && type === 'read_document' && readResult && (
          <span style={{ color: '#10b981', fontSize: 11 }}>✓ {readResult.blockCount} 块 / {readResult.charCount} 字</span>
        )}
        {status === 'error' && <span style={{ color: '#ef4444', fontSize: 11 }}>✗ 失败</span>}
        {status === 'idle' && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>等待中…</span>}
      </div>
      
      {/* read_document 特殊显示 */}
      {type === 'read_document' && status === 'success' && readResult && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--bg-primary)',
          fontSize: 11,
          color: 'var(--text-secondary)',
        }}>
          文档已读取：{readResult.blockCount} 个块，共 {readResult.charCount} 字符
        </div>
      )}
      
      {/* 显示内容预览 - 解析并显示块类型 */}
      {type !== 'delete' && type !== 'read_document' && content && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--bg-primary)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          maxHeight: 100,
          overflow: 'hidden',
        }}>
          {(() => {
            const blocks = textToBlocks(content)
            return blocks.slice(0, 3).map((block, i) => {
              const blockType = block.type || 'paragraph'
              const text = Array.isArray(block.content) 
                ? block.content.map((c: any) => c?.text || '').join('') 
                : ''
              const level = (block as any).props?.level
              
              let typeLabel = ''
              let prefix = ''
              if (blockType === 'heading') {
                typeLabel = `H${level}`
                prefix = `${'#'.repeat(level)} `
              } else if (blockType === 'bulletListItem') {
                typeLabel = '列表'
                prefix = '• '
              } else if (blockType === 'numberedListItem') {
                typeLabel = '编号'
                prefix = '1. '
              }
              
              return (
                <div key={i} style={{ marginBottom: 2, display: 'flex', gap: 6 }}>
                  {typeLabel && (
                    <span style={{ 
                      color: 'var(--accent-color)', 
                      fontSize: 9, 
                      padding: '1px 4px',
                      background: 'rgba(0, 153, 255, 0.1)',
                      borderRadius: 3,
                      flexShrink: 0,
                    }}>
                      {typeLabel}
                    </span>
                  )}
                  <span style={{ 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap',
                  }}>
                    {prefix}{text.slice(0, 80)}{text.length > 80 && '…'}
                  </span>
                </div>
              )
            })
          })()}
          {textToBlocks(content).length > 3 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
              + 还有 {textToBlocks(content).length - 3} 个块
            </div>
          )}
        </div>
      )}

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
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>操作已完成，请确认</span>
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

function InsertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#10b981', flexShrink: 0 }}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#ef4444', flexShrink: 0 }}>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  )
}

function UpdateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: '#f59e0b', flexShrink: 0 }}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-color)', flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}