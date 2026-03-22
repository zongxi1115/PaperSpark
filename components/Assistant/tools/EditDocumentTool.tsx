'use client'
import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getEditor } from '@/lib/editorContext'
import { convertMarkdownToBlocks } from '@/lib/blocknoteMarkdown'
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
type SuggestionId = string | number

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
      if (r.type === 'formula') {
        const props = typeof r.props === 'object' && r.props !== null
          ? r.props as Record<string, unknown>
          : null
        return typeof props?.latex === 'string' ? `$${props.latex}$` : ''
      }
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
  isComplete?: boolean
  sourceRange?: {
    start: number
    end: number
  }
}

interface ParseSimpleToolCallsOptions {
  includeIncomplete?: boolean
}

interface ToolHeaderMatch {
  type: 'insert' | 'delete' | 'update'
  params: Record<string, string>
}

interface ActiveToolCall {
  type: 'insert' | 'update'
  params: Record<string, string>
  contentLines: string[]
  start: number
}

function normalizeToolText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * 检测一行是否为工具调用头（容忍多余冒号、空格等）
 * 支持 ::insert, :::insert, :: insert 等变体
 */
function parseToolHeader(line: string): ToolHeaderMatch | null {
  const trimmedLine = line.trim()
  // 容忍 2+ 个冒号开头，可选空格，然后是操作类型
  const match = trimmedLine.match(/^:{2,}\s*(insert|update|delete)\b(.*)$/)
  if (!match) return null

  const type = match[1] as 'insert' | 'delete' | 'update'
  const remainder = match[2].trim()

  if (type === 'insert') {
    return parseInsertParams(remainder)
  }

  // delete/update 需要 blockId
  const blockId = remainder.split(/\s+/).find(Boolean) ?? ''
  // blockId 可能为空（参数在下一行），返回但标记为空
  return {
    type,
    params: { blockId },
  }
}

/**
 * 解析 insert 操作的参数
 * 支持多种格式：
 *   ::insert after block-123
 *   ::insert block-123          (默认 after)
 *   ::insert before block-123
 *   ::insert                    (参数在下一行)
 */
function parseInsertParams(remainder: string): ToolHeaderMatch {
  const tokens = remainder.split(/\s+/).filter(Boolean)
  let position: 'before' | 'after' = 'after'
  let referenceId = ''

  if (tokens[0] === 'before' || tokens[0] === 'after') {
    position = tokens[0]
    referenceId = tokens[1] ?? ''
  } else if (tokens[0]) {
    referenceId = tokens[0]
  }

  return {
    type: 'insert',
    params: { position, referenceId },
  }
}

/**
 * 尝试从一行文本中解析出参数（用于多行工具调用格式）
 * 支持：
 *   after block-123
 *   before block-123
 *   block-123
 *   blockId: block-123
 */
function parseToolParamsLine(line: string, toolType: 'insert' | 'delete' | 'update'): Record<string, string> | null {
  const trimmed = line.trim()
  // 跳过空行和工具调用头
  if (!trimmed || /^:{2,}\s*(insert|update|delete)\b/.test(trimmed) || trimmed === '::') return null

  if (toolType === 'insert') {
    const tokens = trimmed.split(/\s+/).filter(Boolean)
    let position: 'before' | 'after' = 'after'
    let referenceId = ''

    if (tokens[0] === 'before' || tokens[0] === 'after') {
      position = tokens[0]
      referenceId = tokens[1] ?? ''
    } else if (tokens[0]) {
      // 检查是否为 blockId 格式（非关键词）
      referenceId = tokens[0]
    }

    if (!referenceId) return null
    return { position, referenceId }
  }

  // delete / update
  // 支持 "block-123" 或 "blockId: block-123" 格式
  const kvMatch = trimmed.match(/^(?:blockId|block_id|id)\s*[:=]?\s*(.+)$/i)
  if (kvMatch) {
    return { blockId: kvMatch[1].trim() }
  }

  // 直接是 blockId
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length >= 1 && !tokens[0].startsWith(':')) {
    return { blockId: tokens[0] }
  }

  return null
}

function finalizeToolCall(active: ActiveToolCall, end: number, isComplete: boolean): ParsedToolCall {
  return {
    type: active.type,
    params: active.params,
    content: active.contentLines.join('\n').trim(),
    isComplete,
    sourceRange: {
      start: active.start,
      end,
    },
  }
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
    const detected = parseSimpleToolCalls(fullText, { includeIncomplete: true }).map((tool) => ({
      type: tool.type,
      params: tool.params,
      contentSoFar: tool.content,
      isComplete: tool.isComplete !== false,
    })) satisfies StreamingToolState[]
    const completedIndices: number[] = []

    detected.forEach((tool, idx) => {
      if (tool.isComplete && !this.prevCompleted.has(idx)) {
        this.prevCompleted.add(idx)
        completedIndices.push(idx)
      }
    })

    return { detected, completedIndices }
  }
}

/**
 * 解析简化的工具调用格式
 *
 * 支持单行和多行格式：
 *
 * 单行格式：
 * ::insert after block-123
 * 要插入的内容
 * ::
 *
 * 多行格式（容忍"傻模型"换行输出参数）：
 * ::insert
 * after block-123
 * 要插入的内容
 * ::
 *
 * ::update
 * block-123
 * 更新后的内容
 * ::
 *
 * ::delete block-123
 *
 * 也容忍多余冒号：:::insert, ::::delete 等
 */
export function parseSimpleToolCalls(text: string, options: ParseSimpleToolCallsOptions = {}): ParsedToolCall[] {
  const normalizedText = normalizeToolText(text)
  const results: ParsedToolCall[] = []
  const lines = normalizedText.split('\n')
  let activeTool: ActiveToolCall | null = null
  let pendingHeader: ToolHeaderMatch | null = null
  let pendingHeaderOffset = 0
  let offset = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const newlineLength = lineIndex < lines.length - 1 ? 1 : 0
    const nextOffset = offset + line.length + newlineLength

    // ── 在活跃工具中 ──
    if (activeTool) {
      const trimmed = line.trim()
      if (trimmed === '::' || trimmed.match(/^:{2,}$/)) {
        // 结束标记
        results.push(finalizeToolCall(activeTool, nextOffset, true))
        activeTool = null
        offset = nextOffset
        continue
      }
      activeTool.contentLines.push(line)
      offset = nextOffset
      continue
    }

    // ── 等待待确认的 header 参数 ──
    if (pendingHeader) {
      const params = parseToolParamsLine(line, pendingHeader.type)
      if (params) {
        // 合并参数到 header
        const mergedHeader: ToolHeaderMatch = {
          type: pendingHeader.type,
          params: { ...pendingHeader.params, ...params },
        }

        if (mergedHeader.type === 'delete') {
          // delete 不需要内容行，直接完成
          results.push({
            type: 'delete',
            params: mergedHeader.params,
            content: '',
            isComplete: true,
            sourceRange: {
              start: pendingHeaderOffset,
              end: nextOffset,
            },
          })
          pendingHeader = null
          offset = nextOffset
          continue
        }

        // insert / update：创建活跃工具，参数行不计入内容
        activeTool = {
          type: mergedHeader.type,
          params: mergedHeader.params,
          contentLines: [],
          start: pendingHeaderOffset,
        }
        pendingHeader = null
        offset = nextOffset
        continue
      }

      // 下一行不是参数行 → 当作无参数的工具调用处理
      const fallbackHeader = pendingHeader
      const fallbackStart = pendingHeaderOffset
      pendingHeader = null

      if (fallbackHeader.type === 'delete') {
        // delete 没有 blockId → 无效，跳过
        offset = nextOffset
        continue
      }

      activeTool = {
        type: fallbackHeader.type,
        params: fallbackHeader.params,
        contentLines: [],
        start: fallbackStart,
      }
      // 不 consume 当前行，重新处理
      lineIndex--
      continue
    }

    // ── 尝试解析新工具调用头 ──
    const header = parseToolHeader(line)
    if (!header) {
      offset = nextOffset
      continue
    }

    // 检查参数是否完整
    const hasParams = header.type === 'insert'
      ? !!header.params.referenceId
      : !!header.params.blockId

    if (!hasParams) {
      // 参数不完整，标记为 pending，下一行可能包含参数
      pendingHeader = header
      pendingHeaderOffset = offset
      offset = nextOffset
      continue
    }

    if (header.type === 'delete') {
      results.push({
        type: 'delete',
        params: header.params,
        content: '',
        isComplete: true,
        sourceRange: {
          start: offset,
          end: nextOffset,
        },
      })
      offset = nextOffset
      continue
    }

    activeTool = {
      type: header.type,
      params: header.params,
      contentLines: [],
      start: offset,
    }

    offset = nextOffset
  }

  // 处理未关闭的 pending header
  if (pendingHeader && options.includeIncomplete) {
    if (pendingHeader.type !== 'delete') {
      results.push(finalizeToolCall(
        {
          type: pendingHeader.type,
          params: pendingHeader.params,
          contentLines: [],
          start: pendingHeaderOffset,
        },
        normalizedText.length,
        false,
      ))
    }
  }

  // 处理未关闭的活跃工具
  if (activeTool && options.includeIncomplete) {
    results.push(finalizeToolCall(activeTool, normalizedText.length, false))
  }

  return results
}

export function stripSimpleToolSyntax(text: string): string {
  const normalizedText = normalizeToolText(text)
  const toolCalls = parseSimpleToolCalls(normalizedText, { includeIncomplete: true })
    .filter(call => call.sourceRange)
    .sort((left, right) => (left.sourceRange!.start - right.sourceRange!.start))

  if (toolCalls.length === 0) {
    // 即使没有完整工具调用，也清理孤立的 :: 标记
    return normalizedText
      .replace(/^:{2,}\s*(?:insert|update|delete)\b[^\n]*/gm, '')
      .replace(/^:{2,}\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  let cursor = 0
  let result = ''

  toolCalls.forEach((call) => {
    const range = call.sourceRange
    if (!range || range.start < cursor) return
    result += normalizedText.slice(cursor, range.start)
    cursor = range.end
  })

  result += normalizedText.slice(cursor)

  return result
    // 清理孤立的工具调用头（不完整的）
    .replace(/^:{2,}\s*(?:insert|update|delete)\b[^\n]*/gm, '')
    // 清理孤立的 :: 结束标记
    .replace(/^:{2,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
      // 支持批量删除：检查是否有 blockIds 参数
      if (call.params.blockIds) {
        const blockIds = call.params.blockIds.split(',').filter(Boolean)
        for (const blockId of blockIds) {
          operations.push({
            type: 'delete',
            blockId,
          })
        }
      } else if (call.params.blockId) {
        operations.push({
          type: 'delete',
          blockId: call.params.blockId,
        })
      }
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
  return convertMarkdownToBlocks(editor, text)
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
  if (content?.type === 'tableContent' && Array.isArray(content.rows)) {
    return content.rows
      .map((row: any) => (row.cells || []).map((cell: any) => extractBlockPreviewText(cell)).join(' | '))
      .join('\n')
  }
  if (Array.isArray(content)) {
    return content.map((c: any) => {
      if (typeof c === 'string') return c
      if (c?.type === 'formula') return c?.props?.latex ? `$${c.props.latex}$` : ''
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

function generateNextSuggestionId(editor: NonNullable<ReturnType<typeof getEditor>>): SuggestionId {
  let maxSuggestionId = 0

  editor.prosemirrorState.doc.descendants((node) => {
    for (const mark of node.marks || []) {
      const markId = mark.attrs?.id
      if (typeof markId === 'number' && Number.isFinite(markId)) {
        maxSuggestionId = Math.max(maxSuggestionId, markId)
      }
    }
    return true
  })

  return maxSuggestionId + 1
}

function markBlockAsInsertion(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  blockId: string,
  suggestionId?: SuggestionId,
) {
  const schema = editor.prosemirrorState.schema
  const insertionMark = schema.marks['insertion']
  if (!insertionMark) return
  const insertion = insertionMark.create(
    suggestionId === undefined ? undefined : { id: suggestionId },
  )

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
    tr.addNodeMark(blockFrom, insertion)
    if (innerFrom < innerTo) {
      tr.addMark(innerFrom, innerTo, insertion)
      for (const pos of innerBlockPositions) {
        tr.addNodeMark(pos, insertion)
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
  suggestionId?: SuggestionId,
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
    markBlockAsInsertion(editor, insertedId, suggestionId)
    if (opKey) registerOperationBlockId(opKey, insertedId)
    return insertedId
  }

  const BATCH = 8
  for (let i = BATCH; i <= fullText.length; i += BATCH) {
    if (signal.aborted) return insertedId
    const partial = fullText.slice(0, i)
    editor.updateBlock(insertedId!, { ...block, content: buildPartialContent(block, partial) } as any)
    markBlockAsInsertion(editor, insertedId!, suggestionId)
    await delay(6 * jitter())
  }

  editor.updateBlock(insertedId, block as any)
  markBlockAsInsertion(editor, insertedId, suggestionId)
  if (opKey) registerOperationBlockId(opKey, insertedId)
  return insertedId
}

// 按操作 key 存储插入的块ID，用于后续按操作接受/撤销
const operationBlockIds = new Map<string, Set<string>>()
// 按操作 key 存储 suggestion id，用于精确接受/撤销标记
const operationSuggestionIds = new Map<string, Set<SuggestionId>>()
// 按操作 key 存储更新操作的旧块内容，用于撤销恢复
const operationOldBlocks = new Map<string, Array<{ blockId: string; oldBlock: any }>>()

function registerOperationBlockId(opKey: string, blockId: string) {
  if (!operationBlockIds.has(opKey)) {
    operationBlockIds.set(opKey, new Set())
  }
  operationBlockIds.get(opKey)!.add(blockId)
}

function registerOperationSuggestionId(opKey: string, suggestionId: SuggestionId) {
  if (!operationSuggestionIds.has(opKey)) {
    operationSuggestionIds.set(opKey, new Set())
  }
  operationSuggestionIds.get(opKey)!.add(suggestionId)
}

function collectInsertionMarkTargets(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  suggestionIds?: Set<SuggestionId>,
) {
  const insertionMark = editor.prosemirrorState.schema.marks['insertion']
  const inlineRanges: Array<{ from: number; to: number }> = []
  const blockPositions: number[] = []

  if (!insertionMark) {
    return { insertionMark: null, inlineRanges, blockPositions }
  }

  editor.prosemirrorState.doc.descendants((node, pos) => {
    const mark = insertionMark.isInSet(node.marks || [])
    if (!mark) return true
    if (suggestionIds && !suggestionIds.has(mark.attrs?.id)) return true

    if (node.isInline) {
      inlineRanges.push({ from: pos, to: pos + node.nodeSize })
    }

    if (node.isBlock) {
      blockPositions.push(pos)
    }

    return true
  })

  return { insertionMark, inlineRanges, blockPositions }
}

function removeInsertionMarksForOperation(
  editor: NonNullable<ReturnType<typeof getEditor>>,
  suggestionIds?: Set<SuggestionId>,
) {
  const { insertionMark, inlineRanges, blockPositions } = collectInsertionMarkTargets(editor, suggestionIds)
  if (!insertionMark) return

  editor.transact((tr) => {
    tr.setMeta('addToHistory', false)

    for (const range of inlineRanges) {
      tr.removeMark(range.from, range.to, insertionMark)
    }

    const uniqueBlockPositions = [...new Set(blockPositions)].sort((a, b) => b - a)
    for (const pos of uniqueBlockPositions) {
      tr.removeNodeMark(pos, insertionMark)
    }
  })
}

// 移除 insertionMark 标记（接受更改时调用）
// 传入 opKey 时只影响该操作的块，否则影响所有
export function acceptInsertionChanges(opKey?: string): void {
  const editor = getEditor()
  if (!editor) return

  const schema = editor.prosemirrorState.schema
  const insertionMark = schema.marks['insertion']
  if (!insertionMark) return

  if (opKey && operationSuggestionIds.has(opKey)) {
    removeInsertionMarksForOperation(editor, operationSuggestionIds.get(opKey))
    operationSuggestionIds.delete(opKey)
    operationBlockIds.delete(opKey)
    operationOldBlocks.delete(opKey)
  } else {
    // 全局回退：移除所有 insertion 标记
    const blockInfos: Array<{ pos: number; node: any }> = []

    editor.prosemirrorState.doc.descendants((node, pos) => {
      if (node.isBlock && node.marks?.length) {
        const hasMark = node.marks.some((m: any) => m.type === insertionMark)
        if (hasMark) {
          blockInfos.push({ pos, node })
        }
      }
      return true
    })

    editor.transact((tr) => {
      tr.setMeta('addToHistory', false)
      // 移除所有内联标记
      tr.removeMark(0, tr.doc.content.size, insertionMark)
      // 移除节点标记（逆序处理）
      for (let i = blockInfos.length - 1; i >= 0; i--) {
        const info = blockInfos[i]
        const filteredMarks = (info.node.marks || []).filter((m: any) => m.type !== insertionMark)
        tr.setNodeMarkup(info.pos, undefined, undefined, filteredMarks)
      }
    })

    operationBlockIds.clear()
    operationSuggestionIds.clear()
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
    // 先恢复 update 操作的旧块内容
    if (operationOldBlocks.has(opKey)) {
      const oldBlocks = operationOldBlocks.get(opKey)!
      for (const { blockId, oldBlock } of oldBlocks) {
        if (blockExists(editor, blockId)) {
          editor.updateBlock(blockId, oldBlock)
        }
      }
      operationOldBlocks.delete(opKey)
    }

    if (operationSuggestionIds.has(opKey)) {
      removeInsertionMarksForOperation(editor, operationSuggestionIds.get(opKey))
      operationSuggestionIds.delete(opKey)
    }

    // 删除本次操作新插入的块
    if (operationBlockIds.has(opKey)) {
      const blockIds = [...operationBlockIds.get(opKey)!].filter(blockId => blockExists(editor, blockId))
      if (blockIds.length > 0) {
        editor.removeBlocks(blockIds)
      }
      operationBlockIds.delete(opKey)
    }
  } else {
    // 全局回退：恢复所有更新的块
    for (const [, oldBlocks] of operationOldBlocks) {
      for (const { blockId, oldBlock } of oldBlocks) {
        if (blockExists(editor, blockId)) {
          editor.updateBlock(blockId, oldBlock)
        }
      }
    }
    operationOldBlocks.clear()

    // 删除所有插入的块
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
      // 先移除标记
      editor.transact((tr) => {
        tr.setMeta('addToHistory', false)
        tr.removeMark(0, tr.doc.content.size, insertionMark)
      })
      // 再删除块
      editor.removeBlocks(blocksToRemove)
    }
    operationBlockIds.clear()
    operationSuggestionIds.clear()
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
  const suggestionId = generateNextSuggestionId(editor)

  if (opKey) {
    registerOperationSuggestionId(opKey, suggestionId)
  }

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
        const newId = await animateInsertWithMark(editor, block, prevId, op.position, signal, suggestionId, opKey)
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
      markBlockAsInsertion(editor, op.blockId, suggestionId)
      await delay(120 * jitter())
    } else if (op.type === 'delete') {
      if (!blockExists(editor, op.blockId)) {
        onProgress(`块 ${op.blockId.slice(0, 8)} 不存在，跳过删除`)
        continue
      }
      onProgress('删除中…')
      // 使用 BlockNote 推荐的删除方式
      try {
        editor.removeBlocks([op.blockId])
      } catch (error) {
        // 如果直接删除失败，尝试获取块并删除
        const block = editor.getBlock(op.blockId)
        if (block) {
          editor.removeBlocks([op.blockId])
        }
      }
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
  const base: React.CSSProperties = {
    border: 'none',
    borderRadius: 6,
    padding: '4px 14px',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.15s ease',
  }
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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
  // 检查是否为批量删除
  const deleteBlockIds = type === 'delete' && params.blockIds
    ? params.blockIds.split(',').filter(Boolean)
    : type === 'delete' && params.blockId
      ? [params.blockId]
      : []
  const isBatchDelete = type === 'delete' && deleteBlockIds.length > 1

  const typeLabel = {
    insert: '插入内容',
    delete: isBatchDelete ? `批量删除 ${deleteBlockIds.length} 个块` : '删除块',
    update: '更新块',
  }[type]

  const typeIcon = {
    insert: <InsertIcon />,
    delete: <DeleteIcon />,
    update: <UpdateIcon />,
  }[type]

  const accentColor = {
    insert: '#10b981',
    delete: '#ef4444',
    update: '#f59e0b',
  }[type]

  const isSettled = status === 'accepted' || status === 'rejected'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: isSettled ? 0.55 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      style={{
        border: `1px solid ${isSettled ? 'var(--border-color)' : accentColor + '30'}`,
        borderRadius: 10,
        overflow: 'hidden',
        fontSize: 12,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        pointerEvents: isSettled ? 'none' : 'auto',
        margin: '6px 0',
        boxShadow: isSettled ? 'none' : `0 1px 3px ${accentColor}10`,
        transition: 'border-color 0.25s, box-shadow 0.25s',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: `linear-gradient(135deg, var(--bg-secondary), ${accentColor}08)`,
        borderBottom: (status === 'running' || status === 'reviewing') ? `1px solid ${accentColor}18` : 'none',
      }}>
        {typeIcon}
        <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>
          {typeLabel}
          {type === 'insert' && params.position && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
              — {params.position === 'after' ? '之后' : '之前'}
            </span>
          )}
          {type === 'delete' && !isBatchDelete && params.blockId && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 10, fontFamily: 'monospace' }}>
              {params.blockId.slice(0, 8)}…
            </span>
          )}
          {type === 'update' && params.blockId && (
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6, fontSize: 10, fontFamily: 'monospace' }}>
              {params.blockId.slice(0, 8)}…
            </span>
          )}
        </span>
        {status === 'accepted' && (
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{ color: '#10b981', fontSize: 11, fontWeight: 500 }}
          >
            ✓ 已接受
          </motion.span>
        )}
        {status === 'rejected' && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>已撤销</span>}
        {status === 'error' && <span style={{ color: '#ef4444', fontSize: 11 }}>✗ 失败</span>}
        {status === 'idle' && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>等待中…</span>}
      </div>

      {/* 批量删除预览 */}
      {type === 'delete' && isBatchDelete && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--bg-primary)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          maxHeight: 120,
          overflow: 'auto',
        }}>
          <div style={{ marginBottom: 4, color: 'var(--text-muted)', fontSize: 10 }}>
            将删除以下 {deleteBlockIds.length} 个块：
          </div>
          {deleteBlockIds.slice(0, 5).map((id, i) => (
            <div key={i} style={{
              fontFamily: 'monospace',
              fontSize: 10,
              color: '#ef4444',
              marginBottom: 2,
            }}>
              • {id.slice(0, 12)}…
            </div>
          ))}
          {deleteBlockIds.length > 5 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 4 }}>
              …还有 {deleteBlockIds.length - 5} 个块
            </div>
          )}
        </div>
      )}

      {/* 内容预览 */}
      {type === 'insert' && content && (
        <div style={{
          padding: '6px 12px',
          background: 'var(--bg-primary)',
          fontSize: 11,
          color: 'var(--text-secondary)',
          maxHeight: 180,
          overflow: 'auto',
        }} className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 style={{ fontSize: 14, margin: '6px 0 4px', color: 'var(--text-primary)' }}>{children}</h1>,
              h2: ({ children }) => <h2 style={{ fontSize: 13, margin: '6px 0 4px', color: 'var(--text-primary)' }}>{children}</h2>,
              h3: ({ children }) => <h3 style={{ fontSize: 12, margin: '4px 0 2px', color: 'var(--text-primary)' }}>{children}</h3>,
              p: ({ children }) => <p style={{ margin: '4px 0', lineHeight: 1.5 }}>{children}</p>,
              code: ({ className, children, ...props }) => {
                const isInline = !className
                if (isInline) {
                  return <code style={{ background: 'var(--bg-secondary)', padding: '1px 4px', borderRadius: 3, fontSize: 10 }} {...props}>{children}</code>
                }
                return <code style={{ background: 'var(--bg-secondary)', padding: '4px 6px', borderRadius: 4, fontSize: 10, display: 'block' }} {...props}>{children}</code>
              },
              ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ul>,
              ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 16 }}>{children}</ol>,
              li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
              blockquote: ({ children }) => <blockquote style={{ borderLeft: '2px solid var(--accent-color)', paddingLeft: 8, margin: '4px 0', color: 'var(--text-muted)' }}>{children}</blockquote>,
            }}
          >
            {content}
          </ReactMarkdown>
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
                  {newText}
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
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={onAccept}
              style={btnStyle('accent')}
            >
              接受
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={onReject}
              style={btnStyle('ghost')}
            >
              撤销
            </motion.button>
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
    </motion.div>
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
