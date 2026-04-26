'use client'
import { createReactStyleSpec } from '@blocknote/react'

export const COMMENT_THREAD_STYLE_TYPE = 'commentThread'

export function encodeCommentThreadStyleValue(threadId: string, resolved = false): string {
  return `${resolved ? 'r' : 'u'}:${threadId}`
}

export function parseCommentThreadStyleValue(value?: string | null): { threadId: string; resolved: boolean } {
  const raw = (value || '').trim()
  if (!raw) return { threadId: '', resolved: false }

  const separatorIndex = raw.indexOf(':')
  if (separatorIndex < 0) {
    return { threadId: raw, resolved: false }
  }

  const prefix = raw.slice(0, separatorIndex)
  const threadId = raw.slice(separatorIndex + 1)
  return {
    threadId,
    resolved: prefix === 'r',
  }
}

export const CommentThreadStyleSpec = createReactStyleSpec(
  {
    type: COMMENT_THREAD_STYLE_TYPE,
    propSchema: 'string',
  } as const,
  {
    render: ({ value, contentRef }) => {
      const { threadId, resolved } = parseCommentThreadStyleValue(value)

      return (
        <span
          ref={contentRef}
          data-comment-thread-id={threadId}
          data-comment-resolved={resolved ? 'true' : 'false'}
          title={resolved ? '已解决评论' : '评论关联文本'}
          style={{
            borderRadius: '6px',
            backgroundColor: resolved ? 'transparent' : 'color-mix(in srgb, var(--accent-color) 14%, transparent)',
            boxShadow: resolved ? 'none' : 'inset 0 -0.55em 0 color-mix(in srgb, var(--accent-color) 8%, transparent)',
            cursor: 'pointer',
            transition: 'background-color 0.18s ease, box-shadow 0.18s ease',
          }}
        />
      )
    },
  }
)
