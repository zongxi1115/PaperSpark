import { autoCompleteFragment } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export const maxDuration = 15

export async function POST(req: Request) {
  try {
    const { context, modelConfig } = await req.json() as {
      context: string
      modelConfig: ModelConfig
    }

    if (!context) {
      return Response.json({ error: '缺少上下文内容' }, { status: 400 })
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return Response.json({ error: '请先在设置页配置小参数模型' }, { status: 400 })
    }

    const result = await autoCompleteFragment(context, modelConfig)

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 500 })
    }

    return Response.json({ completion: result.completion })
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    return Response.json({ error: message }, { status: 500 })
  }
}
