'use client'

import { useEffect, useRef } from 'react'
import { syncAgentCommentHighlights } from '@/lib/agentToolRuntime'

export function DocumentIssueHighlighter() {
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const sync = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        syncAgentCommentHighlights()
      })
    }

    sync()

    window.addEventListener('editor-comments-updated', sync)
    window.addEventListener('editor-instance-updated', sync)
    window.addEventListener('editor-content-updated', sync)

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
      window.removeEventListener('editor-comments-updated', sync)
      window.removeEventListener('editor-instance-updated', sync)
      window.removeEventListener('editor-content-updated', sync)
    }
  }, [])

  return (
    <style jsx global>{`
      .bn-editor [data-review-issue="true"] {
        border-radius: 10px;
        transition: background-color 0.18s ease, box-shadow 0.18s ease;
      }

      .bn-editor [data-review-issue="true"][data-review-severity="critical"] {
        background: rgba(239, 68, 68, 0.12);
        box-shadow: inset 3px 0 0 rgba(220, 38, 38, 0.9);
      }

      .bn-editor [data-review-issue="true"][data-review-severity="warning"] {
        background: rgba(248, 113, 113, 0.08);
        box-shadow: inset 3px 0 0 rgba(239, 68, 68, 0.72);
      }

      .bn-editor [data-review-issue="true"][data-review-severity="info"] {
        background: rgba(248, 113, 113, 0.05);
        box-shadow: inset 3px 0 0 rgba(248, 113, 113, 0.56);
      }
    `}</style>
  )
}
