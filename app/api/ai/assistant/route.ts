import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import type { ModelConfig } from '@/lib/types'

export const maxDuration = 60

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: Request) {
  const { 
    messages, 
    modelConfig, 
    systemPrompt,
    knowledgeContext,
  } = await req.json() as {
    messages: ChatMessage[]
    modelConfig?: ModelConfig
    systemPrompt?: string
    knowledgeContext?: string
  }

  if (!modelConfig?.apiKey || !modelConfig?.modelName) {
    return Response.json(
      { error: '请先在设置页配置大参数模型的 API Key 和模型名称' },
      { status: 400 }
    )
  }

  const provider = createOpenAI({
    baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
    apiKey: modelConfig.apiKey,
  })

  // 构建系统提示
  let fullSystemPrompt = systemPrompt || '你是一个智能学术助手，帮助用户解答学术问题、写作和思考。'
  
  // 如果有知识库上下文，添加到系统提示
  if (knowledgeContext && knowledgeContext.trim()) {
    fullSystemPrompt += `\n\n以下是用户知识库中的相关内容，请参考这些信息回答问题：\n\n${knowledgeContext}`
  }

  const result = streamText({
    model: provider.chat(modelConfig.modelName),
    system: fullSystemPrompt,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
  })

  return result.toTextStreamResponse()
}
