'use client'

import type { ModelConfig, TextBlock } from './types'
import { deleteVectorDocumentsByDocumentId, saveVectorDocuments } from './pdfCache'

export type RAGIndexResult = {
  success: boolean
  count: number
  storedLocally: boolean
  error?: string
}

export async function indexKnowledgeForRAG(params: {
  documentId: string
  blocks: TextBlock[]
  modelConfig?: ModelConfig | null
}): Promise<RAGIndexResult> {
  const { documentId, blocks, modelConfig } = params

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
    body: JSON.stringify({ documentId, blocks, modelConfig }),
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