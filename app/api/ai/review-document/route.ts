import { NextRequest, NextResponse } from 'next/server'
import { generateAIText } from '@/lib/ai'
import type { Agent, DocumentReviewIssue, ModelConfig } from '@/lib/types'

export const maxDuration = 60

interface ReviewRequestBody {
  content: string
  modelConfig: ModelConfig
  agent: Pick<Agent, 'id' | 'title' | 'prompt'>
  documentStructure: Array<{
    id: string
    type: string
    text: string
    level?: number
  }>
}

interface ReviewResponseBody {
  success: boolean
  issues?: DocumentReviewIssue[]
  error?: string
}

function safeParseIssues(raw: string): DocumentReviewIssue[] {
  let normalized = raw.trim()
  if (normalized.startsWith('```')) {
    normalized = normalized.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  const firstBracket = normalized.indexOf('[')
  const lastBracket = normalized.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    normalized = normalized.slice(firstBracket, lastBracket + 1)
  }

  const parsed = JSON.parse(normalized) as Array<Partial<DocumentReviewIssue>>
  if (!Array.isArray(parsed)) return []

  return parsed
    .map((item) => {
      const severity: DocumentReviewIssue['severity'] = item.severity === 'critical' || item.severity === 'warning'
        ? item.severity
        : 'info'

      return {
        blockId: typeof item.blockId === 'string' ? item.blockId.trim() : '',
        quote: typeof item.quote === 'string' ? item.quote.trim() : '',
        reason: typeof item.reason === 'string' ? item.reason.trim() : '',
        suggestion: typeof item.suggestion === 'string' ? item.suggestion.trim() : '',
        severity,
      }
    })
    .filter(item => item.blockId && item.reason)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ReviewRequestBody
    const { content, modelConfig, agent, documentStructure } = body

    if (!content?.trim()) {
      return NextResponse.json<ReviewResponseBody>({ success: false, error: '文稿内容为空，无法审阅' }, { status: 400 })
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return NextResponse.json<ReviewResponseBody>({ success: false, error: '请先配置可用的大模型' }, { status: 400 })
    }

    const blockIds = new Set(documentStructure.map(block => block.id))
    const structureText = documentStructure
      .map((block, index) => {
        const typeLabel = block.type === 'heading' ? `heading-${block.level || 1}` : block.type
        return `${index + 1}. [${block.id}] ${typeLabel}: ${block.text}`
      })
      .join('\n')

    const systemPrompt = `${agent.prompt || '你是一位严格的论文审稿人。'}

现在你要执行“文稿审稿结构化标注”任务，请严格遵守：
1. 只返回 JSON 数组，不要添加解释、标题或 markdown 代码块。
2. 每个元素必须是：
{
  "blockId": "文档中的块 ID",
  "quote": "问题片段原文",
  "reason": "为什么这里不合适",
  "suggestion": "建议如何修改",
  "severity": "critical | warning | info"
}
3. blockId 必须来自用户提供的块结构列表，不能编造。
4. 只保留最重要的问题，最多 12 条。
5. 优先关注：论证跳跃、概念不清、证据不足、表达不严谨、语气不学术、结构失衡、结论外推。
6. 如果文稿整体没有明显问题，返回空数组 []。`

    const prompt = `请审阅下面这篇文稿，并输出结构化问题列表。

文档块结构：
${structureText}

文稿正文（Markdown）：
${content.slice(0, 16000)}`

    const result = await generateAIText(prompt, systemPrompt, modelConfig)
    if (!result.success || !result.text) {
      return NextResponse.json<ReviewResponseBody>({ success: false, error: result.error || '审稿失败' }, { status: 400 })
    }

    const issues = safeParseIssues(result.text)
      .filter(issue => blockIds.has(issue.blockId))
      .filter((issue, index, list) => list.findIndex(item => item.blockId === issue.blockId && item.reason === issue.reason) === index)
      .slice(0, 12)

    return NextResponse.json<ReviewResponseBody>({ success: true, issues })
  } catch (error) {
    const message = error instanceof Error ? error.message : '审稿失败'
    return NextResponse.json<ReviewResponseBody>({ success: false, error: message }, { status: 500 })
  }
}
