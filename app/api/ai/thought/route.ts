import { NextRequest, NextResponse } from 'next/server'
import { 
  generateThoughtSummary, 
  organizeThought, 
  refineThought, 
  expandThought,
  type ThoughtAIAction 
} from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { 
      content: string
      action: ThoughtAIAction
      modelConfig: ModelConfig 
    }
    const { content, action, modelConfig } = body

    let result

    switch (action) {
      case 'summarize':
        result = await generateThoughtSummary(content, modelConfig)
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        return NextResponse.json({ title: result.title, summary: result.summary })

      case 'organize':
        result = await organizeThought(content, modelConfig)
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        return NextResponse.json({ result: result.result })

      case 'refine':
        result = await refineThought(content, modelConfig)
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        return NextResponse.json({ result: result.result })

      case 'expand':
        result = await expandThought(content, modelConfig)
        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 400 })
        }
        return NextResponse.json({ result: result.result })

      default:
        return NextResponse.json({ error: '未知的操作类型' }, { status: 400 })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
