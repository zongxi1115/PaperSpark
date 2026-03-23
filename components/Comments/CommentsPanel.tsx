'use client'
import { useState, useEffect, useCallback } from 'react'
import { Button, Textarea, Tooltip, addToast } from '@heroui/react'
import { readDocument } from '@/lib/agentDocument'
import {
  getDocumentComments,
  addComment,
  updateComment,
  deleteComment,
  generateId,
  getSettings,
  getSelectedLargeModel,
} from '@/lib/storage'
import type { EditorComment } from '@/lib/types'

interface CommentsPanelProps {
  documentId: string
  selectedText?: string
  blockId?: string
  startOffset?: number
  endOffset?: number
  onCommentAdded?: (comment: EditorComment) => void
}

function isResolvedComment(comment: EditorComment): boolean {
  return Boolean(comment.resolvedAt)
}

function getCommentAccent(comment: EditorComment): { border: string; background: string; badgeBg: string; badgeText: string } {
  if (isResolvedComment(comment)) {
    return {
      border: 'rgba(34, 197, 94, 0.24)',
      background: 'rgba(34, 197, 94, 0.06)',
      badgeBg: 'rgba(34, 197, 94, 0.14)',
      badgeText: '#15803d',
    }
  }

  if (comment.tone === 'red' || comment.severity === 'critical' || comment.severity === 'warning') {
    return {
      border: 'rgba(239, 68, 68, 0.28)',
      background: 'rgba(239, 68, 68, 0.06)',
      badgeBg: 'rgba(239, 68, 68, 0.12)',
      badgeText: '#dc2626',
    }
  }

  return {
    border: 'var(--border-color)',
    background: 'var(--bg-secondary)',
    badgeBg: 'rgba(59, 130, 246, 0.1)',
    badgeText: 'var(--accent-color)',
  }
}

function getCommentLabel(comment: EditorComment): string {
  if (comment.parentId && comment.source === 'agent') {
    return 'AI 回复'
  }
  if (comment.source === 'agent') {
    return comment.agentTitle || '智能体批注'
  }
  return '手动评论'
}

function formatCommentTime(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  const [aiReplyingId, setAiReplyingId] = useState<string | null>(null)

  const loadComments = useCallback(() => {
    const docComments = getDocumentComments(documentId)
    setComments(docComments)
  }, [documentId])

  useEffect(() => {
    loadComments()
  }, [loadComments])

  useEffect(() => {
    const handleStorageChange = () => {
      loadComments()
    }
    window.addEventListener('editor-comments-updated', handleStorageChange)
    return () => {
      window.removeEventListener('editor-comments-updated', handleStorageChange)
    }
  }, [loadComments])

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
      source: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    addComment(comment)
    setNewComment('')
    loadComments()
    onCommentAdded?.(comment)
    addToast({ title: '评论已添加', color: 'success' })
  }, [newComment, documentId, selectedText, blockId, startOffset, endOffset, loadComments, onCommentAdded])

  const handleEditComment = useCallback((id: string) => {
    const comment = comments.find(c => c.id === id)
    if (comment) {
      setEditingId(id)
      setEditContent(comment.content)
    }
  }, [comments])

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

  const handleDeleteComment = useCallback((id: string) => {
    deleteComment(id)
    loadComments()
    addToast({ title: '评论已删除', color: 'success' })
  }, [loadComments])

  const handleToggleResolved = useCallback((comment: EditorComment) => {
    const resolved = isResolvedComment(comment)
    updateComment(comment.id, resolved ? {
      resolvedAt: undefined,
      resolvedBy: undefined,
    } : {
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'user',
    })
    loadComments()
    addToast({ title: resolved ? '已恢复为未解决' : '已标记为已解决', color: 'success' })
  }, [loadComments])

  const handleAIReply = useCallback(async (comment: EditorComment) => {
    if (comment.parentId) return
    if (isResolvedComment(comment)) {
      addToast({ title: '已解决的评论无需继续回复', color: 'default' })
      return
    }

    const settings = getSettings()
    const modelConfig = getSelectedLargeModel(settings)
    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      addToast({ title: '请先在设置页配置可用的大模型', color: 'warning' })
      return
    }

    setAiReplyingId(comment.id)
    try {
      const threadReplies = comments
        .filter(item => item.parentId === comment.id)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

      const documentSnapshot = readDocument()
      const response = await fetch('/api/ai/comment-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelConfig,
          comment: {
            content: comment.content,
            selectedText: comment.selectedText,
            source: comment.source,
          },
          replies: threadReplies.map(item => ({
            content: item.content,
            source: item.source,
            createdAt: item.createdAt,
          })),
          documentContent: documentSnapshot?.markdown || '',
        }),
      })

      const payload = await response.json().catch(() => null) as { success?: boolean; reply?: string; error?: string } | null
      if (!response.ok || !payload?.success || !payload.reply?.trim()) {
        throw new Error(payload?.error || 'AI 回复生成失败')
      }

      addComment({
        id: generateId(),
        documentId,
        parentId: comment.id,
        selectedText: comment.selectedText || '',
        blockId: comment.blockId,
        startOffset: comment.startOffset,
        endOffset: comment.endOffset,
        content: payload.reply.trim(),
        source: 'agent',
        agentTitle: 'AI 回复',
        tone: 'blue',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      loadComments()
      addToast({ title: 'AI 回复已生成', color: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI 回复生成失败'
      addToast({ title: message, color: 'danger' })
    } finally {
      setAiReplyingId(null)
    }
  }, [comments, documentId, loadComments])

  const handleJumpToComment = useCallback((comment: EditorComment) => {
    const threadElement = document.querySelector<HTMLElement>(`[data-comment-thread-id="${comment.parentId || comment.id}"]`)
    if (threadElement) {
      threadElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
      const originalBackground = threadElement.style.backgroundColor
      const originalBoxShadow = threadElement.style.boxShadow
      threadElement.style.backgroundColor = 'rgba(59, 130, 246, 0.18)'
      threadElement.style.boxShadow = 'inset 0 -0.6em 0 rgba(59, 130, 246, 0.12)'
      setTimeout(() => {
        threadElement.style.backgroundColor = originalBackground
        threadElement.style.boxShadow = originalBoxShadow
      }, 1800)
      return
    }

    if (comment.blockId) {
      const blockElement = document.querySelector(`[data-id="${comment.blockId}"]`)
      if (blockElement) {
        blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        const originalBackground = (blockElement as HTMLElement).style.backgroundColor
        ;(blockElement as HTMLElement).style.backgroundColor = 'rgba(59, 130, 246, 0.2)'
        setTimeout(() => {
          ;(blockElement as HTMLElement).style.backgroundColor = originalBackground
        }, 2000)
      }
    }
  }, [])

  const rootComments = comments.filter(comment => !comment.parentId)
  const repliesByParent = comments.reduce<Record<string, EditorComment[]>>((acc, comment) => {
    if (!comment.parentId) return acc
    if (!acc[comment.parentId]) {
      acc[comment.parentId] = []
    }
    acc[comment.parentId].push(comment)
    return acc
  }, {})

  Object.values(repliesByParent).forEach((replyList) => {
    replyList.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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

      <div style={{ flex: 1, overflow: 'auto', padding: '12px' }}>
        {rootComments.length === 0 ? (
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
            {rootComments.map((comment) => {
              const accent = getCommentAccent(comment)
              const replies = repliesByParent[comment.id] || []
              const resolved = isResolvedComment(comment)
              const canEdit = comment.source === 'user'

              return (
                <div
                  key={comment.id}
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    border: `1px solid ${accent.border}`,
                    backgroundColor: accent.background,
                    opacity: resolved ? 0.86 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 999,
                        background: accent.badgeBg,
                        color: accent.badgeText,
                        fontWeight: 700,
                      }}>
                        {getCommentLabel(comment)}
                      </span>
                      {comment.severity && comment.source === 'agent' && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {comment.severity === 'critical' ? '严重问题' : comment.severity === 'warning' ? '建议修改' : '提示'}
                        </span>
                      )}
                      {resolved && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 999,
                          background: 'rgba(34, 197, 94, 0.12)',
                          color: '#15803d',
                          fontWeight: 700,
                        }}>
                          <ResolveIcon filled />
                          已解决
                        </span>
                      )}
                    </div>
                  </div>

                  {comment.selectedText && (
                    <div
                      onClick={() => handleJumpToComment(comment)}
                      style={{
                        padding: '6px 10px',
                        marginBottom: '8px',
                        backgroundColor: resolved ? 'rgba(34, 197, 94, 0.08)' : 'rgba(59, 130, 246, 0.08)',
                        borderLeft: resolved ? '3px solid rgba(34, 197, 94, 0.7)' : '3px solid var(--accent-color)',
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

                  {replies.length > 0 && (
                    <div style={{
                      marginTop: '10px',
                      marginLeft: '10px',
                      paddingLeft: '12px',
                      borderLeft: '2px solid rgba(59, 130, 246, 0.14)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}>
                      {replies.map((reply) => {
                        const replyAccent = getCommentAccent(reply)
                        return (
                          <div
                            key={reply.id}
                            style={{
                              borderRadius: '8px',
                              border: `1px solid ${replyAccent.border}`,
                              backgroundColor: replyAccent.background,
                              padding: '10px 12px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                              <span style={{
                                fontSize: 10,
                                padding: '2px 6px',
                                borderRadius: 999,
                                background: replyAccent.badgeBg,
                                color: replyAccent.badgeText,
                                fontWeight: 700,
                              }}>
                                {getCommentLabel(reply)}
                              </span>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {formatCommentTime(reply.createdAt)}
                              </span>
                            </div>
                            <div style={{
                              fontSize: '13px',
                              lineHeight: 1.6,
                              color: 'var(--text-primary)',
                              whiteSpace: 'pre-wrap',
                            }}>
                              {reply.content}
                            </div>
                            <div style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              marginTop: '8px',
                              paddingTop: '8px',
                              borderTop: '1px solid var(--border-color)',
                            }}>
                              <Tooltip content="删除" placement="top">
                                <button
                                  onClick={() => handleDeleteComment(reply.id)}
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
                        )
                      })}
                    </div>
                  )}

                  {editingId !== comment.id && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '10px',
                      paddingTop: '8px',
                      borderTop: '1px solid var(--border-color)',
                    }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {formatCommentTime(comment.createdAt)}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Button
                          size="sm"
                          variant="light"
                          color="primary"
                          onPress={() => handleAIReply(comment)}
                          isLoading={aiReplyingId === comment.id}
                          isDisabled={resolved || aiReplyingId !== null}
                          startContent={aiReplyingId === comment.id ? null : <SparkleIcon />}
                          style={{ minWidth: 0 }}
                        >
                          AI 回复
                        </Button>
                        <Tooltip content={resolved ? '标记为未解决' : '标记为已解决'} placement="top">
                          <button
                            onClick={() => handleToggleResolved(comment)}
                            style={{
                              padding: '4px',
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              color: resolved ? '#16a34a' : 'var(--text-muted)',
                              borderRadius: '4px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <ResolveIcon filled={resolved} />
                          </button>
                        </Tooltip>
                        {canEdit && (
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
                        )}
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
              )
            })}
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

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M5 3v4" />
      <path d="M3 5h4" />
      <path d="M19 17v4" />
      <path d="M17 19h4" />
    </svg>
  )
}

function ResolveIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'rgba(34, 197, 94, 0.16)' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
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
