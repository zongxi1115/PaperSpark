import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText, tool } from 'ai'
import type { AssistantCitation, ModelConfig } from '@/lib/types'
import { z } from 'zod'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type ToolStatusEvent = {
  type: 'tool-status'
  id: string
  toolName: string
  status: 'running' | 'success' | 'error'
  message: string
}

export const maxDuration = 60

function buildKnowledgeContext(citations: AssistantCitation[]) {
  return citations.map(citation => {
    const meta = [
      citation.authors?.length ? `作者：${citation.authors.join('、')}` : '',
      citation.year ? `年份：${citation.year}` : '',
      citation.journal ? `来源：${citation.journal}` : '',
      citation.pageNum ? `页码：第${citation.pageNum}页` : '',
      `类型：${citation.sourceKind === 'overview' ? '知识库概要' : citation.sourceKind === 'asset' ? '资产库全文' : '知识库精读全文'}`,
      `相关片段：${citation.excerpt}`,
    ].filter(Boolean).join('\n')

    return `[${citation.id}] ${citation.title}\n${meta}`
  }).join('\n\n')
}

export async function POST(req: Request) {
  const { 
    messages, 
    modelConfig, 
    systemPrompt,
    useKnowledge,
    knowledgeCandidates,
    assetContext,
  } = await req.json() as {
    messages: ChatMessage[]
    modelConfig?: ModelConfig
    systemPrompt?: string
    useKnowledge?: boolean
    knowledgeCandidates?: AssistantCitation[]
    assetContext?: string
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

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const write = (part: object) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(part)}\n`))
      }

      try {
        let finalCitations: AssistantCitation[] = []
        const latestUserMessage = [...messages].reverse().find(message => message.role === 'user')?.content || ''

        if (useKnowledge && Array.isArray(knowledgeCandidates) && knowledgeCandidates.length > 0) {
          const toolEventBase = {
            type: 'tool-status' as const,
            id: 'search-my-knowledge-base',
            toolName: 'searchMyKnowledgeBase',
          }

          write({
            ...toolEventBase,
            status: 'running',
            message: '正在检索并重排序我的知识库…',
          } satisfies ToolStatusEvent)

          const toolRun = await generateText({
            model: provider.chat(modelConfig.modelName),
            system: '你是知识库检索代理。你必须调用 searchMyKnowledgeBase 工具，并将用户问题压缩为一个适合检索的中文查询。不要直接回答。',
            prompt: latestUserMessage,
            toolChoice: { type: 'tool', toolName: 'searchMyKnowledgeBase' },
            tools: {
              searchMyKnowledgeBase: tool({
                description: '搜索用户的知识库候选结果，返回最相关的概要与精读全文片段。',
                inputSchema: z.object({
                  query: z.string().describe('面向检索的查询语句'),
                }),
                execute: async ({ query }) => {
                  const normalized = query.trim().toLowerCase()
                  const reranked = [...knowledgeCandidates]
                    .sort((left, right) => right.score - left.score)
                    .filter(candidate => normalized.length === 0 || candidate.title.toLowerCase().includes(normalized) || candidate.excerpt.toLowerCase().includes(normalized) || candidate.score > 0.45)
                    .slice(0, 6)

                  return {
                    query,
                    citations: reranked.length > 0 ? reranked : knowledgeCandidates.slice(0, 6),
                  }
                },
              }),
            },
          })

          const toolResults = toolRun.steps.flatMap(step => step.toolResults)
          const firstResult = toolResults[0]?.output as { citations?: AssistantCitation[] } | undefined
          finalCitations = Array.isArray(firstResult?.citations)
            ? firstResult.citations
            : knowledgeCandidates.slice(0, 6)

          write({
            ...toolEventBase,
            status: 'success',
            message: `知识库检索完成，命中 ${finalCitations.length} 条证据`,
          } satisfies ToolStatusEvent)

          write({
            type: 'citations',
            citations: finalCitations,
          })
        }

        let fullSystemPrompt = systemPrompt || '你是一个智能学术助手，帮助用户解答学术问题、写作和思考。'

        if (finalCitations.length > 0) {
          fullSystemPrompt += `\n\n你现在可以使用用户知识库中检索出的证据。回答时必须遵守：\n1. 只引用给定证据，不得虚构来源。\n2. 使用到哪条证据，就在对应句末使用 [K1] 这类编号引用。\n3. 回答末尾必须单独给出“参考资料”小节，每条一行，格式为 [K1] 标题｜来源类型｜年份/页码。\n4. 如果证据不足，明确说明证据不足。\n\n可用证据如下：\n${buildKnowledgeContext(finalCitations)}`
        }

        if (assetContext && assetContext.trim()) {
          fullSystemPrompt += `\n\n你还可以参考用户资产库中的材料。若资产库内容与问题直接相关，请优先结合这些材料回答；如果资产库不足，再说明不足。资产库材料如下：\n${assetContext}`
        }

        const result = streamText({
          model: provider.chat(modelConfig.modelName),
          system: fullSystemPrompt,
          messages: messages.map(message => ({
            role: message.role,
            content: message.content,
          })),
        })

        for await (const delta of result.textStream) {
          write({ type: 'text-delta', delta })
        }

        write({ type: 'done' })
        controller.close()
      } catch (error) {
        write({
          type: 'error',
          error: error instanceof Error ? error.message : '助手响应失败',
        })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  })
}
