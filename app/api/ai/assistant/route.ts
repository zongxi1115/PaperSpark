import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText, stepCountIs, tool } from 'ai'
import type { AssistantCitation, ModelConfig } from '@/lib/types'
import type { AgentDocumentCommentOutput, AgentDocumentContext, AgentEditToolOutput } from '@/lib/agentTooling'
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

type DocumentAccess = {
  canRead?: boolean
  canEdit?: boolean
  canComment?: boolean
  toolMode?: boolean
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

const commentIssueSchema = z.object({
  blockId: z.string().describe('文档块 ID'),
  selectedText: z.string().optional().describe('对应的问题片段，可选'),
  comment: z.string().describe('批注内容，需明确指出问题与建议'),
  severity: z.enum(['info', 'warning', 'critical']).optional().describe('问题严重程度'),
})

const editOperationSchema = z.union([
  z.object({
    type: z.literal('insert'),
    position: z.enum(['before', 'after']),
    referenceId: z.string().optional(),
    content: z.string().describe('要插入的 Markdown 内容'),
  }),
  z.object({
    type: z.literal('update'),
    blockId: z.string(),
    content: z.string().describe('更新后的 Markdown 内容'),
  }),
  z.object({
    type: z.literal('delete'),
    blockId: z.string(),
  }),
])

export async function POST(req: Request) {
  const {
    messages,
    modelConfig,
    systemPrompt,
    useKnowledge,
    knowledgeCandidates,
    assetContext,
    documentStructure,
    documentAccess,
    documentContext,
  } = await req.json() as {
    messages: ChatMessage[]
    modelConfig?: ModelConfig
    systemPrompt?: string
    useKnowledge?: boolean
    knowledgeCandidates?: AssistantCitation[]
    assetContext?: string
    documentStructure?: DocumentBlockInfo[]
    documentAccess?: DocumentAccess
    documentContext?: AgentDocumentContext
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
          const citationIndexMap = finalCitations.map((c, i) => ({ ...c, _index: i + 1 }))
          fullSystemPrompt += `\n\n你现在可以使用用户知识库中检索出的证据。回答时必须遵守：\n1. 只引用给定证据，不得虚构来源。\n2. 使用到哪条证据，就在对应句末使用 <cite:N> 标记，其中 N 是该证据的序号（从 1 开始）。\n3. 如果证据不足，明确说明证据不足。\n\n可用证据如下：\n${citationIndexMap.map(c => `[${c._index}] ${c.title}`).join('\n')}\n${buildKnowledgeContext(finalCitations)}`
        }

        if (assetContext && assetContext.trim()) {
          fullSystemPrompt += `\n\n你还可以参考用户资产库中的材料。若资产库内容与问题直接相关，请优先结合这些材料回答；如果资产库不足，再说明不足。资产库材料如下：\n${assetContext}`
        }

        const availableTools: Record<string, any> = {}
        const documentBlockIds = new Set(documentContext?.structure.map(block => block.id) || [])

        if (documentAccess?.toolMode && documentAccess?.canRead && documentContext) {
          availableTools.readCurrentDocument = tool({
            description: '读取当前编辑器文稿内容与块结构，用于理解、审阅或后续编辑。',
            inputSchema: z.object({
              focus: z.string().optional().describe('可选：说明你想重点查看的内容'),
            }),
            execute: async () => {
              return documentContext
            },
          })

          fullSystemPrompt += '\n\n如果你需要了解当前文稿，请优先调用 `readCurrentDocument`，而不是臆测文稿内容。'
        }

        if (documentAccess?.toolMode && documentAccess?.canComment && documentContext) {
          availableTools.commentCurrentDocument = tool({
            description: '为当前文稿添加结构化批注。适合审稿、指出问题、给出修改建议。调用后客户端会自动写入评论并标记问题段落。',
            inputSchema: z.object({
              summary: z.string().optional().describe('本轮批注的简短摘要'),
              replaceExisting: z.boolean().optional().describe('是否替换该智能体此前对当前文档的批注，默认 true'),
              comments: z.array(commentIssueSchema).min(1).max(12),
            }),
            execute: async ({ summary, replaceExisting, comments }) => {
              const normalizedComments = comments
                .filter(item => documentBlockIds.has(item.blockId))
                .map(item => ({
                  blockId: item.blockId,
                  selectedText: item.selectedText?.trim() || '',
                  comment: item.comment.trim(),
                  severity: item.severity || 'warning',
                }))
                .filter(item => item.comment.length > 0)

              const output: AgentDocumentCommentOutput = {
                summary,
                replaceExisting: replaceExisting ?? true,
                comments: normalizedComments,
              }

              return output
            },
          })

          fullSystemPrompt += '\n\n如果你需要对当前文稿提出批注、审稿意见或指出不合适之处，请调用 `commentCurrentDocument`，而不是只在正文里描述。'
        }

        if (documentAccess?.toolMode && documentAccess?.canEdit && documentContext) {
          availableTools.editCurrentDocument = tool({
            description: '对当前文稿提出结构化编辑操作。客户端会执行这些编辑并提供确认界面。',
            inputSchema: z.object({
              summary: z.string().optional().describe('本轮编辑的简短摘要'),
              operations: z.array(editOperationSchema).min(1).max(8),
            }),
            execute: async ({ summary, operations }) => {
              const normalizedOperations = operations.filter((operation) => {
                if (operation.type === 'insert') {
                  return !operation.referenceId || documentBlockIds.has(operation.referenceId)
                }
                return documentBlockIds.has(operation.blockId)
              })

              const output: AgentEditToolOutput = {
                summary,
                operations: normalizedOperations,
              }

              return output
            },
          })

          fullSystemPrompt += '\n\n如果用户明确要求修改当前文稿，请优先调用 `editCurrentDocument`。旧的 `::insert/::update/::delete` 仍可兼容，但工具调用是首选。'
        }

        if (!documentAccess?.toolMode && documentAccess?.canRead && !documentAccess?.canEdit) {
          fullSystemPrompt += '\n\n你当前只被授权阅读用户文档，用于理解上下文。禁止输出任何文档编辑工具指令，也不要假设自己有写入权限。'
        }

        // 如果有文档结构，告知 AI 可以编辑文档
        if (!documentAccess?.toolMode && documentAccess?.canEdit && documentStructure && documentStructure.length > 0) {
          const blockList = documentStructure.map((b, i) => {
            const typeLabel = b.type === 'heading' ? `H${b.level || 1}` : b.type
            const textPreview = b.text.slice(0, 50) + (b.text.length > 50 ? '…' : '')
            return `${i + 1}. [${b.id}] ${typeLabel}: ${textPreview}`
          }).join('\n')

          fullSystemPrompt += `\n\n当前文档结构（共 ${documentStructure.length} 个块）：
${blockList}

你可以使用简化格式编辑文档，但必须严格遵守以下规则：

═══════════════════════════════════════
⚠️【关键规则：何时使用编辑工具】
═══════════════════════════════════════

【必须使用编辑工具的情况】（明确的文档编辑意图）：
- 用户说"在文档中添加/插入/写入..."
- 用户说"帮我修改/更新/改一下文档中的..."
- 用户说"删除文档中的..."
- 用户说"把这个内容写到文档里"
- 用户要求生成文档内容并写入
- 用户说"帮我写一个XXX并放到文档中"

【必须直接回复，禁止使用编辑工具的情况】（日常对话意图）：
- 打招呼、问候：如"你好"、"hi"、"hello"、"早上好"等
- 询问问题：如"这是什么"、"怎么理解"、"为什么"、"帮我解释"
- 一般性聊天、闲聊
- 请求解释、翻译、总结等不需要修改文档的操作
- 用户没有明确说要把内容写入/添加到文档中
- 任何与文档编辑无关的日常交流

【判断原则】：
1. 只有当用户的意图明确指向"修改/操作文档"时，才使用编辑工具
2. 如果不确定用户的意图，默认使用直接回复，不要编辑文档
3. 对于问候、提问、请求帮助等，一律直接回复
4. 宁可不编辑，也不要误编辑

═══════════════════════════════════════
当你决定要编辑文档时，使用以下格式：
═══════════════════════════════════════

输出工具指令时必须遵守：
- 起始行必须从 \`::insert\`、\`::update\` 或 \`::delete\` 开始，并且独占一行
- \`::\` 结束标记也必须独占一行
- 不要把解释性文字写进工具块中
- 如果要继续自然语言说明，请放在工具块之外

**插入内容**（在文档末尾追加）：
::insert after
要插入的内容
::

**插入内容**（在特定块后）：
::insert after 块ID
要插入的内容
::

**删除块**：
::delete 块ID

**更新块**：
::update 块ID
新的内容
::

支持完整 Markdown 语法：
- # 标题 → heading（支持 # 到 ######）
- **粗体**、*斜体*、\`行内代码\` → 富文本样式
- $a+b$ → 行内公式
- 独占一段的 $$a+b$$ → 居中的公式段落
- - 列表项 → bulletListItem
- 1. 编号 → numberedListItem
- GFM 表格 → table
- \`\`\`语言 代码 \`\`\` → codeBlock
- [链接](url) → 链接
- > 引用 → 引用块
- 普通文本 → paragraph

示例：在文档末尾插入一个二级标题和段落：
::insert after
## 新章节

这是新段落内容。
::`
        } else if (!documentAccess?.toolMode && documentAccess?.canEdit && systemPrompt && systemPrompt.includes('当前编辑器文档内容')) {
          // 兼容旧格式
          fullSystemPrompt += `\n\n你可以通过输出特殊代码块来编辑用户的文档。⚠️ 重要：只有当用户明确要求添加/修改/删除文档内容时才使用编辑功能，对于问候、提问、聊天等一律直接回复，不要编辑文档。

当用户明确要求你在文档中添加、修改内容时，输出如下格式的代码块（语言标识为 edit_document），内容为 JSON：
\`\`\`edit_document
{
  "operations": [
    {
      "type": "insert",
      "position": "after",
      "blocks": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "要插入的内容", "styles": {} }] }
      ]
    }
  ]
}
\`\`\`
支持的 block type：paragraph、heading（props.level: 1-3）、bulletListItem、numberedListItem、codeBlock（props.language）。
position 为 "after" 表示在文档末尾追加，"before" 表示在开头插入。
如果要在特定块后插入，可以在 referenceId 字段填写目标块的 id（从文档内容中获取）。
每次只输出一个 edit_document 代码块，不要输出多个。`
        }

        const result = streamText({
          model: provider.chat(modelConfig.modelName),
          tools: Object.keys(availableTools).length > 0 ? availableTools : undefined,
          system: fullSystemPrompt,
          messages: messages.map(message => ({
            role: message.role,
            content: message.content,
          })),
          stopWhen: stepCountIs(5),
        })

        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            write({ type: 'text-delta', delta: part.text })
            continue
          }

          if (part.type === 'tool-call') {
            write({
              type: 'tool-call',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
            })
            continue
          }

          if (part.type === 'tool-result') {
            write({
              type: 'tool-result',
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: part.input,
              output: part.output,
            })
            continue
          }
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
