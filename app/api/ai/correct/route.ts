import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { NextRequest, NextResponse } from 'next/server'
import type { ModelConfig } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { text: string; modelConfig: ModelConfig }
    const { text, modelConfig } = body

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return NextResponse.json(
        { error: '模型未配置，请先在设置页面填写 API Key 和模型名称' },
        { status: 400 }
      )
    }

    if (!text || text.trim().length < 2) {
      return NextResponse.json({ corrected: text })
    }

    const provider = createOpenAI({
      baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
      apiKey: modelConfig.apiKey,
      compatibility: 'compatible',
    })

    const { text: corrected } = await generateText({
      model: provider(modelConfig.modelName),
      messages: [
        {
          role: 'system',
          content:
            '你是一个精准的文字校对助手。请改正输入文本中的错别字和拼写错误，保持原文的格式、标点和意思完全不变。只返回修正后的文本，不要添加任何解释、前缀或后缀。如果文本没有错误，原样返回。',
        },
        {
          role: 'user',
          content: text,
        },
      ],
    })

    return NextResponse.json({ corrected })
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
