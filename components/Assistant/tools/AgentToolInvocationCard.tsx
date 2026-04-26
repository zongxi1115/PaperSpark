'use client'

import type { AssistantToolInvocation } from '@/lib/types'
import type { AgentDocumentCommentOutput, AgentDocumentContext, AgentEditToolOutput } from '@/lib/agentTooling'
import type { EditDocumentRequest, EditStatus } from './EditDocumentTool'
import { EditDocumentTool } from './EditDocumentTool'
import { getAgentToolLabel } from '@/lib/agentTooling'

interface AgentToolInvocationCardProps {
  invocation: AssistantToolInvocation
  editRequest?: EditDocumentRequest
  editStatus?: EditStatus
  editProgress?: string
  editError?: string
  onAcceptEdit?: () => void
  onRejectEdit?: () => void
}

export function AgentToolInvocationCard({
  invocation,
  editRequest,
  editStatus = 'idle',
  editProgress = '',
  editError = '',
  onAcceptEdit,
  onRejectEdit,
}: AgentToolInvocationCardProps) {
  if (invocation.toolName === 'editCurrentDocument' && editRequest && onAcceptEdit && onRejectEdit) {
    return (
      <EditDocumentTool
        request={editRequest}
        status={editStatus}
        progress={editProgress}
        error={editError}
        onAccept={onAcceptEdit}
        onReject={onRejectEdit}
      />
    )
  }

  const title = getAgentToolLabel(invocation.toolName)
  const statusLabel = {
    'input-streaming': '调用中…',
    running: '执行中…',
    completed: '已完成',
    applied: '已应用',
    reviewing: '待确认',
    accepted: '已接受',
    rejected: '已撤销',
    error: '失败',
  }[invocation.status]

  return (
    <div style={{
      border: '1px solid var(--border-color)',
      borderRadius: 10,
      background: 'var(--bg-secondary)',
      padding: '10px 12px',
      margin: '6px 0',
      display: 'grid',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          {title}
        </span>
        <span style={{ fontSize: 11, color: invocation.status === 'error' ? '#ef4444' : 'var(--text-muted)' }}>
          {statusLabel}
        </span>
      </div>
      {renderInvocationBody(invocation)}
      {invocation.error && (
        <div style={{ fontSize: 11, color: '#ef4444' }}>
          {invocation.error}
        </div>
      )}
    </div>
  )
}

function renderInvocationBody(invocation: AssistantToolInvocation) {
  if (invocation.toolName === 'readCurrentDocument') {
    const output = invocation.output as AgentDocumentContext | undefined
    if (!output) return null

    return (
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        <div>块数：{output.structure.length}</div>
        <div>字符数：{output.markdown.length}</div>
        {output.title && <div>标题：{output.title}</div>}
      </div>
    )
  }

  if (invocation.toolName === 'commentCurrentDocument') {
    const output = invocation.output as AgentDocumentCommentOutput | undefined
    if (!output) return null

    return (
      <div style={{ display: 'grid', gap: 6 }}>
        {output.summary && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {output.summary}
          </div>
        )}
        {output.comments.slice(0, 4).map((comment, index) => (
          <div
            key={`${comment.blockId}-${index}`}
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.05)',
              border: '1px solid rgba(239, 68, 68, 0.12)',
            }}
          >
            <div style={{ color: '#dc2626', marginBottom: 4 }}>
              {comment.severity === 'critical' ? '严重问题' : comment.severity === 'info' ? '提示' : '建议修改'}
            </div>
            {comment.selectedText && (
              <div style={{ marginBottom: 4 }}>
                「{comment.selectedText}」
              </div>
            )}
            <div>{comment.comment}</div>
          </div>
        ))}
        {output.comments.length > 4 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            另有 {output.comments.length - 4} 条未展开
          </div>
        )}
      </div>
    )
  }

  if (invocation.toolName === 'editCurrentDocument') {
    const output = invocation.output as AgentEditToolOutput | undefined
    if (!output) return null

    return (
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {output.summary || `共 ${output.operations.length} 个编辑动作`}
      </div>
    )
  }

  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
      暂无预览
    </div>
  )
}
