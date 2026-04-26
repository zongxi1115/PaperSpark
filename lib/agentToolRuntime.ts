'use client'

import { isAgentReviewComment } from './agents'
import { getEditor } from './editorContext'
import { getDocumentCommentsByAgent, getLastDocId, getDocumentComments, replaceDocumentCommentsByAgent } from './storage'
import { applyCommentThreadMark, removeCommentThreadMarks } from './commentStyles'
import { resolveCommentRangeInBlock } from '@/lib/comments/commentAnchors'
import type { Agent } from './types'
import type { AgentDocumentCommentOutput } from './agentTooling'
import type { EditorComment } from './types'

function getCommentSeverityWeight(severity?: EditorComment['severity']): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function getHighestCommentSeverity(comments: EditorComment[]): NonNullable<EditorComment['severity']> {
  return comments.reduce<NonNullable<EditorComment['severity']>>((current, comment) => (
    getCommentSeverityWeight(comment.severity) > getCommentSeverityWeight(current)
      ? (comment.severity || 'info')
      : current
  ), 'info')
}

function isResolvedComment(comment: EditorComment): boolean {
  return Boolean(comment.resolvedAt)
}

export function applyAgentDocumentComments(params: {
  agent: Agent
  toolOutput: AgentDocumentCommentOutput
  generateId: () => string
  capabilityId?: 'document_comment' | 'document_review'
}): { success: boolean; count: number; documentId?: string; error?: string } {
  const documentId = getLastDocId()
  if (!documentId) {
    return { success: false, count: 0, error: '未找到当前文档' }
  }

  const editor = getEditor()
  const capabilityKey = params.capabilityId || 'document_comment'
  const previousAgentComments = getDocumentCommentsByAgent(documentId, params.agent.id, capabilityKey)
    .filter(comment => !comment.parentId)

  const comments: EditorComment[] = (params.toolOutput.comments || []).map((item) => {
    const block = item.blockId ? editor?.getBlock(item.blockId) : undefined
    const range = resolveCommentRangeInBlock(block, {
      selectedText: item.selectedText || '',
    })

    return {
      id: params.generateId(),
      documentId,
      selectedText: item.selectedText || '',
      blockId: item.blockId,
      startOffset: range?.start,
      endOffset: range?.end,
      content: item.comment,
      source: 'agent',
      agentId: params.agent.id,
      agentTitle: params.agent.title,
      capabilityId: capabilityKey,
      severity: item.severity || 'warning',
      tone: 'red',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  })

  previousAgentComments.forEach((comment) => {
    removeCommentThreadMarks(comment.id)
  })

  comments.forEach((comment) => {
    applyCommentThreadMark(comment)
  })

  replaceDocumentCommentsByAgent(documentId, params.agent.id, comments, capabilityKey)
  syncAgentCommentHighlights(documentId)

  return { success: true, count: comments.length, documentId }
}

export function syncAgentCommentHighlights(documentId?: string | null) {
  const activeDocumentId = documentId || getLastDocId()
  if (!activeDocumentId) return

  const root = document.querySelector('.bn-editor')
  if (!root) return

  const highlightedBlocks = root.querySelectorAll<HTMLElement>('[data-review-issue="true"]')
  highlightedBlocks.forEach((element) => {
    delete element.dataset.reviewIssue
    delete element.dataset.reviewSeverity
    delete element.dataset.reviewAgent
    element.removeAttribute('title')
  })

  const groupedComments = new Map<string, EditorComment[]>()
  getDocumentComments(activeDocumentId)
    .filter(comment => comment.blockId && !comment.parentId && !isResolvedComment(comment) && isAgentReviewComment(comment))
    .forEach((comment) => {
      const blockId = comment.blockId as string
      const existing = groupedComments.get(blockId) || []
      existing.push(comment)
      groupedComments.set(blockId, existing)
    })

  groupedComments.forEach((comments, blockId) => {
    const element = root.querySelector<HTMLElement>(`[data-id="${blockId}"]`)
    if (!element) return

    element.dataset.reviewIssue = 'true'
    element.dataset.reviewSeverity = getHighestCommentSeverity(comments)
    element.dataset.reviewAgent = comments[0]?.agentTitle || '智能体'
    element.title = comments
      .map(comment => `${comment.agentTitle || '智能体'}：${comment.selectedText ? `「${comment.selectedText}」 ` : ''}${comment.content}`)
      .join('\n\n')
  })
}
