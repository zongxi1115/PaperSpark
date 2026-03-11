import { NextRequest, NextResponse } from 'next/server'
import { smartChunkText } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { blocks, modelConfig } = body as {
      blocks: { id: string; text: string; type: string }[]
      modelConfig: ModelConfig
    }

    if (!blocks || !Array.isArray(blocks)) {
      return NextResponse.json({ error: '缺少 blocks 参数' }, { status: 400 })
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return NextResponse.json({ error: '模型配置不完整' }, { status: 400 })
    }

    const result = await smartChunkText(blocks, modelConfig)

    if (!result.success) {
      return NextResponse.json({ error: result.error || '分块失败' }, { status: 500 })
    }

    return NextResponse.json({ chunks: result.chunks })
  } catch (error) {
    console.error('Chunk error:', error)
    const message = error instanceof Error ? error.message : '分块处理失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
