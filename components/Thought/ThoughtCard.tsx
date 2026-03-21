'use client'
import { Button, Tooltip } from '@heroui/react'
import type { Thought } from '@/lib/types'
import { formatDate } from '@/lib/storage'

interface ThoughtCardProps {
  thought: Thought
  onClick: () => void
  onDelete: () => void
}

export function ThoughtCard({ thought, onClick, onDelete }: ThoughtCardProps) {
  const handleDelete = () => {
    onDelete()
  }

  // 提取内容预览
  const getContentPreview = () => {
    if (thought.summary) {
      return thought.summary
    }
    const content = thought.content as { content?: { type: string; text: string }[] }[]
    if (content && content.length > 0) {
      const texts = content
        .map(block => {
          const b = block as { content?: { type: string; text: string }[] }
          return b.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? ''
        })
        .filter(t => t.trim())
        .join(' ')
      return texts.slice(0, 120) + (texts.length > 120 ? '...' : '')
    }
    return '点击编辑...'
  }

  return (
    <div
      onClick={onClick}
      className="thought-card"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 12,
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 16 }}>
        {/* 标题 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'flex-start', 
          justifyContent: 'space-between',
          marginBottom: 8 
        }}>
          <h3 style={{ 
            fontSize: 16, 
            fontWeight: 600, 
            margin: 0, 
            color: 'var(--text-primary)',
            flex: 1,
            marginRight: 8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {thought.title || '无标题'}
          </h3>
          <Tooltip content="删除" placement="top">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              onPress={handleDelete}
              onClick={e => e.stopPropagation()}
              style={{ minWidth: 28, height: 28 }}
            >
              <DeleteIcon />
            </Button>
          </Tooltip>
        </div>

        {/* 概述/预览 */}
        <p style={{ 
          fontSize: 13, 
          color: 'var(--text-secondary)', 
          margin: 0,
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          minHeight: 54,
        }}>
          {getContentPreview()}
        </p>

        {/* 底部信息 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--border-color)',
        }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {formatDate(thought.updatedAt)}
          </span>
          {thought.aiProcessedAt && (
            <span style={{ 
              fontSize: 10, 
              color: 'var(--accent-color)',
              background: 'var(--accent-bg)',
              padding: '2px 6px',
              borderRadius: 4,
            }}>
              AI 已处理
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}
