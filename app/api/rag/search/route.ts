import { NextRequest, NextResponse } from 'next/server'
import { cosineSimilarity } from '../embed/route'
import type { ModelConfig, RAGSearchResult, VectorDocument } from '@/lib/types'

export const maxDuration = 60

// Surya 服务地址
const SURYA_SERVICE_URL = process.env.SURYA_SERVICE_URL || 'http://127.0.0.1:8765'

// 检查 Surya 服务是否可用
async function checkSuryaService(): Promise<boolean> {
  try {
    const response = await fetch(`${SURYA_SERVICE_URL}/rag/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    return response.ok
  } catch {
    return false
  }
}

// 生成查询嵌入
async function generateQueryEmbedding(
  query: string,
  modelConfig: ModelConfig
): Promise<number[]> {
  const response = await fetch(`${modelConfig.baseUrl || 'https://api.openai.com/v1'}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${modelConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: query,
    }),
  })

  if (!response.ok) {
    throw new Error('Failed to generate query embedding')
  }

  const data = await response.json()
  return data.data[0].embedding
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, query, topK = 5, modelConfig, localVectors } = body as {
      documentId?: string
      query: string
      topK?: number
      modelConfig: ModelConfig
      localVectors?: VectorDocument[] // 本地存储的向量数据
    }

    if (!query || !modelConfig) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 })
    }

    // 尝试使用 Surya Python 服务搜索
    if (documentId) {
      const suryaAvailable = await checkSuryaService()
      
      if (suryaAvailable) {
        try {
          const response = await fetch(`${SURYA_SERVICE_URL}/rag/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              document_id: documentId,
              query,
              top_k: topK,
              openai_api_key: modelConfig.apiKey,
              openai_base_url: modelConfig.baseUrl || 'https://api.openai.com/v1',
            }),
          })

          if (response.ok) {
            const result = await response.json()
            return NextResponse.json({
              success: true,
              results: result.results,
              query,
              searchedRemotely: true,
            })
          }
        } catch (error) {
          console.error('Surya service search failed:', error)
          // 继续使用本地搜索
        }
      }
    }

    // 本地搜索
    if (!localVectors?.length) {
      return NextResponse.json({
        success: true,
        results: [],
        query,
        searchedRemotely: false,
        message: '没有本地向量数据，请先生成嵌入',
      })
    }

    // 生成查询嵌入
    let queryEmbedding: number[]
    try {
      queryEmbedding = await generateQueryEmbedding(query, modelConfig)
    } catch (error) {
      console.error('Query embedding failed:', error)
      return NextResponse.json({
        success: false,
        error: '生成查询嵌入失败',
      }, { status: 500 })
    }

    // 使用本地向量搜索
    const similarities = localVectors.map(v => ({
      vector: v,
      similarity: v.embedding ? cosineSimilarity(queryEmbedding, v.embedding) : 0,
    }))

    similarities.sort((a, b) => b.similarity - a.similarity)

    const results: RAGSearchResult[] = similarities
      .slice(0, topK)
      .map(({ vector, similarity }) => ({
        blockId: vector.blockId,
        text: vector.text,
        score: similarity,
        pageNum: vector.metadata.pageNum,
        type: vector.metadata.type,
      }))

    return NextResponse.json({
      success: true,
      results,
      query,
      searchedRemotely: false,
    })
  } catch (error) {
    console.error('RAG search error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '搜索失败' },
      { status: 500 }
    )
  }
}
