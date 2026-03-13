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
  type: 'insert' | 'delete' | 'update'
  params: Record<string, string>
  content: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 流式工具检测器
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamingToolState {
  type: 'insert' | 'delete' | 'update'
  params: Record<string, string>
  contentSoFar: string
  isComplete: boolean
}

export class StreamingToolDetector {
  private prevCompleted = new Set<number>()

  /**
   * 增量扫描全文，检测 ::insert/::update/::delete 模式
   * 返回检测到的工具列表和新完成的工具索引
   */
  process(fullText: string): {
    detected: StreamingToolState[]
    completedIndices: number[]
  } {
    const detected: StreamingToolState[] = []
    const completedIndices: number[] = []

    // 匹配完成的 ::insert ... ::
    const insertRegex = /::insert\s+(before|after)?\s*(\S*)?\n([\s\S]*?)\n::/g
    let match
    while ((match = insertRegex.exec(fullText)) !== null) {
      const idx = detected.length
      detected.push({
        type: 'insert',
        params: { position: match[1] || 'after', referenceId: match[2] || '' },
        contentSoFar: match[3].trim(),
        isComplete: true,
      })
      if (!this.prevCompleted.has(idx)) {
        this.prevCompleted.add(idx)
        completedIndices.push(idx)
      }
    }

    // 匹配完成的 ::update blockId ... ::
    const updateRegex = /::update\s+(\S+)\n([\s\S]*?)\n::/g
    while ((match = updateRegex.exec(fullText)) !== null) {
      const idx = detected.length
      detected.push({
        type: 'update',
        params: { blockId: match[1] },
        contentSoFar: match[2].trim(),
        isComplete: true,
      })
      if (!this.prevCompleted.has(idx)) {
        this.prevCompleted.add(idx)
        completedIndices.push(idx)
      }
    }

    // 匹配 ::delete blockId（单行，总是完成的）
    const deleteRegex = /^::delete\s+(\S+)\s*$/gm
    while ((match = deleteRegex.exec(fullText)) !== null) {
      const idx = detected.length
      detected.push({
        type: 'delete',
        params: { blockId: match[1] },
        contentSoFar: '',
        isComplete: true,
      })
      if (!this.prevCompleted.has(idx)) {
        this.prevCompleted.add(idx)
        completedIndices.push(idx)
      }
    }

    // 检测尾部不完整的 ::insert（正在流式输出中）
    // 先移除所有已完成的 tool call，检查剩余文本
    let remaining = fullText
      .replace(/::insert\s+(before|after)?\s*(\S*)?\n[\s\S]*?\n::/g, '')
      .replace(/::update\s+\S+\n[\s\S]*?\n::/g, '')
      .replace(/^::delete\s+\S+\s*$/gm, '')

    const trailingInsert = remaining.match(/::insert\s+(before|after)?\s*(\S*)?\n([\s\S]*)$/)
    if (trailingInsert) {
      detected.push({
        type: 'insert',
        params: { position: trailingInsert[1] || 'after', referenceId: trailingInsert[2] || '' },
        contentSoFar: trailingInsert[3].trim(),
        isComplete: false,
      })
    }

    const trailingUpdate = remaining.match(/::update\s+(\S+)\n([\s\S]*)$/)
    if (trailingUpdate) {
      detected.push({
        type: 'update',
        params: { blockId: trailingUpdate[1] },
        contentSoFar: trailingUpdate[2].trim(),
        isComplete: false,
      })
    }

    return { detected, completedIndices }
  }
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
 */
export function parseSimpleToolCalls(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = []
  let match

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
        // Multi-block update: insert extra blocks after the updated one
        if (blocks.length > 1) {
          operations.push({
            type: 'insert',
            position: 'after',
            referenceId: call.params.blockId,
            blocks: blocks.slice(1),
          })
        }
      }
    }
  }
  
  return { operations }
}

/**
 * 将文本转换为 BlockNote 块数组
 * 优先使用 BlockNote 内置的 tryParseMarkdownToBlocks（支持完整 Markdown 语法）
 * 回退到简易解析器
 */
export function textToBlocks(text: string): PartialBlock<any, any, any>[] {
  const editor = getEditor()
  if (editor) {
    try {
      const blocks = editor.tryParseMarkdownToBlocks(text)
      if (blocks && blocks.length > 0) return blocks
    } catch {
      // Fallback to simple parser
    }
  }
  return simpleTextToBlocks(text)
}

/**
 * 简易 Markdown 解析器（fallback）
 * 支持基础语法：标题 (#)、无序列表 (-)、有序列表 (1.)、代码块
 */
function simpleTextToBlocks(text: string): PartialBlock<any, any, any>[] {
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

function blockExists(editor: NonNullable<ReturnType<typeof getEditor>>, blockId: string): boolean {
  return editor.document.some((block: any) => block.id === blockId)
}

/**
 * 从块中提取纯文本用于预览
 * 递归遍历 content 数组，提取所有 text 节点的文本
 */
function extractBlockPreviewText(block: any): string {
  if (!block) return ''
  const content = block.content
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((c: any) => {
      if (typeof c === 'string') return c
      if (c?.text) return c.text
      if (c?.content) return extractBlockPreviewText(c)
      return ''
    }).join('')
  }
  return ''
}

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

  // Collect all inner block positions first to avoid stale-position issues
  const innerBlockPositions: number[] = []
  const innerFrom = blockFrom + 1
  const innerTo = blockTo - 1

  if (innerFrom < innerTo) {
    doc.nodesBetween(innerFrom, innerTo, (node, pos) => {
      if (node.isBlock) innerBlockPositions.push(pos)
      return true
    })
  }

  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)
    tr.addNodeMark(blockFrom, insertionMark.create())
    if (innerFrom < innerTo) {
      tr.addMark(innerFrom, innerTo, insertionMark.create())
      for (const pos of innerBlockPositions) {
        tr.addNodeMark(pos, insertionMark.create())
      }
    }
  })
}

async function animateInsertWithMark(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  block: PartialBlock<any, any, any>,
  referenceId: string,
  position: 'before' | 'after',
  signal: AbortSignal,
  opKey?: string,
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
    if (opKey) registerOperationBlockId(opKey, insertedId)
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
  if (opKey) registerOperationBlockId(opKey, insertedId)
  return insertedId
}

// 按操作 key 存储插入的块ID，用于后续按操作接受/撤销
const operationBlockIds = new Map<string, Set<string>>()
// 按操作 key 存储更新操作的旧块内容，用于撤销恢复
const operationOldBlocks = new Map<string, Array<{ blockId: string; oldBlock: any }>>()

function registerOperationBlockId(opKey: string, blockId: string) {
  if (!operationBlockIds.has(opKey)) {
    operationBlockIds.set(opKey, new Set())
  }
  operationBlockIds.get(opKey)!.add(blockId)
}

// 移除 insertionMark 标记（接受更改时调用）
// 传入 opKey 时只影响该操作的块，否则影响所有
export function acceptInsertionChanges(opKey?: string): void {
  const editor = getEditor()
  if (!editor) return

  const schema = editor.prosemirrorState.schema
  const insertionMark = schema.marks['insertion']
  if (!insertionMark) return

  if (opKey && operationBlockIds.has(opKey)) {
    // 按操作作用域移除标记
    const blockIds = operationBlockIds.get(opKey)!

    // Pass 1: collect all positions that need mark removal (node marks + inline ranges)
    const nodeMarkPositions: number[] = []
    const inlineRanges: Array<{ from: number; to: number }> = []

    editor.prosemirrorState.doc.descendants((node, pos) => {
      if (node.isBlock && node.attrs?.id && blockIds.has(node.attrs.id)) {
        const hasMark = (node.marks || []).some((m: any) => m.type === insertionMark)
        if (hasMark) {
          nodeMarkPositions.push(pos)
        }
        // Collect inline range for this block
        const innerFrom = pos + 1
        const innerTo = pos + node.nodeSize - 1
        if (innerFrom < innerTo) {
          inlineRanges.push({ from: innerFrom, to: innerTo })
        }
      }
      return true
    })

    // Pass 2: apply changes in reverse order to avoid position shifts
    editor.transact((tr) => {
      tr.setMeta('addToHistory', false)
      // Remove inline marks first (doesn't affect block positions)
      for (const range of inlineRanges) {
        tr.removeMark(range.from, range.to, insertionMark)
      }
      // Remove node marks in reverse order
      for (let i = nodeMarkPositions.length - 1; i >= 0; i--) {
        const pos = nodeMarkPositions[i]
        const node = tr.doc.nodeAt(pos)
        if (node) {
          const filteredMarks = (node.marks || []).filter((m: any) => m.type !== insertionMark)
          tr.setNodeMarkup(pos, undefined, undefined, filteredMarks)
        }
      }
    })
    operationBlockIds.delete(opKey)
    operationOldBlocks.delete(opKey)
  } else {
    // 全局回退：先移除所有 inline mark，再移除 node mark
    const nodeMarkPositions: number[] = []

    editor.prosemirrorState.doc.descendants((node, pos) => {
      if (node.isBlock && node.marks?.length) {
        const hasMark = node.marks.some((m: any) => m.type === insertionMark)
        if (hasMark) nodeMarkPositions.push(pos)
      }
      return true
    })

    editor.transact((tr) => {
      tr.setMeta('addToHistory', false)
      // Remove all inline marks first
      tr.removeMark(0, tr.doc.content.size, insertionMark)
      // Remove node marks in reverse order
      for (let i = nodeMarkPositions.length - 1; i >= 0; i--) {
        const pos = nodeMarkPositions[i]
        const node = tr.doc.nodeAt(pos)
        if (node) {
          const filteredMarks = (node.marks || []).filter((m: any) => m.type !== insertionMark)
          tr.setNodeMarkup(pos, undefined, undefined, filteredMarks)
        }
      }
    })
    operationBlockIds.clear()
    operationOldBlocks.clear()
  }
}

// 撤销操作（撤销更改时调用）
// insert 操作：删除插入的块
// update 操作：恢复旧块内容
export function rejectInsertionChanges(opKey?: string): void {
  const editor = getEditor()
  if (!editor) return

  if (opKey) {
    // Revert update operations: restore old block content
    if (operationOldBlocks.has(opKey)) {
      const oldBlocks = operationOldBlocks.get(opKey)!
      for (const { blockId, oldBlock } of oldBlocks) {
        if (blockExists(editor, blockId)) {
          editor.updateBlock(blockId, oldBlock)
        }
      }
      operationOldBlocks.delete(opKey)
    }

    // Remove inserted blocks
    if (operationBlockIds.has(opKey)) {
      const blockIds = operationBlockIds.get(opKey)!
      editor.removeBlocks([...blockIds])
      operationBlockIds.delete(opKey)
    }
  } else {
    // Global fallback: revert all updates
    for (const [, oldBlocks] of operationOldBlocks) {
      for (const { blockId, oldBlock } of oldBlocks) {
        if (blockExists(editor, blockId)) {
          editor.updateBlock(blockId, oldBlock)
        }
      }
    }
    operationOldBlocks.clear()

    // Remove all inserted blocks
    const schema = editor.prosemirrorState.schema
    const insertionMark = schema.marks['insertion']
    if (!insertionMark) return

    const blocksToRemove: string[] = []
    editor.prosemirrorState.doc.descendants((node) => {
      if (node.isBlock && node.attrs?.id) {
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
    operationBlockIds.clear()
  }
}

// 获取某个操作的旧块文本（用于 diff 预览）
export function getOldBlockText(opKey: string): string | null {
  const oldBlocks = operationOldBlocks.get(opKey)
  if (!oldBlocks || oldBlocks.length === 0) return null
  return oldBlocks.map(({ oldBlock }) => {
    const content = oldBlock?.content
    if (!content) return ''
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join('')
    }
    return ''
  }).join('\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// Diff 算法（字符级）
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffSegment {
  type: 'equal' | 'delete' | 'insert'
  text: string
}

/**
 * 简单 diff：基于最长公共子序列（LCS）计算差异
 * 用于短文本对比（update 操作预览）
 */
export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  // 快速路径
  if (oldText === newText) return [{ type: 'equal', text: oldText }]
  if (!oldText) return [{ type: 'insert', text: newText }]
  if (!newText) return [{ type: 'delete', text: oldText }]

  // 按词级别分词以获得更好的可读性
  const oldWords = tokenize(oldText)
  const newWords = tokenize(newText)

  // LCS DP
  const m = oldWords.length
  const n = newWords.length

  // 对超长文本做简单截断避免 O(n*m) 爆内存
  if (m * n > 50000) {
    return [
      { type: 'delete', text: oldText },
      { type: 'insert', text: newText },
    ]
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  const segments: DiffSegment[] = []
  let i = m
  let j = n

  const rawSegments: DiffSegment[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      rawSegments.push({ type: 'equal', text: oldWords[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawSegments.push({ type: 'insert', text: newWords[j - 1] })
      j--
    } else {
      rawSegments.push({ type: 'delete', text: oldWords[i - 1] })
      i--
    }
  }

  rawSegments.reverse()

  // Merge consecutive segments of same type
  for (const seg of rawSegments) {
    if (segments.length > 0 && segments[segments.length - 1].type === seg.type) {
      segments[segments.length - 1].text += seg.text
    } else {
      segments.push({ ...seg })
    }
  }

  return segments
}

function tokenize(text: string): string[] {
  // Split into words and whitespace, keeping delimiters
  return text.match(/\S+|\s+/g) || []
}

export async function applyEditOperations(
  request: EditDocumentRequest,
  onProgress: (msg: string) => void,
  signal: AbortSignal,
  opKey?: string,
): Promise<{ success: boolean; error?: string }> {
  const editor = getEditor()
  if (!editor) return { success: false, error: '未找到编辑器，请先打开一个文档' }

  const blocks = editor.document
  const lastBlockId = blocks[blocks.length - 1]?.id

  for (const op of request.operations) {
    if (signal.aborted) break

    if (op.type === 'insert') {
      let refId = op.referenceId || lastBlockId
      // Validate referenceId exists, fallback to last block
      if (refId && refId !== lastBlockId && !blockExists(editor, refId)) {
        refId = lastBlockId
        onProgress('引用块不存在，将在文档末尾插入')
      }
      if (!refId) return { success: false, error: '文档为空，无法插入' }
      let prevId = refId
      for (const block of op.blocks) {
        if (signal.aborted) break
        onProgress('正在写入…')
        const newId = await animateInsertWithMark(editor, block, prevId, op.position, signal, opKey)
        if (newId) prevId = newId
        await delay(60 * jitter())
      }
    } else if (op.type === 'update') {
      if (!blockExists(editor, op.blockId)) {
        onProgress(`块 ${op.blockId.slice(0, 8)} 不存在，跳过更新`)
        continue
      }
      // Save old block content for undo
      if (opKey) {
        const oldBlock = editor.getBlock(op.blockId)
        if (oldBlock) {
          if (!operationOldBlocks.has(opKey)) {
            operationOldBlocks.set(opKey, [])
          }
          operationOldBlocks.get(opKey)!.push({ blockId: op.blockId, oldBlock: JSON.parse(JSON.stringify(oldBlock)) })
        }
      }
      onProgress('更新中…')
      editor.updateBlock(op.blockId, op.block as any)
      await delay(120 * jitter())
    } else if (op.type === 'delete') {
      if (!blockExists(editor, op.blockId)) {
        onProgress(`块 ${op.blockId.slice(0, 8)} 不存在，跳过删除`)
        continue
      }
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
  type: 'insert' | 'delete' | 'update'
  params: Record<string, string>
  content: string
  status: EditStatus
  progress: string
  error: string
  onAccept: () => void
  onReject: () => void
  opKey?: string
}

export function SimpleTool({ type, params, content, status, progress, error, onAccept, onReject, opKey }: SimpleToolProps) {
  const typeLabel = {
    insert: '插入内容',
    delete: '删除块',
    update: '更新块',
  }[type]

  const typeIcon = {
    insert: <InsertIcon />,
    delete: <DeleteIcon />,
    update: <UpdateIcon />,
  }[type]

  const isSettled = status === 'accepted' || status === 'rejected'
  
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
        {status === 'error' && <span style={{ color: '#ef4444', fontSize: 11 }}>✗ 失败</span>}
        {status === 'idle' && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>等待中…</span>}
      </div>
      
      {/* 内容预览 */}
      {type === 'insert' && content && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--bg-primary)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          maxHeight: 120,
          overflow: 'hidden',
        }}>
          {(() => {
            const blocks = textToBlocks(content)
            return blocks.slice(0, 4).map((block, i) => {
              const blockType = block.type || 'paragraph'
              const text = extractBlockPreviewText(block)
              const level = (block as any).props?.level

              let typeLabel = ''
              let prefix = ''
              if (blockType === 'heading') {
                typeLabel = `H${level}`
                prefix = `${'#'.repeat(level || 1)} `
              } else if (blockType === 'bulletListItem') {
                typeLabel = '列表'
                prefix = '- '
              } else if (blockType === 'numberedListItem') {
                typeLabel = '编号'
                prefix = `${i + 1}. `
              } else if (blockType === 'codeBlock') {
                typeLabel = '代码'
                prefix = ''
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
          {(() => {
            const blocks = textToBlocks(content)
            return blocks.length > 4 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                + 还有 {blocks.length - 4} 个块
              </div>
            ) : null
          })()}
        </div>
      )}

      {/* Update diff 预览 */}
      {type === 'update' && content && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--bg-primary)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          maxHeight: 150,
          overflow: 'auto',
        }}>
          {(() => {
            const oldText = opKey ? getOldBlockText(opKey) : null
            const newText = extractBlockPreviewText(textToBlocks(content)[0])
            if (!oldText) {
              // No old text available, just show new content
              return (
                <span style={{ color: '#10b981' }}>
                  {newText.slice(0, 200)}{newText.length > 200 && '…'}
                </span>
              )
            }
            const diff = computeDiff(oldText, newText)
            return (
              <div style={{ lineHeight: 1.8, wordBreak: 'break-all' }}>
                {diff.map((seg, i) => {
                  if (seg.type === 'equal') {
                    return <span key={i}>{seg.text}</span>
                  }
                  if (seg.type === 'delete') {
                    return (
                      <span key={i} style={{
                        textDecoration: 'line-through',
                        color: '#ef4444',
                        background: 'rgba(239, 68, 68, 0.08)',
                        borderRadius: 2,
                        padding: '0 1px',
                      }}>
                        {seg.text}
                      </span>
                    )
                  }
                  // insert
                  return (
                    <span key={i} style={{
                      color: '#10b981',
                      background: 'rgba(16, 185, 129, 0.08)',
                      borderRadius: 2,
                      padding: '0 1px',
                    }}>
                      {seg.text}
                    </span>
                  )
                })}
              </div>
            )
          })()}
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

