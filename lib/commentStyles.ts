'use client'

import { getEditor } from './editorContext'
import { COMMENT_THREAD_STYLE_TYPE, encodeCommentThreadStyleValue, parseCommentThreadStyleValue } from '@/components/Editor/CommentThreadStyle'
import { getCommentRelevantTextLength, resolveCommentRangeInBlock } from '@/lib/comments/commentAnchors'
import type { EditorComment } from '@/lib/types'

type InlineNode = {
  type?: string
  text?: string
  styles?: Record<string, unknown>
  content?: InlineNode[]
}

function updateCommentThreadStyle(
  styles: Record<string, unknown> | undefined,
  threadId: string,
  nextValue: string | null,
): { styles?: Record<string, unknown>; changed: boolean } {
  if (!styles) return { styles, changed: false }

  const rawValue = styles[COMMENT_THREAD_STYLE_TYPE]
  if (typeof rawValue !== 'string') {
    return { styles, changed: false }
  }

  if (parseCommentThreadStyleValue(rawValue).threadId !== threadId) {
    return { styles, changed: false }
  }

  const nextStyles = { ...styles }
  if (nextValue) {
    nextStyles[COMMENT_THREAD_STYLE_TYPE] = nextValue
  } else {
    delete nextStyles[COMMENT_THREAD_STYLE_TYPE]
  }

  return { styles: nextStyles, changed: true }
}

function rewriteCommentThreadInContent(
  content: InlineNode[],
  threadId: string,
  nextValue: string | null,
): { content: InlineNode[]; changed: boolean } {
  let changed = false

  const nextContent = content.map((node) => {
    if (node.type === 'text') {
      const updated = updateCommentThreadStyle(node.styles, threadId, nextValue)
      if (!updated.changed) return node
      changed = true
      return {
        ...node,
        styles: updated.styles,
      }
    }

    if (node.type === 'link' && Array.isArray(node.content)) {
      const nested = rewriteCommentThreadInContent(node.content, threadId, nextValue)
      if (!nested.changed) return node
      changed = true
      return {
        ...node,
        content: nested.content,
      }
    }

    return node
  })

  return { content: nextContent, changed }
}

function applyCommentThreadInContent(
  content: InlineNode[],
  threadId: string,
  start: number,
  end: number,
  value: string,
  position = 0,
): { content: InlineNode[]; position: number; changed: boolean } {
  let cursor = position
  let changed = false
  const nextContent: InlineNode[] = []

  for (const node of content) {
    if (node.type === 'text' && typeof node.text === 'string') {
      const nodeStart = cursor
      const nodeEnd = cursor + node.text.length
      const overlaps = start < nodeEnd && end > nodeStart

      if (!overlaps) {
        nextContent.push(node)
        cursor = nodeEnd
        continue
      }

      const cutPoints = new Set<number>([
        0,
        node.text.length,
        Math.max(0, start - nodeStart),
        Math.min(node.text.length, end - nodeStart),
      ])

      const sortedPoints = Array.from(cutPoints).sort((a, b) => a - b)
      for (let index = 0; index < sortedPoints.length - 1; index += 1) {
        const localStart = sortedPoints[index]
        const localEnd = sortedPoints[index + 1]
        if (localEnd <= localStart) continue

        const segmentStart = nodeStart + localStart
        const segmentEnd = nodeStart + localEnd
        const baseStyles = { ...(node.styles || {}) }
        const existingThreadValue = typeof baseStyles[COMMENT_THREAD_STYLE_TYPE] === 'string'
          ? String(baseStyles[COMMENT_THREAD_STYLE_TYPE])
          : undefined
        const existingThreadId = existingThreadValue
          ? parseCommentThreadStyleValue(existingThreadValue).threadId
          : ''

        const insideRange = segmentStart >= start && segmentEnd <= end
        if (insideRange && (!existingThreadValue || existingThreadId === threadId)) {
          if (existingThreadValue !== value) {
            baseStyles[COMMENT_THREAD_STYLE_TYPE] = value
            changed = true
          }
        }

        nextContent.push({
          ...node,
          text: node.text.slice(localStart, localEnd),
          styles: baseStyles,
        })
      }

      cursor = nodeEnd
      continue
    }

    if (node.type === 'link' && Array.isArray(node.content)) {
      const nested = applyCommentThreadInContent(node.content, threadId, start, end, value, cursor)
      if (nested.changed) {
        changed = true
        nextContent.push({
          ...node,
          content: nested.content,
        })
      } else {
        nextContent.push(node)
      }
      cursor = nested.position
      continue
    }

    nextContent.push(node)
  }

  return { content: nextContent, position: cursor, changed }
}

function mutateCommentThreadMarks(threadId: string, nextValue: string | null) {
  const editor = getEditor()
  if (!editor) return

  const updates: Array<{ blockId: string; content: InlineNode[] }> = []

  editor.forEachBlock((block) => {
    const rawContent = (block as { content?: unknown }).content
    if (!Array.isArray(rawContent)) return true

    const updated = rewriteCommentThreadInContent(rawContent as InlineNode[], threadId, nextValue)
    if (updated.changed) {
      updates.push({
        blockId: block.id,
        content: updated.content,
      })
    }

    return true
  })

  if (updates.length === 0) return

  editor.transact(() => {
    updates.forEach(({ blockId, content }) => {
      editor.updateBlock(blockId, {
        content: content as any,
      })
    })
  })
}

export function setCommentThreadResolved(threadId: string, resolved: boolean) {
  mutateCommentThreadMarks(threadId, encodeCommentThreadStyleValue(threadId, resolved))
}

export function removeCommentThreadMarks(threadId: string) {
  mutateCommentThreadMarks(threadId, null)
}

export function applyCommentThreadMark(comment: Pick<EditorComment, 'id' | 'blockId' | 'selectedText' | 'startOffset' | 'endOffset' | 'resolvedAt'>): boolean {
  if (!comment.blockId) return false

  const editor = getEditor()
  if (!editor) return false

  const block = editor.getBlock(comment.blockId)
  if (!block) return false

  const rawContent = (block as { content?: unknown }).content
  if (!Array.isArray(rawContent)) return false

  const range = resolveCommentRangeInBlock(block as { content?: unknown }, comment)
    || (() => {
      const blockLength = getCommentRelevantTextLength(rawContent)
      return blockLength > 0
        ? { start: 0, end: blockLength }
        : null
    })()
  if (!range) return false

  const nextValue = encodeCommentThreadStyleValue(comment.id, Boolean(comment.resolvedAt))
  const updated = applyCommentThreadInContent(rawContent as InlineNode[], comment.id, range.start, range.end, nextValue)
  if (!updated.changed) return false

  editor.updateBlock(comment.blockId, {
    content: updated.content as any,
  })
  return true
}
