import { NextRequest, NextResponse } from 'next/server'
import { translateText } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { 
      text: string
      modelConfig: ModelConfig
      sourceLang?: string
      targetLang?: string
      style?: string
    }
    
    const { text, modelConfig, sourceLang, targetLang, style } = body

    const result = await translateText(text, modelConfig, { sourceLang, targetLang, style })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ translated: result.translated })
  } catch (err) {
    const message = err instanceof Error ? err.message : '翻译请求失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
