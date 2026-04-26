'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { readDocument, type DocumentReadResult } from '@/lib/agentDocument'

interface ReadDocumentToolProps {
  onResult: (result: DocumentReadResult) => void
}

export function ReadDocumentTool({ onResult }: ReadDocumentToolProps) {
  const [status, setStatus] = useState<'idle' | 'reading' | 'done' | 'error'>('idle')
  const [preview, setPreview] = useState<string | null>(null)

  const handleRead = () => {
    setStatus('reading')
    setTimeout(() => {
      const result = readDocument()
      if (!result) {
        setStatus('error')
        return
      }
      setPreview(result.markdown.slice(0, 300) + (result.markdown.length > 300 ? '…' : ''))
      setStatus('done')
      onResult(result)
    }, 120)
  }

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      overflow: 'hidden',
      fontSize: 12,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--bg-secondary)',
        borderBottom: status !== 'idle' ? '1px solid var(--border-color)' : 'none',
      }}>
        <DocIcon />
        <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>读取文档</span>
        {status === 'idle' && (
          <button
            onClick={handleRead}
            style={{
              background: 'var(--accent-color)',
              color: '#fff',
              border: 'none',
              borderRadius: 5,
              padding: '3px 10px',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            读取
          </button>
        )}
        {status === 'reading' && (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>读取中…</span>
        )}
        {status === 'done' && (
          <span style={{ color: '#10b981', fontSize: 11 }}>✓ 已读取</span>
        )}
        {status === 'error' && (
          <span style={{ color: '#ef4444', fontSize: 11 }}>未找到编辑器</span>
        )}
      </div>

      <AnimatePresence>
        {status === 'done' && preview && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: 11,
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 120,
              overflowY: 'auto',
              background: 'var(--bg-primary)',
            }}
          >
            {preview}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DocIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--accent-color)', flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  )
}
