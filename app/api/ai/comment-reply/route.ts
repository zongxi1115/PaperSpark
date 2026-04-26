import { NextRequest, NextResponse } from 'next/server'
import { generateAIText } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export const maxDuration = 30

interface CommentReplyRequestBody {
  modelConfig: ModelConfig
  comment: {
    content: string
    selectedText?: string
    source?: 'user' | 'agent'
  }
  replies?: Array<{
    content: string
    source?: 'user' | 'agent'
    createdAt?: string
  }>
  documentContent?: string
}

interface CommentReplyResponseBody {
  success: boolean
  reply?: string
  error?: string
}

function buildRelevantContext(documentContent?: string, selectedText?: string): string {
  const normalizedDocument = (documentContent || '').trim()
  const normalizedQuote = (selectedText || '').trim()

  if (!normalizedDocument) return ''
  if (!normalizedQuote) return normalizedDocument.slice(0, 6000)

  const matchIndex = normalizedDocument.indexOf(normalizedQuote)
  if (matchIndex < 0) {
    return normalizedDocument.slice(0, 6000)
  }

  const windowSize = 1800
  const start = Math.max(0, matchIndex - windowSize)
  const end = Math.min(normalizedDocument.length, matchIndex + normalizedQuote.length + windowSize)
  return normalizedDocument.slice(start, end)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CommentReplyRequestBody
    const { modelConfig, comment, replies, documentContent } = body

    if (!comment?.content?.trim()) {
      return NextResponse.json<CommentReplyResponseBody>({ success: false, error: '评论内容为空' }, { status: 400 })
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return NextResponse.json<CommentReplyResponseBody>({ success: false, error: '请先在设置中配置可用的大模型' }, { status: 400 })
    }

    const relevantContext = buildRelevantContext(documentContent, comment.selectedText)
    const threadText = (replies || [])
      .slice(-6)
      .map((item, index) => `${index + 1}. ${item.source === 'agent' ? 'AI' : '用户'}：${item.content}`)
      .join('\n')

    const systemPrompt = `你是 PaperSpark 评论区里的学术写作助手。你的任务是针对一条论文评论，给出一段简短、自然、专业的 AI 回复。

请严格遵守：
1. 回复使用与评论相同的语言，默认中文。
2. 语气像论文写作搭子，专业但不生硬。
3. 优先结合用户选中的原文内容和文档上下文回答，不要空泛。
4. 如果评论是在指出问题，回复应给出判断、原因或修改建议。
5. 如果信息不足，要明确说明不确定点，不要编造。
6. 直接输出回复正文，不要加“AI 回复：”这类前缀。
7. 控制在 2 到 4 句内。`

    const prompt = `请为下面这条评论生成一条回复。

评论来源：${comment.source === 'agent' ? 'AI/智能体' : '用户'}
评论内容：
${comment.content.trim()}

${comment.selectedText?.trim() ? `评论关联原文：
「${comment.selectedText.trim()}」
` : ''}
${threadText ? `已有回复：
${threadText}
` : ''}
${relevantContext ? `文档相关上下文：
${relevantContext}
` : ''}
请输出一条可直接显示在评论下方的回复。`

    const result = await generateAIText(prompt, systemPrompt, modelConfig)
    if (!result.success || !result.text?.trim()) {
      return NextResponse.json<CommentReplyResponseBody>({ success: false, error: result.error || '生成回复失败' }, { status: 400 })
    }

    return NextResponse.json<CommentReplyResponseBody>({
      success: true,
      reply: result.text.trim(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '生成回复失败'
    return NextResponse.json<CommentReplyResponseBody>({ success: false, error: message }, { status: 500 })
  }
}
