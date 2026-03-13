import { autoCompleteFragment, generateAIText } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export const maxDuration = 15

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      context?: string
      prompt?: string
      modelConfig: ModelConfig
      maxTokens?: number
    }

    const { context, prompt, modelConfig, maxTokens } = body

    if (!context && !prompt) {
      return Response.json({ error: '缺少 context 或 prompt 参数' }, { status: 400 })
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return Response.json({ error: '请先在设置页配置小参数模型' }, { status: 400 })
    }

    // 如果提供了 prompt 参数，使用通用文本生成
    if (prompt) {
      const result = await generateAIText(
        prompt,
        '你是一个学术阅读助手，帮助用户生成相关的追问问题。',
        modelConfig
      )

      if (!result.success) {
        return Response.json({ error: result.error }, { status: 500 })
      }

      return Response.json({ completion: result.text })
    }

    // 否则使用自动补全模式
    if (!context) {
      return Response.json({ error: '缺少上下文内容' }, { status: 400 })
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
