'use client'

import { getEditor } from './editorContext'
import { COMMENT_THREAD_STYLE_TYPE, encodeCommentThreadStyleValue, parseCommentThreadStyleValue } from '@/components/Editor/CommentThreadStyle'

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
