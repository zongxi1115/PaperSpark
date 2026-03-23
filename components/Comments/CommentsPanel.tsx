'use client'
import { useState, useEffect, useCallback } from 'react'
import { Button, Textarea, Tooltip, addToast } from '@heroui/react'
import { getDocumentComments, addComment, updateComment, deleteComment, generateId } from '@/lib/storage'
import type { EditorComment } from '@/lib/types'

interface CommentsPanelProps {
  documentId: string
  selectedText?: string
  blockId?: string
  startOffset?: number
  endOffset?: number
  onCommentAdded?: (comment: EditorComment) => void
}

export function CommentsPanel({
  documentId,
  selectedText,
  blockId,
  startOffset,
  endOffset,
  onCommentAdded,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<EditorComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  // 加载评论
  const loadComments = useCallback(() => {
    const docComments = getDocumentComments(documentId)
    setComments(docComments)
  }, [documentId])

  useEffect(() => {
    loadComments()
  }, [loadComments])

  // 监听存储变化
  useEffect(() => {
    const handleStorageChange = () => {
      loadComments()
    }
    window.addEventListener('editor-comments-updated', handleStorageChange)
    return () => {
      window.removeEventListener('editor-comments-updated', handleStorageChange)
    }
  }, [loadComments])

  // 添加评论
  const handleAddComment = useCallback(() => {
    if (!newComment.trim()) {
      addToast({ title: '请输入评论内容', color: 'warning' })
      return
    }

    const comment: EditorComment = {
      id: generateId(),
      documentId,
      selectedText: selectedText || '',
      blockId,
      startOffset,
      endOffset,
      content: newComment.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    addComment(comment)
    setNewComment('')
    loadComments()
    onCommentAdded?.(comment)
    addToast({ title: '评论已添加', color: 'success' })
  }, [newComment, documentId, selectedText, blockId, startOffset, endOffset, loadComments, onCommentAdded])

  // 编辑评论
  const handleEditComment = useCallback((id: string) => {
    const comment = comments.find(c => c.id === id)
    if (comment) {
      setEditingId(id)
      setEditContent(comment.content)
    }
  }, [comments])

  // 保存编辑
  const handleSaveEdit = useCallback((id: string) => {
    if (!editContent.trim()) {
      addToast({ title: '评论内容不能为空', color: 'warning' })
      return
    }

    updateComment(id, { content: editContent.trim() })
    setEditingId(null)
    setEditContent('')
    loadComments()
    addToast({ title: '评论已更新', color: 'success' })
  }, [editContent, loadComments])

  // 删除评论
  const handleDeleteComment = useCallback((id: string) => {
    deleteComment(id)
    loadComments()
    addToast({ title: '评论已删除', color: 'success' })
  }, [loadComments])

  // 跳转到评论对应的文本
  const handleJumpToComment = useCallback((comment: EditorComment) => {
    if (comment.blockId) {
      const blockElement = document.querySelector(`[data-id="${comment.blockId}"]`)
      if (blockElement) {
        blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 高亮效果
        const originalBackground = (blockElement as HTMLElement).style.backgroundColor
        ;(blockElement as HTMLElement).style.backgroundColor = 'rgba(59, 130, 246, 0.2)'
        setTimeout(() => {
          ;(blockElement as HTMLElement).style.backgroundColor = originalBackground
        }, 2000)
      }
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 添加评论区域 */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        {selectedText && (
          <div style={{
            padding: '8px 12px',
            marginBottom: '8px',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderLeft: '3px solid var(--accent-color)',
            borderRadius: '4px',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            maxHeight: '80px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            <div style={{ fontWeight: 500, marginBottom: '4px', color: 'var(--text-primary)' }}>
              选中文本:
            </div>
            {selectedText.length > 100 ? selectedText.slice(0, 100) + '...' : selectedText}
          </div>
        )}
        <Textarea
          placeholder={selectedText ? '添加对选中文本的评论...' : '添加评论...'}
          value={newComment}
          onValueChange={setNewComment}
          minRows={2}
          maxRows={4}
          size="sm"
          variant="bordered"
        />
        <Button
          size="sm"
          color="primary"
          variant="solid"
          onPress={handleAddComment}
          style={{ marginTop: '8px' }}
          isDisabled={!newComment.trim()}
        >
          添加评论
        </Button>
      </div>

      {/* 评论列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {comments.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '20px',
          }}>
            <CommentIcon />
            <p style={{ fontSize: '14px', fontWeight: 500, marginTop: '12px', marginBottom: '8px' }}>
              暂无评论
            </p>
            <p style={{ fontSize: '12px' }}>
              选中文本后添加评论
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {comments.map((comment) => (
              <div
                key={comment.id}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-secondary)',
                }}
              >
                {/* 选中文本引用 */}
                {comment.selectedText && (
                  <div
                    onClick={() => handleJumpToComment(comment)}
                    style={{
                      padding: '6px 10px',
                      marginBottom: '8px',
                      backgroundColor: 'rgba(59, 130, 246, 0.08)',
                      borderLeft: '3px solid var(--accent-color)',
                      borderRadius: '4px',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      maxHeight: '60px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      transition: 'background-color 0.2s',
                    }}
                    title="点击跳转到原文"
                  >
                    {comment.selectedText.length > 80
                      ? comment.selectedText.slice(0, 80) + '...'
                      : comment.selectedText}
                  </div>
                )}

                {/* 评论内容 */}
                {editingId === comment.id ? (
                  <div>
                    <Textarea
                      value={editContent}
                      onValueChange={setEditContent}
                      minRows={2}
                      maxRows={4}
                      size="sm"
                      variant="bordered"
                    />
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <Button
                        size="sm"
                        color="primary"
                        variant="solid"
                        onPress={() => handleSaveEdit(comment.id)}
                      >
                        保存
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        onPress={() => {
                          setEditingId(null)
                          setEditContent('')
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    fontSize: '13px',
                    lineHeight: 1.6,
                    color: 'var(--text-primary)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {comment.content}
                  </div>
                )}

                {/* 操作按钮 */}
                {editingId !== comment.id && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--border-color)',
                  }}>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {new Date(comment.createdAt).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <Tooltip content="编辑" placement="top">
                        <button
                          onClick={() => handleEditComment(comment.id)}
                          style={{
                            padding: '4px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <EditIcon />
                        </button>
                      </Tooltip>
                      <Tooltip content="删除" placement="top">
                        <button
                          onClick={() => handleDeleteComment(comment.id)}
                          style={{
                            padding: '4px',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            borderRadius: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <DeleteIcon />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CommentIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}
