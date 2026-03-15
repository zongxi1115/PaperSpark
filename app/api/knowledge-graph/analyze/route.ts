import { NextRequest, NextResponse } from 'next/server'
import type { GraphBuildRequest, GraphBuildResponse, AutoGraphAnalysis } from '@/lib/types'
import { getKnowledgeItems } from '@/lib/storage'

function buildChatCompletionsUrl(baseUrl: string) {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.endsWith('/chat/completions')) return trimmed
  if (trimmed.endsWith('/v1') || trimmed.endsWith('/api/v1')) return `${trimmed}/chat/completions`
  return `${trimmed}/v1/chat/completions`
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
}

function dedupe(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach(value => {
    const key = value.toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    result.push(value)
  })
  return result
}

const EN_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'from', 'at', 'as',
  'we', 'our', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'study', 'paper', 'approach', 'method', 'methods', 'results', 'analysis', 'based', 'using',
])

function extractEnglishTerms(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map(token => token.trim())
    .filter(token => token.length >= 4 && !EN_STOPWORDS.has(token))
}

function extractChineseTerms(text: string) {
  const matches = text.match(/[\u4e00-\u9fff]{2,8}/g) || []
  return matches.map(value => value.trim()).filter(Boolean)
}

function buildFallbackAnalysis(params: {
  title: string
  abstract: string
  keywords: string[]
}): AutoGraphAnalysis {
  const keywordTerms = dedupe(params.keywords).slice(0, 8)
  const sourceText = `${params.title}\n${params.abstract}`.slice(0, 4000)

  const chineseTerms = extractChineseTerms(sourceText)
  const englishTerms = extractEnglishTerms(sourceText)

  const freq = new Map<string, number>()
  const bump = (term: string, weight: number) => {
    const key = term.trim()
    if (!key) return
    freq.set(key, (freq.get(key) || 0) + weight)
  }

  keywordTerms.forEach(term => bump(term, 6))
  chineseTerms.forEach(term => bump(term, 2))
  englishTerms.forEach(term => bump(term, 1))

  const rankedTerms = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)

  const suggestedTags = dedupe([
    ...keywordTerms,
    ...rankedTerms.slice(0, 8),
  ]).slice(0, 8)

  const concepts = dedupe([
    ...keywordTerms,
    ...rankedTerms,
  ])
    .slice(0, 4)
    .map((name, index) => ({
      name,
      description: index === 0 ? '核心主题' : '关键概念',
      confidence: 0.72,
    }))

  const methodHints = [
    'transformer',
    'bert',
    'gpt',
    'llm',
    'cnn',
    'lstm',
    'svm',
    'bayesian',
    'monte carlo',
    'finite element',
    'reinforcement learning',
    'diffusion',
  ]

  const detectedMethods = methodHints
    .filter(hint => sourceText.toLowerCase().includes(hint))
    .slice(0, 3)
    .map(name => ({
      name,
      description: '关键方法',
      confidence: 0.62,
    }))

  return {
    concepts,
    methods: detectedMethods,
    suggestedTags: suggestedTags.slice(0, 6),
    relatedPapers: [],
  }
}

function extractModelContent(aiResponse: any): string {
  const choices = aiResponse?.choices
  if (!Array.isArray(choices) || choices.length === 0) return ''

  for (const choice of choices) {
    const message = choice?.message
    const content = message?.content
    if (typeof content === 'string' && content.trim()) {
      return content.trim()
    }

    // 兼容部分 OpenAI 兼容实现：工具调用或函数调用把 JSON 放在 arguments 里
    const toolArgs = message?.tool_calls?.[0]?.function?.arguments
    if (typeof toolArgs === 'string' && toolArgs.trim()) return toolArgs.trim()

    const fnArgs = message?.function_call?.arguments
    if (typeof fnArgs === 'string' && fnArgs.trim()) return fnArgs.trim()
  }

  return ''
}

function clampNumber(value: unknown, fallback: number) {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.min(1, num))
}

function normalizeAnalysis(value: any): AutoGraphAnalysis | null {
  if (!value || typeof value !== 'object') return null

  const concepts = Array.isArray(value.concepts) ? value.concepts : []
  const methods = Array.isArray(value.methods) ? value.methods : []
  const suggestedTags = Array.isArray(value.suggestedTags) ? value.suggestedTags : []
  const relatedPapers = Array.isArray(value.relatedPapers) ? value.relatedPapers : []

  return {
    concepts: concepts
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => ({
        name: normalizeString(item.name).slice(0, 80),
        description: normalizeString(item.description).slice(0, 40),
        confidence: clampNumber(item.confidence, 0.7),
      }))
      .filter(item => item.name),
    methods: methods
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => ({
        name: normalizeString(item.name).slice(0, 80),
        description: normalizeString(item.description).slice(0, 40),
        confidence: clampNumber(item.confidence, 0.6),
      }))
      .filter(item => item.name),
    suggestedTags: dedupe(
      suggestedTags
        .filter((tag: any) => typeof tag === 'string')
        .map(tag => tag.trim())
        .filter(Boolean)
        .map(tag => tag.slice(0, 30)),
    ).slice(0, 12),
    relatedPapers: relatedPapers
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => ({
        knowledgeItemId: normalizeString(item.knowledgeItemId),
        relationshipType: item.relationshipType,
        confidence: clampNumber(item.confidence, 0.5),
        reason: normalizeString(item.reason).slice(0, 120),
      }))
      .filter(item => item.knowledgeItemId),
  }
}

function extractJsonCandidate(text: string) {
  let jsonContent = text.trim()

  const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (codeBlockMatch?.[1]) {
    jsonContent = codeBlockMatch[1].trim()
  }

  const firstBrace = jsonContent.indexOf('{')
  const lastBrace = jsonContent.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonContent = jsonContent.slice(firstBrace, lastBrace + 1)
  }

  return jsonContent.trim()
}

function removeTrailingCommas(jsonContent: string) {
  return jsonContent.replace(/,\s*([}\]])/g, '$1')
}

function tryParseAnalysisFromText(text: string): AutoGraphAnalysis | null {
  let candidate = extractJsonCandidate(text)
  if (!candidate) return null

  candidate = removeTrailingCommas(candidate).trim()

  // 如果 JSON 不完整，尝试补全括号（只做轻量补全，避免越修越错）
  if (!candidate.endsWith('}')) {
    const openBraces = (candidate.match(/{/g) || []).length
    const closeBraces = (candidate.match(/}/g) || []).length
    const openBrackets = (candidate.match(/\[/g) || []).length
    const closeBrackets = (candidate.match(/]/g) || []).length

    for (let i = 0; i < Math.max(0, openBrackets - closeBrackets); i++) {
      candidate += ']'
    }
    for (let i = 0; i < Math.max(0, openBraces - closeBraces); i++) {
      candidate += '}'
    }
  }

  try {
    const parsed = JSON.parse(candidate)
    return normalizeAnalysis(parsed)
  } catch {
    return null
  }
}

function salvageTagsFromText(text: string) {
  const index = text.indexOf('suggestedTags')
  if (index < 0) return []

  const slice = text.slice(index, index + 800)
  const matches = slice.match(/"([^"\r\n]{2,30})"/g) || []
  return matches
    .map(raw => raw.replace(/^"/, '').replace(/"$/, '').trim())
    .filter(value => value && value !== 'suggestedTags')
}

function salvageListItemsFromSection(sectionText: string) {
  const items: Array<{ name: string; description: string; confidence: number }> = []
  const strongPattern = /"name"\s*:\s*"([^"\r\n]{1,80})"[\s\S]{0,240}?"description"\s*:\s*"([^"\r\n]{0,80})"[\s\S]{0,240}?"confidence"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g
  const weakPattern = /"name"\s*:\s*"([^"\r\n]{1,80})"[\s\S]{0,240}?"description"\s*:\s*"([^"\r\n]{0,80})"/g

  for (const match of sectionText.matchAll(strongPattern)) {
    items.push({
      name: match[1].trim(),
      description: (match[2] || '').trim(),
      confidence: clampNumber(match[3], 0.7),
    })
  }

  if (items.length === 0) {
    for (const match of sectionText.matchAll(weakPattern)) {
      items.push({
        name: match[1].trim(),
        description: (match[2] || '').trim(),
        confidence: 0.7,
      })
    }
  }

  const deduped = new Map<string, { name: string; description: string; confidence: number }>()
  items.forEach(item => {
    const key = item.name.toLowerCase()
    if (!key) return
    if (!deduped.has(key)) deduped.set(key, item)
  })

  return [...deduped.values()]
}

function salvageAnalysisFromInvalidText(text: string, fallback: AutoGraphAnalysis): AutoGraphAnalysis | null {
  const conceptsIdx = text.indexOf('"concepts"')
  const methodsIdx = text.indexOf('"methods"')
  const tagsIdx = text.indexOf('"suggestedTags"')

  const conceptsSection =
    conceptsIdx >= 0
      ? text.slice(conceptsIdx, Math.max(conceptsIdx, Math.min(...[methodsIdx, tagsIdx].filter(i => i >= 0).concat(text.length))))
      : ''

  const methodsSection =
    methodsIdx >= 0
      ? text.slice(methodsIdx, Math.max(methodsIdx, Math.min(...[tagsIdx].filter(i => i >= 0).concat(text.length))))
      : ''

  const concepts = salvageListItemsFromSection(conceptsSection).slice(0, 4)
  const methods = salvageListItemsFromSection(methodsSection).slice(0, 3)
  const suggestedTags = dedupe(salvageTagsFromText(text)).slice(0, 8)

  if (concepts.length === 0 && methods.length === 0 && suggestedTags.length === 0) return null

  return {
    concepts: concepts.length ? concepts : fallback.concepts,
    methods: methods.length ? methods : fallback.methods,
    suggestedTags: suggestedTags.length ? suggestedTags : fallback.suggestedTags,
    relatedPapers: [],
  }
}

export async function POST(request: NextRequest) {
  let fallbackTitle = ''
  let fallbackAbstract = ''
  let fallbackKeywords: string[] = []

  try {
    const body = await request.json().catch(() => ({})) as Partial<GraphBuildRequest>
    const knowledgeItemId = normalizeString(body.knowledgeItemId)
    const title = normalizeString(body.title)
    const abstract = normalizeString(body.abstract)
    const authors = normalizeStringArray(body.authors)
    const keywords = normalizeStringArray(body.keywords)
    const fullText = normalizeString(body.fullText)
    const modelConfig = body.modelConfig

    fallbackTitle = title
    fallbackAbstract = abstract
    fallbackKeywords = keywords
    const fallbackAnalysis = buildFallbackAnalysis({ title, abstract, keywords })

    if (!knowledgeItemId || !title) {
      return NextResponse.json({
        success: true,
        analysis: fallbackAnalysis,
        nodesCreated: 0,
        edgesCreated: 0,
      } as GraphBuildResponse)
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName || !modelConfig?.baseUrl) {
      return NextResponse.json({
        success: true,
        analysis: fallbackAnalysis,
        nodesCreated: 0,
        edgesCreated: 0,
        error: '模型配置不完整，已使用降级分析结果',
      } as GraphBuildResponse)
    }

    // 构建分析提示词
    const analysisPrompt = `你是一个学术论文知识图谱分析专家。请分析以下论文，提取关键信息。

论文信息：
标题：${title}
作者：${authors.join(', ') || '未知'}
摘要：${abstract}
关键词：${keywords?.join(', ') || '无'}
${fullText ? `\n全文片段：${fullText.slice(0, 1500)}...` : ''}

请按以下JSON格式返回分析结果（必须是完整有效的JSON）：
{
  "concepts": [
    {"name": "概念名称", "description": "简短描述", "confidence": 0.9}
  ],
  "methods": [
    {"name": "方法名称", "description": "简短描述", "confidence": 0.8}
  ],
  "suggestedTags": ["标签1", "标签2", "标签3"],
  "relatedPapers": []
}

要求：
1. 提取2-4个核心概念，置信度0.7以上，描述不超过20字
2. 提取1-3个关键方法，置信度0.6以上，描述不超过20字
3. 建议4-6个标签，涵盖领域、方法、应用等
4. relatedPapers保持空数组
5. 只返回有效的JSON，确保所有括号和引号闭合`

    // 调用AI模型
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)

    const chatUrl = buildChatCompletionsUrl(modelConfig.baseUrl)
    if (!chatUrl) {
      return NextResponse.json({
        success: true,
        analysis: fallbackAnalysis,
        nodesCreated: 0,
        edgesCreated: 0,
        error: '模型 baseUrl 无效，已使用降级分析结果',
      } as GraphBuildResponse)
    }

    const origin = request.headers.get('origin') || ''
    let response: Response
    try {
      response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${modelConfig.apiKey}`,
          ...(origin ? { 'HTTP-Referer': origin } : {}),
          'X-Title': 'PaperSpark',
        },
        body: JSON.stringify({
          model: modelConfig.modelName,
          messages: [
            {
              role: 'user',
              content: analysisPrompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      return NextResponse.json({
        success: true,
        analysis: fallbackAnalysis,
        nodesCreated: 0,
        edgesCreated: 0,
        error: error instanceof Error ? error.message : 'AI 请求失败，已使用降级分析结果',
      } as GraphBuildResponse)
    }

    clearTimeout(timeout)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      return NextResponse.json({
        success: true,
        analysis: fallbackAnalysis,
        nodesCreated: 0,
        edgesCreated: 0,
        error: payload?.error?.message
          ? `AI API error: ${payload.error.message}`
          : `AI API error: ${response.status}`,
      } as GraphBuildResponse)
    }

    const aiResponse = await response.json().catch(() => ({}))
    const content = extractModelContent(aiResponse)
    if (!content) {
      return NextResponse.json({
        success: true,
        analysis: fallbackAnalysis,
        nodesCreated: 0,
        edgesCreated: 0,
        error: 'AI 返回内容为空，已使用降级分析结果',
      } as GraphBuildResponse)
    }

    // 解析AI返回的JSON
    let analysis: AutoGraphAnalysis
    let analysisError: string | null = null
    try {
      const parsed = tryParseAnalysisFromText(content)
      if (!parsed) {
        throw new Error('Parse returned null')
      }
      analysis = parsed
    } catch (error) {
      const finishReason = aiResponse?.choices?.[0]?.finish_reason
      const reasonText = typeof finishReason === 'string' ? ` finish_reason=${finishReason}` : ''
      analysisError = `AI 返回 JSON 解析失败，已使用降级分析结果${reasonText}`

      const salvaged = salvageAnalysisFromInvalidText(content, fallbackAnalysis)
      analysis = salvaged || fallbackAnalysis

      const snippet = content.slice(0, 1400)
      console.error('Failed to parse AI response (snippet):', snippet)
      console.error('Parse error:', error)
    }

    // 分析与现有论文的关联
    const existingItems = getKnowledgeItems().filter(item => item.id !== knowledgeItemId)
    const relatedPapers = []

    for (const item of existingItems) {
      let relationshipScore = 0
      let relationshipType: AutoGraphAnalysis['relatedPapers'][number]['relationshipType'] = 'similar_to'
      let reason = ''

      // 基于作者的关联
      const commonAuthors = authors.filter(author =>
        item.authors.some(itemAuthor =>
          itemAuthor.toLowerCase().includes(author.toLowerCase()) ||
          author.toLowerCase().includes(itemAuthor.toLowerCase())
        )
      )
      if (commonAuthors.length > 0) {
        relationshipScore += 0.3 * commonAuthors.length
        reason += `共同作者: ${commonAuthors.join(', ')}; `
        relationshipType = 'authored_by'
      }

      // 基于关键词的关联
      if (keywords && item.tags) {
        const commonKeywords = keywords.filter(keyword =>
          item.tags!.some(tag =>
            tag.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(tag.toLowerCase())
          )
        )
        if (commonKeywords.length > 0) {
          relationshipScore += 0.2 * commonKeywords.length
          reason += `相关关键词: ${commonKeywords.join(', ')}; `
        }
      }

      // 基于标题相似性的简单检查
      const titleWords = title.toLowerCase().split(/\s+/)
      const itemTitleWords = item.title.toLowerCase().split(/\s+/)
      const commonTitleWords = titleWords.filter(word =>
        word.length > 3 && itemTitleWords.includes(word)
      )
      if (commonTitleWords.length > 0) {
        relationshipScore += 0.1 * commonTitleWords.length
        reason += `标题相关词: ${commonTitleWords.join(', ')}; `
      }

      // 如果关联度足够高，添加到关联列表
      if (relationshipScore > 0.4) {
        relatedPapers.push({
          knowledgeItemId: item.id,
          relationshipType,
          confidence: Math.min(relationshipScore, 1.0),
          reason: reason.trim()
        })
      }
    }

    // 按置信度排序，取前5个
    analysis.relatedPapers = relatedPapers
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)

    const result: GraphBuildResponse = {
      success: true,
      analysis,
      nodesCreated: 0, // 这里只是分析，实际创建在另一个API
      edgesCreated: 0,
    }

    if (analysisError) {
      result.error = analysisError
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Knowledge graph analysis error:', error)

    // 最终兜底：避免前端自动图谱构建整体失败
    const analysis = buildFallbackAnalysis({ title: fallbackTitle, abstract: fallbackAbstract, keywords: fallbackKeywords })
    return NextResponse.json({
      success: true,
      analysis,
      nodesCreated: 0,
      edgesCreated: 0,
      error: error instanceof Error ? error.message : 'Analysis failed',
    } as GraphBuildResponse)
  }
}
