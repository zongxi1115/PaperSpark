'use client'

import type { ModelConfig, TextBlock } from './types'
import { deleteVectorDocumentsByDocumentId, saveVectorDocuments } from './pdfCache'

const SURYA_SERVICE_URL = process.env.NEXT_PUBLIC_SURYA_SERVICE_URL || 'http://127.0.0.1:8765'

export type RAGIndexResult = {
  success: boolean
  count: number
  storedLocally: boolean
  error?: string
}

export type RAGDeleteResult = {
  success: boolean
  error?: string
}

/**
 * 删除远程向量数据库中的文档向量
 */
export async function deleteRemoteVectors(documentId: string): Promise<RAGDeleteResult> {
  try {
    const response = await fetch(`${SURYA_SERVICE_URL}/rag/${documentId}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const text = await response.text()
      return { success: false, error: text || '删除失败' }
    }

    return { success: true }
  } catch (error) {
    // 远程服务不可用时，视为成功（本地向量会在 deleteKnowledgeItemCache 中删除）
    console.warn('Failed to delete remote vectors:', error)
    return { success: true }
  }
}

export async function indexKnowledgeForRAG(params: {
  documentId: string
  blocks: TextBlock[]
  modelConfig?: ModelConfig | null
  forceLocal?: boolean
}): Promise<RAGIndexResult> {
  const { documentId, blocks, modelConfig, forceLocal } = params

  if (!documentId || blocks.length === 0) {
    return {
      success: false,
      count: 0,
      storedLocally: false,
      error: '没有可用于索引的文本块',
    }
  }

  const response = await fetch('/api/rag/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, blocks, modelConfig, forceLocal }),
  })

  const payload = await response.json()
  if (!response.ok || !payload.success) {
    return {
      success: false,
      count: 0,
      storedLocally: false,
      error: payload.error || 'RAG 建库失败',
    }
  }

  if (payload.storedRemotely) {
    await deleteVectorDocumentsByDocumentId(documentId)
    return {
      success: true,
      count: payload.count || 0,
      storedLocally: false,
    }
  }

  if (Array.isArray(payload.vectorDocuments) && payload.vectorDocuments.length > 0) {
    await saveVectorDocuments(documentId, payload.vectorDocuments)
    return {
      success: true,
      count: payload.vectorDocuments.length,
      storedLocally: true,
    }
  }

  return {
    success: true,
    count: payload.count || 0,
    storedLocally: false,
  }
}

/**
 * 删除知识条目的所有向量数据（本地 + 远程）
 */
export async function deleteKnowledgeVectors(documentId: string): Promise<RAGDeleteResult> {
  // 删除本地向量
  await deleteVectorDocumentsByDocumentId(documentId)

  // 删除远程向量
  const remoteResult = await deleteRemoteVectors(documentId)

  return remoteResult
}