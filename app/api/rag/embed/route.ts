import { NextRequest, NextResponse } from 'next/server'
import type { TextBlock, ModelConfig, VectorDocument } from '@/lib/types'
import { resolveEmbeddingProvider } from '@/lib/ragServerConfig'

export const maxDuration = 120

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

// 使用 OpenAI API 生成嵌入
async function generateEmbeddings(
  texts: string[],
  modelConfig?: ModelConfig | null
): Promise<number[][]> {
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
      input: texts,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to generate embeddings: ${response.status} ${await response.text()}`)
  }

  const data = await response.json()
  return data.data.map((item: { embedding: number[] }) => item.embedding)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, blocks, modelConfig, forceLocal } = body as {
      documentId: string
      blocks: TextBlock[]
      modelConfig?: ModelConfig | null
      forceLocal?: boolean
    }

    const provider = resolveEmbeddingProvider(modelConfig)

    if (!provider.apiKey || !provider.baseUrl || !provider.modelName) {
      return NextResponse.json({
        success: false,
        error: '缺少嵌入模型配置，请检查 .env.local 中的 embedding_name、base_url、api_key',
      }, { status: 500 })
    }

    if (!documentId || !blocks || blocks.length === 0) {
      return NextResponse.json({ success: false, error: '参数不完整' }, { status: 400 })
    }

    // 过滤有效的文本块
    const validBlocks = blocks.filter(
      b => b.text.trim().length > 20 && b.type !== 'header' && b.type !== 'footer'
    )

    if (validBlocks.length === 0) {
      return NextResponse.json({ success: true, message: '没有有效的文本块需要嵌入' })
    }

    // 准备嵌入数据
    const texts = validBlocks.map(b => b.text.slice(0, 1000))
    const ids = validBlocks.map(b => b.id)
    const metadatas = validBlocks.map(b => ({
      pageNum: b.pageNum,
      type: b.type,
      bbox: b.bbox,
    }))

    // 尝试使用 Surya Python 服务
    const suryaAvailable = await checkSuryaService()
    
    if (suryaAvailable && !forceLocal) {
      try {
        const response = await fetch(`${SURYA_SERVICE_URL}/rag/embed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document_id: documentId,
            texts,
            block_ids: ids,
            metadatas,
            openai_api_key: provider.apiKey,
            openai_base_url: provider.baseUrl,
            embedding_name: provider.modelName,
          }),
        })

        if (response.ok) {
          const result = await response.json()
          return NextResponse.json({
            success: true,
            storedRemotely: true,
            message: result.message,
            count: result.count,
          })
        }
      } catch (error) {
        console.error('Surya service embed failed:', error)
        // 继续使用本地处理
      }
    }

    // 本地处理（生成嵌入向量返回给前端存储）
    let embeddings: number[][]
    try {
      embeddings = await generateEmbeddings(texts, modelConfig)
    } catch (error) {
      console.error('Embedding generation failed:', error)
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : '生成嵌入向量失败，请检查 API 配置',
      }, { status: 500 })
    }

    // 返回嵌入数据供客户端本地存储（IndexedDB）
    const vectorDocuments: VectorDocument[] = validBlocks.map((block, i) => ({
      id: block.id,
      documentId,
      blockId: block.id,
      text: block.text.slice(0, 1000),
      embedding: embeddings[i],
      metadata: {
        pageNum: block.pageNum,
        type: block.type,
        bbox: block.bbox,
      },
    }))

    return NextResponse.json({
      success: true,
      storedRemotely: false,
      vectorDocuments,
      message: `成功生成 ${validBlocks.length} 个文本块的嵌入向量（本地模式）`,
    })
  } catch (error) {
    console.error('RAG embed error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '处理失败' },
      { status: 500 }
    )
  }
}
