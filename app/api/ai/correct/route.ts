import { NextRequest, NextResponse } from 'next/server'
import { correctText } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { text: string; modelConfig: ModelConfig }
    const { text, modelConfig } = body

    const result = await correctText(text, modelConfig)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ corrected: result.corrected })
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}