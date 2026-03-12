import { NextRequest, NextResponse } from 'next/server'
import type { ModelConfig, RAGSearchResult, VectorDocument } from '@/lib/types'
import { cosineSimilarity } from '@/lib/ragUtils'
import { resolveEmbeddingProvider, resolveRerankProvider } from '@/lib/ragServerConfig'

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
  modelConfig?: ModelConfig | null
): Promise<number[]> {
  const provider = resolveEmbeddingProvider(modelConfig)

  if (!provider.apiKey || !provider.baseUrl || !provider.modelName) {
    throw new Error('Missing embedding provider configuration')
  }

  const response = await fetch(provider.baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.modelName,
      input: query,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to generate query embedding: ${response.status} ${await response.text()}`)
  }

  const data = await response.json()
  return data.data[0].embedding
}

async function rerankResults(query: string, results: RAGSearchResult[]): Promise<RAGSearchResult[]> {
  const provider = resolveRerankProvider()

  if (!provider || results.length === 0) {
    return results
  }

  try {
    const response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.modelName,
        query,
        documents: results.map(result => result.text),
        top_n: results.length,
        return_documents: false,
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to rerank results: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json()
    const items = Array.isArray(payload.results) ? payload.results : []

    if (items.length === 0) {
      return results
    }

    return items
      .map((item: { index?: number; relevance_score?: number; score?: number }) => {
        const index = typeof item.index === 'number' ? item.index : -1
        if (index < 0 || index >= results.length) {
          return null
        }

        return {
          ...results[index],
          score: typeof item.relevance_score === 'number'
            ? item.relevance_score
            : typeof item.score === 'number'
              ? item.score
              : results[index].score,
        }
      })
      .filter((item): item is RAGSearchResult => Boolean(item))
  } catch (error) {
    console.error('Rerank failed:', error)
    return results
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, query, topK = 5, modelConfig, localVectors } = body as {
      documentId?: string
      query: string
      topK?: number
      modelConfig?: ModelConfig | null
      localVectors?: VectorDocument[] // 本地存储的向量数据
    }

    const provider = resolveEmbeddingProvider(modelConfig)

    if (!query) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 })
    }

    if (!provider.apiKey || !provider.baseUrl || !provider.modelName) {
      return NextResponse.json({
        success: false,
        error: '缺少检索嵌入配置，请检查 .env.local 中的 embedding_name、base_url、api_key',
      }, { status: 500 })
    }

    const candidateCount = Math.min(Math.max(topK * 4, topK), 20)

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
              top_k: candidateCount,
              openai_api_key: provider.apiKey,
              openai_base_url: provider.baseUrl,
              embedding_name: provider.modelName,
            }),
          })

          if (response.ok) {
            const result = await response.json()
            const rerankedResults = await rerankResults(query, Array.isArray(result.results) ? result.results : [])
            return NextResponse.json({
              success: true,
              results: rerankedResults.slice(0, topK),
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
      .slice(0, candidateCount)
      .map(({ vector, similarity }) => ({
        blockId: vector.blockId,
        text: vector.text,
        score: similarity,
        pageNum: vector.metadata.pageNum,
        type: vector.metadata.type,
      }))

    const rerankedResults = await rerankResults(query, results)

    return NextResponse.json({
      success: true,
      results: rerankedResults.slice(0, topK),
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
