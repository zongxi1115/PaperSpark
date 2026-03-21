import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import type { ModelConfig } from '@/lib/types'

export const maxDuration = 45

type CanvasBlock = {
  id: string
  pageNum: number
  type: string
  text: string
}

function pickRepresentativeText(fullText: string, blocks: CanvasBlock[]) {
  const plain = (fullText || '').replace(/\s+/g, ' ').trim()
  if (plain.length > 10000) {
    return plain.slice(0, 10000)
  }

  if (plain.length > 0) {
    return plain
  }

  return blocks
    .slice(0, 120)
    .map(block => `P${block.pageNum} ${block.type}: ${block.text}`)
    .join('\n')
    .slice(0, 10000)
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      title?: string
      fullText?: string
      blocks?: CanvasBlock[]
      userPrompt?: string
      modelConfig?: ModelConfig
    }

    const { title = 'Untitled Paper', fullText = '', blocks = [], userPrompt = '', modelConfig } = body

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return Response.json({ error: '模型未配置' }, { status: 400 })
    }

    const articleText = pickRepresentativeText(fullText, blocks)
    if (!articleText.trim()) {
      return Response.json({ error: '文档内容为空，无法生成网页' }, { status: 400 })
    }

    const systemPrompt = `你是一个资深前端创意工程师。你的唯一任务是输出一个“完整 HTML 网页”，用于可视化一篇论文的完整流程。

硬性要求：
1. 只输出 HTML 源码，不要任何解释文字，不要 markdown 代码块。
2. HTML 必须是完整文档结构：<!doctype html><html>...。
3. 不能依赖任何外部 JS/CSS/CDN/字体，全部内联。
4. 页面必须包含：
- 论文主流程（从背景、目标、方法、实验、结果、结论）
- 至少 6 个可交互节点（点击后右侧或下方展示详细信息）
- 明确的视觉连接关系（流程线/箭头/路径）
- 动画（加载渐入、节点 hover/active 动画）
- 响应式布局（桌面和移动端都可用）
5. 风格要求：科技感、灵动、可视化叙事，不要模板化后台风。
6. 数据必须来自给定论文内容，不能胡编不存在的结论。
7. 避免脚本报错，确保直接通过 iframe srcDoc 可运行。

输出规范：
- 仅返回 HTML 字符串。
- 不要包含 markdown 代码块标记。`

    const prompt = `请根据下面的论文内容和要求，生成一个“可交互可视化网页”。

论文标题：${title}

用户补充要求：
${userPrompt || '请突出流程、逻辑关系和关键结论。'}

论文内容：
${articleText}`

    const provider = createOpenAI({
      baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
      apiKey: modelConfig.apiKey,
    })

    const result = streamText({
      model: provider.chat(modelConfig.modelName),
      system: systemPrompt,
      prompt,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const write = (part: object) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(part)}\n`))
        }

        try {
          for await (const delta of result.textStream) {
            write({ type: 'text-delta', delta })
          }
          write({ type: 'done' })
          controller.close()
        } catch (error) {
          const message = error instanceof Error ? error.message : '流式生成失败'
          write({ type: 'error', error: message })
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败'
    return Response.json({ error: message }, { status: 500 })
  }
}
