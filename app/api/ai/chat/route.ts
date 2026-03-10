import { createOpenAI } from '@ai-sdk/openai'
import { convertToModelMessages, streamText } from 'ai'
import {
  aiDocumentFormats,
  injectDocumentStateMessages,
  toolDefinitionsToToolSet,
} from '@blocknote/xl-ai/server'
import type { ModelConfig } from '@/lib/types'

export const maxDuration = 30

export async function POST(req: Request) {
  const { messages, toolDefinitions, modelConfig } = await req.json() as {
    messages: Parameters<typeof injectDocumentStateMessages>[0]
    toolDefinitions: Parameters<typeof toolDefinitionsToToolSet>[0]
    modelConfig?: ModelConfig
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

  const result = streamText({
    model: provider.chat(modelConfig.modelName),
    system: aiDocumentFormats.html.systemPrompt,
    messages: await convertToModelMessages(injectDocumentStateMessages(messages)),
    tools: toolDefinitionsToToolSet(toolDefinitions),
    toolChoice: 'required',
  })

  return result.toUIMessageStreamResponse()
}
