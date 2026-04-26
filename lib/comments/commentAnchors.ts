'use client'

import { COMMENT_THREAD_STYLE_TYPE } from '@/components/Editor/CommentThreadStyle'
import type { EditorComment } from '@/lib/types'

export type CommentInlineNode = {
  type?: string
  text?: string
  styles?: Record<string, unknown>
  href?: string
  content?: CommentInlineNode[]
}

export type CommentAnchorRange = {
  start: number
  end: number
}

function isTextNode(node: CommentInlineNode): node is CommentInlineNode & { type: 'text'; text: string } {
  return node.type === 'text' && typeof node.text === 'string'
}

function isLinkNode(node: CommentInlineNode): node is CommentInlineNode & { type: 'link'; content: CommentInlineNode[] } {
  return node.type === 'link' && Array.isArray(node.content)
}

export function getCommentRelevantTextLength(content: unknown): number {
  if (Array.isArray(content)) {
    return content.reduce((sum, item) => sum + getCommentRelevantTextLength(item), 0)
  }

  if (!content || typeof content !== 'object') return 0
  const node = content as CommentInlineNode
  if (isTextNode(node)) return node.text.length
  if (isLinkNode(node)) return getCommentRelevantTextLength(node.content)
  return 0
}

export function getCommentRelevantText(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map(item => getCommentRelevantText(item)).join('')
  }

  if (!content || typeof content !== 'object') return ''
  const node = content as CommentInlineNode
  if (isTextNode(node)) return node.text
  if (isLinkNode(node)) return getCommentRelevantText(node.content)
  return ''
}

function findUniqueTextMatch(blockText: string, selectedText: string): CommentAnchorRange | null {
  if (!blockText || !selectedText) return null

  const firstIndex = blockText.indexOf(selectedText)
  if (firstIndex < 0) return null

  const duplicateIndex = blockText.indexOf(selectedText, firstIndex + 1)
  if (duplicateIndex >= 0) return null

  return {
    start: firstIndex,
    end: firstIndex + selectedText.length,
  }
}

export function resolveCommentRange(
  comment: Pick<EditorComment, 'selectedText' | 'startOffset' | 'endOffset'>,
  content: CommentInlineNode[],
): CommentAnchorRange | null {
  const blockLength = getCommentRelevantTextLength(content)
  const start = typeof comment.startOffset === 'number' ? comment.startOffset : -1
  const end = typeof comment.endOffset === 'number' ? comment.endOffset : -1

  if (start >= 0 && end > start && end <= blockLength) {
    return { start, end }
  }

  const selectedText = comment.selectedText?.trim()
  if (!selectedText) return null

  return findUniqueTextMatch(getCommentRelevantText(content), selectedText)
}

export function resolveCommentRangeInBlock(
  block: { content?: unknown } | null | undefined,
  comment: Pick<EditorComment, 'selectedText' | 'startOffset' | 'endOffset'>,
): CommentAnchorRange | null {
  const content = block?.content
  if (!Array.isArray(content)) return null
  return resolveCommentRange(comment, content as CommentInlineNode[])
}

export function hasCommentStyle(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.some(item => hasCommentStyle(item))
  }

  if (!content || typeof content !== 'object') return false
  const node = content as CommentInlineNode

  if (isTextNode(node) && node.styles && COMMENT_THREAD_STYLE_TYPE in node.styles) {
    return true
  }

  if (isLinkNode(node)) {
    return hasCommentStyle(node.content)
  }

  return false
}
