import { NextRequest, NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import type {
  ModelConfig,
  TextBlock,
  AIGuideSummary,
  MindMapNode,
  BlockKeyPoints,
  AIGuideHighlight,
  AIGuideAction,
} from '@/lib/types'

export const maxDuration = 120

// 生成文章概要
async function generateGuideSummary(
  fullText: string,
  modelConfig: ModelConfig
): Promise<{ success: boolean; summary?: AIGuideSummary; error?: string }> {
  if (!fullText || fullText.trim().length < 100) {
    return { success: false, error: '内容太短，无法生成概要' }
  }

  const provider = createOpenAI({
    baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
    apiKey: modelConfig.apiKey,
  })

  const systemPrompt = `你是一个学术文献导读助手。请分析给定的文献内容，生成结构化的导读概要。

**重要：所有输出必须使用中文，只有引用原文时可以保留英文。解读、分析、概括等所有内容都必须用中文撰写。**

要求：
1. 以 JSON 格式返回，格式如下：
{
  "background": "研究背景（100-200字中文）",
  "methods": "核心方法（100-200字中文）",
  "conclusions": "主要结论（100-200字中文）",
  "keyPoints": ["关键要点1（中文）", "关键要点2（中文）", "关键要点3（中文）", "关键要点4（中文）", "关键要点5（中文）"]
}

2. background: 简述研究的背景和动机
3. methods: 概括研究的核心方法和技术路线
4. conclusions: 总结研究的主要发现和结论
5. keyPoints: 提取5个左右最重要的关键要点，每个要点简洁明了

只返回 JSON 对象，不要添加任何解释或 markdown 标记。`

  try {
    const { text } = await generateText({
      model: provider.chat(modelConfig.modelName),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请分析以下文献内容并生成导读概要：\n\n${fullText.slice(0, 12000)}` },
      ],
    })

    let jsonStr = text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    const summary = JSON.parse(jsonStr)
    return { success: true, summary }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '生成概要失败',
    }
  }
}

// 生成文章结构（思维导图）
async function generateGuideStructure(
  blocks: TextBlock[],
  modelConfig: ModelConfig
): Promise<{ success: boolean; structure?: MindMapNode[]; error?: string }> {
  if (!blocks || blocks.length === 0) {
    return { success: false, error: '没有可用的文本块' }
  }

  const provider = createOpenAI({
    baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
    apiKey: modelConfig.apiKey,
  })

  // 构建文本块摘要
  const blocksSummary = blocks
    .filter(b => b.type !== 'header' && b.type !== 'footer')
    .slice(0, 100)
    .map((b, i) => ({
      id: b.id,
      type: b.type,
      pageNum: b.pageNum,
      text: b.text.slice(0, 200),
    }))

  const systemPrompt = `你是一个学术文献结构分析助手。请分析给定的文本块，提取文章的层级结构，生成思维导图数据。

**重要：所有输出必须使用中文。**

要求：
1. 以 JSON 数组格式返回，每个元素代表一个顶层节点
2. 节点结构：
{
  "id": "唯一标识符",
  "type": "root|section|paragraph",
  "label": "节点标题（简短的中文标题）",
  "blockId": "关联的文本块ID（可选）",
  "pageNum": 页码,
  "children": [...] // 子节点数组
}

3. type 类型说明：
   - root: 文档根节点（标签为文档中文标题）
   - section: 章节/部分（如"摘要"、"引言"、"方法"、"结论"等）
   - paragraph: 具体段落

4. 结构要求：
   - 首先识别文档标题作为 root 节点
   - 然后识别各个章节标题作为 section 节点
   - 每个章节下的关键段落作为 paragraph 子节点

5. label 必须是简短的中文描述，例如：
   - root: "论文标题" 或实际标题
   - section: "研究背景"、"研究方法"、"实验结果"、"结论"等
   - paragraph: "问题定义"、"数据集介绍"、"性能对比"等

只返回 JSON 数组，不要添加任何解释或 markdown 标记。`

  try {
    const { text } = await generateText({
      model: provider.chat(modelConfig.modelName),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请分析以下文本块并生成文章结构：\n\n${JSON.stringify(blocksSummary, null, 2)}` },
      ],
    })

    let jsonStr = text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    const structure = JSON.parse(jsonStr)
    return { success: true, structure }
  } catch (error) {
    // 解析失败时返回简单结构
    const simpleStructure = buildSimpleStructure(blocks)
    return { success: true, structure: simpleStructure }
  }
}

// 构建简单结构（当AI解析失败时的降级方案）
function buildSimpleStructure(blocks: TextBlock[]): MindMapNode[] {
  const root: MindMapNode = {
    id: 'root',
    type: 'root',
    label: '文档结构',
    children: [],
  }

  const sections: Map<string, MindMapNode> = new Map()
  let currentSection: MindMapNode | null = null

  for (const block of blocks) {
    if (block.type === 'title' || block.type === 'subtitle') {
      const label = block.text.slice(0, 30)
      const section: MindMapNode = {
        id: block.id,
        type: 'section',
        label: label.length < block.text.length ? label + '...' : label,
        blockId: block.id,
        pageNum: block.pageNum,
        children: [],
      }
      sections.set(block.id, section)
      currentSection = section
    } else if (currentSection && block.type === 'paragraph') {
      const label = block.text.slice(0, 20)
      const paragraph: MindMapNode = {
        id: block.id,
        type: 'paragraph',
        label: label.length < block.text.length ? label + '...' : label,
        blockId: block.id,
        pageNum: block.pageNum,
      }
      currentSection.children = currentSection.children || []
      // 限制每个章节最多10个段落节点
      if (currentSection.children.length < 10) {
        currentSection.children.push(paragraph)
      }
    }
  }

  root.children = Array.from(sections.values()).slice(0, 8) // 限制最多8个章节
  return [root]
}

// 生成段落关键要点
async function generateBlockKeyPoints(
  blocks: TextBlock[],
  modelConfig: ModelConfig
): Promise<{ success: boolean; blockKeyPoints?: BlockKeyPoints[]; error?: string }> {
  if (!blocks || blocks.length === 0) {
    return { success: false, error: '没有可用的文本块' }
  }

  const provider = createOpenAI({
    baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
    apiKey: modelConfig.apiKey,
  })

  // 只处理段落类型的块
  const paragraphBlocks = blocks.filter(
    b => b.type === 'paragraph' && b.text.trim().length > 50
  )

  if (paragraphBlocks.length === 0) {
    return { success: true, blockKeyPoints: [] }
  }

  const systemPrompt = `你是一个学术文献分析助手。请为给定的段落提取3-5个关键要点。

**重要：所有要点必须使用中文撰写，只有引用原文关键术语时可以保留英文。**

要求：
1. 以 JSON 数组格式返回，每个元素格式：
{
  "blockId": "文本块ID",
  "keyPoints": ["要点1（中文）", "要点2（中文）", "要点3（中文）"]
}

2. 每个要点应该简洁明了，不超过30字
3. 要点应该概括段落的核心内容
4. 只返回 JSON 数组，不要添加任何解释或 markdown 标记`

  // 批量处理，每批10个块
  const batchSize = 10
  const allKeyPoints: BlockKeyPoints[] = []

  for (let i = 0; i < paragraphBlocks.length; i += batchSize) {
    const batch = paragraphBlocks.slice(i, i + batchSize)
    const batchData = batch.map(b => ({
      blockId: b.id,
      text: b.text.slice(0, 500),
      pageNum: b.pageNum,
    }))

    try {
      const { text } = await generateText({
        model: provider.chat(modelConfig.modelName),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请为以下段落提取关键要点：\n\n${JSON.stringify(batchData, null, 2)}` },
        ],
      })

      let jsonStr = text.trim()
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      const batchKeyPoints = JSON.parse(jsonStr)

      for (const item of batchKeyPoints) {
        const block = batch.find(b => b.id === item.blockId)
        if (block) {
          allKeyPoints.push({
            blockId: item.blockId,
            text: block.text.slice(0, 200),
            keyPoints: item.keyPoints || [],
            pageNum: block.pageNum,
          })
        }
      }
    } catch {
      // 批量失败时，为每个块生成简单要点
      for (const block of batch) {
        allKeyPoints.push({
          blockId: block.id,
          text: block.text.slice(0, 200),
          keyPoints: [block.text.slice(0, 50) + '...'],
          pageNum: block.pageNum,
        })
      }
    }
  }

  return { success: true, blockKeyPoints: allKeyPoints }
}

async function generateGuideHighlights(
  blocks: TextBlock[],
  modelConfig: ModelConfig
): Promise<{ success: boolean; highlights?: AIGuideHighlight[]; error?: string }> {
  if (!blocks || blocks.length === 0) {
    return { success: false, error: '没有可用的文本块' }
  }

  const provider = createOpenAI({
    baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
    apiKey: modelConfig.apiKey,
  })

  const candidateBlocks = blocks
    .filter(block => {
      if ((block.type === 'title' || block.type === 'subtitle') && block.text.trim().length > 6) {
        return true
      }
      return block.type === 'paragraph' && block.text.trim().length > 80
    })
    .slice(0, 80)
    .map(block => ({
      blockId: block.id,
      pageNum: block.pageNum,
      type: block.type,
      text: block.text.slice(0, 500),
    }))

  if (candidateBlocks.length === 0) {
    return { success: true, highlights: [] }
  }

  const systemPrompt = `你是一个学术文献精读助手。请从候选文本块中选出最值得精读的 4-6 个文章重点，并返回 JSON 数组：
[
  {
    "blockId": "对应文本块ID",
    "title": "重点标题（8-16字中文）",
    "note": "为什么这一段重要、读者应该关注什么（40-90字中文）",
    "quote": "摘录的关键短句（可选，最多40字，保留原文语言）"
  }
]

**重要：title 和 note 必须使用中文，只有 quote 字段可以保留英文原文。**

要求：
1. 重点必须覆盖论文的重要贡献、方法、结果或结论
2. 必须使用输入中的真实 blockId
3. 只返回 JSON 数组，不要添加解释或 markdown`

  try {
    const { text } = await generateText({
      model: provider.chat(modelConfig.modelName),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请从以下候选文本块中提取文章重点：\n\n${JSON.stringify(candidateBlocks, null, 2)}` },
      ],
    })

    let jsonStr = text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(jsonStr) as Array<{
      blockId?: string
      title?: string
      note?: string
      quote?: string
    }>

    const highlights = parsed
      .map((item, index) => {
        const matchedBlock = blocks.find(block => block.id === item.blockId)
        if (!matchedBlock || !item.blockId) {
          return null
        }

        return {
          id: `${item.blockId}-highlight-${index}`,
          blockId: item.blockId,
          pageNum: matchedBlock.pageNum,
          title: item.title?.trim() || `重点 ${index + 1}`,
          note: item.note?.trim() || matchedBlock.text.slice(0, 90),
          quote: item.quote?.trim() || matchedBlock.text.slice(0, 48),
        } satisfies AIGuideHighlight
      })
      .filter(Boolean) as AIGuideHighlight[]

    if (highlights.length > 0) {
      return { success: true, highlights }
    }
  } catch {
    // 继续使用降级方案
  }

  const fallbackHighlights = candidateBlocks
    .filter(block => block.type === 'paragraph')
    .slice(0, 5)
    .map((block, index) => ({
      id: `${block.blockId}-fallback-${index}`,
      blockId: block.blockId,
      pageNum: block.pageNum,
      title: `重点段落 ${index + 1}`,
      note: block.text.slice(0, 90),
      quote: block.text.slice(0, 48),
    }))

  return { success: true, highlights: fallbackHighlights }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, knowledgeItemId, blocks, fullText, modelConfig, action } = body as {
      documentId: string
      knowledgeItemId: string
      blocks: TextBlock[]
      fullText?: string
      modelConfig: ModelConfig
      action: AIGuideAction
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return NextResponse.json({ success: false, error: '模型配置不完整' }, { status: 400 })
    }

    const results: {
      summary?: AIGuideSummary
      structure?: MindMapNode[]
      blockKeyPoints?: BlockKeyPoints[]
      highlights?: AIGuideHighlight[]
    } = {}

    // 根据action执行对应操作
    if (action === 'summary' || action === 'all') {
      const text = fullText || blocks.map(b => b.text).join('\n\n')
      const summaryResult = await generateGuideSummary(text, modelConfig)
      if (summaryResult.success && summaryResult.summary) {
        results.summary = summaryResult.summary
      }
    }

    if (action === 'structure' || action === 'all') {
      const structureResult = await generateGuideStructure(blocks, modelConfig)
      if (structureResult.success && structureResult.structure) {
        results.structure = structureResult.structure
      }
    }

    if (action === 'keypoints' || action === 'all') {
      const keyPointsResult = await generateBlockKeyPoints(blocks, modelConfig)
      if (keyPointsResult.success && keyPointsResult.blockKeyPoints) {
        results.blockKeyPoints = keyPointsResult.blockKeyPoints
      }
    }

    if (action === 'highlights' || action === 'all') {
      const highlightsResult = await generateGuideHighlights(blocks, modelConfig)
      if (highlightsResult.success && highlightsResult.highlights) {
        results.highlights = highlightsResult.highlights
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
    })
  } catch (error) {
    console.error('AI Guide error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '处理失败' },
      { status: 500 }
    )
  }
}
