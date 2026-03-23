'use client'

import { getEditor } from './editorContext'
import { getDocumentComments, getLastDocId } from './storage'
import type { EditorComment } from './types'
import { COMMENT_THREAD_STYLE_TYPE, encodeCommentThreadStyleValue } from '@/components/Editor/CommentThreadStyle'

type InlineNode = {
  type?: string
  text?: string
  styles?: Record<string, unknown>
  href?: string
  content?: InlineNode[]
}

type CommentRange = {
  start: number
  end: number
  value: string
}

function isTextNode(node: InlineNode): node is InlineNode & { type: 'text'; text: string } {
  return node.type === 'text' && typeof node.text === 'string'
}

function isLinkNode(node: InlineNode): node is InlineNode & { type: 'link'; content: InlineNode[] } {
  return node.type === 'link' && Array.isArray(node.content)
}

function getCommentRelevantTextLength(content: unknown): number {
  if (Array.isArray(content)) {
    return content.reduce((sum, item) => sum + getCommentRelevantTextLength(item), 0)
  }

  if (!content || typeof content !== 'object') return 0
  const node = content as InlineNode
  if (isTextNode(node)) return node.text.length
  if (isLinkNode(node)) return getCommentRelevantTextLength(node.content)
  return 0
}

function getCommentRelevantText(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map(item => getCommentRelevantText(item)).join('')
  }

  if (!content || typeof content !== 'object') return ''
  const node = content as InlineNode

  if (isTextNode(node)) return node.text
  if (isLinkNode(node)) return getCommentRelevantText(node.content)
  return ''
}

function normalizeRange(comment: EditorComment, content: InlineNode[]): { start: number; end: number } | null {
  const blockLength = getCommentRelevantTextLength(content)
  let start = typeof comment.startOffset === 'number' ? comment.startOffset : -1
  let end = typeof comment.endOffset === 'number' ? comment.endOffset : -1

  if (start >= 0 && end > start && end <= blockLength) {
    return { start, end }
  }

  const blockText = getCommentRelevantText(content)
  const selectedText = comment.selectedText?.trim()
  if (!selectedText || !blockText) return null

  const index = blockText.indexOf(selectedText)
  if (index < 0) return null

  return {
    start: index,
    end: index + selectedText.length,
  }
}

function buildCommentRanges(comments: EditorComment[], content: InlineNode[]): CommentRange[] {
  return comments
    .map((comment) => {
      const normalized = normalizeRange(comment, content)
      if (!normalized) return null

      return {
        start: normalized.start,
        end: normalized.end,
        value: encodeCommentThreadStyleValue(comment.id, Boolean(comment.resolvedAt)),
      }
    })
    .filter((range): range is CommentRange => Boolean(range))
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start
      return a.end - b.end
    })
}

function findRangeValue(ranges: CommentRange[], start: number, end: number): string | undefined {
  let matched: string | undefined
  for (const range of ranges) {
    if (range.start <= start && range.end >= end) {
      matched = range.value
    }
  }
  return matched
}

function stripCommentStyle(styles?: Record<string, unknown>): Record<string, unknown> {
  if (!styles || !(COMMENT_THREAD_STYLE_TYPE in styles)) return styles || {}
  const next = { ...styles }
  delete next[COMMENT_THREAD_STYLE_TYPE]
  return next
}

function hasCommentStyle(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.some(item => hasCommentStyle(item))
  }

  if (!content || typeof content !== 'object') return false
  const node = content as InlineNode

  if (isTextNode(node) && node.styles && COMMENT_THREAD_STYLE_TYPE in node.styles) {
    return true
  }

  if (isLinkNode(node)) {
    return hasCommentStyle(node.content)
  }

  return false
}

function collectStyledBlockIds(block: any, target: Set<string>) {
  if (hasCommentStyle(block?.content)) {
    target.add(block.id)
  }

  if (Array.isArray(block?.children)) {
    block.children.forEach((child: any) => collectStyledBlockIds(child, target))
  }
}

function applyCommentStylesToContent(
  content: InlineNode[],
  ranges: CommentRange[],
  position = 0,
): { content: InlineNode[]; position: number } {
  const next: InlineNode[] = []
  let cursor = position

  for (const node of content) {
    if (isTextNode(node)) {
      const nodeStart = cursor
      const nodeEnd = cursor + node.text.length
      const cutPoints = new Set<number>([0, node.text.length])

      ranges.forEach((range) => {
        if (range.end <= nodeStart || range.start >= nodeEnd) return
        cutPoints.add(Math.max(0, range.start - nodeStart))
        cutPoints.add(Math.min(node.text.length, range.end - nodeStart))
      })

      const sortedPoints = Array.from(cutPoints).sort((a, b) => a - b)
      for (let index = 0; index < sortedPoints.length - 1; index += 1) {
        const localStart = sortedPoints[index]
        const localEnd = sortedPoints[index + 1]
        if (localEnd <= localStart) continue

        const segmentText = node.text.slice(localStart, localEnd)
        const segmentStart = nodeStart + localStart
        const segmentEnd = nodeStart + localEnd
        const rangeValue = findRangeValue(ranges, segmentStart, segmentEnd)
        const baseStyles = stripCommentStyle(node.styles)
        const nextStyles = rangeValue
          ? { ...baseStyles, [COMMENT_THREAD_STYLE_TYPE]: rangeValue }
          : baseStyles

        next.push({
          ...node,
          text: segmentText,
          styles: nextStyles,
        })
      }

      cursor = nodeEnd
      continue
    }

    if (isLinkNode(node)) {
      const nested = applyCommentStylesToContent(node.content, ranges, cursor)
      next.push({
        ...node,
        content: nested.content,
      })
      cursor = nested.position
      continue
    }

    next.push(node)
  }

  return { content: next, position: cursor }
}

export function syncCommentStyles(documentId?: string | null) {
  const activeDocumentId = documentId || getLastDocId()
  if (!activeDocumentId) return

  const editor = getEditor()
  if (!editor) return

  const groupedComments = new Map<string, EditorComment[]>()
  getDocumentComments(activeDocumentId)
    .filter(comment => !comment.parentId && comment.blockId)
    .forEach((comment) => {
      const blockId = comment.blockId as string
      const existing = groupedComments.get(blockId) || []
      existing.push(comment)
      groupedComments.set(blockId, existing)
    })

  const blockIds = new Set<string>(groupedComments.keys())
  editor.document.forEach((block) => collectStyledBlockIds(block as any, blockIds))

  blockIds.forEach((blockId) => {
    const comments = groupedComments.get(blockId) || []
    const block = editor.getBlock(blockId)
    if (!block) return

    const rawContent = (block as any).content
    if (!Array.isArray(rawContent)) return

    const ranges = buildCommentRanges(
      comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      rawContent as InlineNode[],
    )

    const nextContent = applyCommentStylesToContent(rawContent as InlineNode[], ranges).content
    if (JSON.stringify(nextContent) === JSON.stringify(rawContent)) return

    editor.updateBlock(block, {
      content: nextContent as any,
    })
  })
}
