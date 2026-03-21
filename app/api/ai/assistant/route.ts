import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText, tool } from 'ai'
import type { AssistantCitation, ModelConfig } from '@/lib/types'
import { z } from 'zod'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type DocumentBlockInfo = {
  id: string
  type: string
  text: string
  level?: number
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
    ].filter(Boolean).join('\
')

    return `[${citation.id}] ${citation.title}\
${meta}`
  }).join('\
\
')
}

export async function POST(req: Request) {
  const {
    messages,
    modelConfig,
    systemPrompt,
    useKnowledge,
    knowledgeCandidates,
    assetContext,
    documentStructure,
  } = await req.json() as {
    messages: ChatMessage[]
    modelConfig?: ModelConfig
    systemPrompt?: string
    useKnowledge?: boolean
    knowledgeCandidates?: AssistantCitation[]
    assetContext?: string
    documentStructure?: DocumentBlockInfo[]
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
        controller.enqueue(encoder.encode(`${JSON.stringify(part)}\
`))
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
                    count: reranked.length,
                    results: reranked.map(candidate => ({
                      id: candidate.id,
                      title: candidate.title,
                      excerpt: candidate.excerpt,
                      score: candidate.score,
                      sourceKind: candidate.sourceKind,
                    })),
                  }
                },
              }),
            },
          })

          const toolResult = toolRun.toolResults?.[0]
          if (toolResult && 'result' in toolResult) {
            const result = toolResult.result as { results?: AssistantCitation[] }
            if (Array.isArray(result?.results)) {
              const ids = new Set(result.results.map((r: AssistantCitation) => r.id))
              finalCitations = knowledgeCandidates.filter(c => ids.has(c.id))
            }
          }

          if (finalCitations.length === 0) {
            finalCitations = [...knowledgeCandidates].sort((a, b) => b.score - a.score).slice(0, 6)
          }

          write({
            ...toolEventBase,
            status: finalCitations.length > 0 ? 'success' : 'error',
            message: finalCitations.length > 0
              ? `已精选 ${finalCitations.length} 条知识库证据`
              : '未找到相关知识库证据',
          } satisfies ToolStatusEvent)

          write({
            type: 'citations',
            citations: finalCitations,
          })
        }

        let fullSystemPrompt = systemPrompt || '你是一个智能学术助手，帮助用户解答学术问题、写作和思考。'

        if (finalCitations.length > 0) {
          fullSystemPrompt += `\
\
你现在可以使用用户知识库中检索出的证据。回答时必须遵守：\
1. 只引用给定证据，不得虚构来源。\
2. 使用到哪条证据，就在对应句末使用 [K1] 这类编号引用。\
3. 回答末尾必须单独给出