import { NextRequest, NextResponse } from 'next/server'
import type { GraphBuildRequest, GraphBuildResponse, AutoGraphAnalysis, ModelConfig } from '@/lib/types'
import { getKnowledgeItems } from '@/lib/storage'

export async function POST(request: NextRequest) {
  try {
    const body: GraphBuildRequest = await request.json()
    const { knowledgeItemId, title, abstract, authors, keywords, fullText, modelConfig } = body

    // 构建分析提示词
    const analysisPrompt = `你是一个学术论文知识图谱分析专家。请分析以下论文，提取关键信息。

论文信息：
标题：${title}
作者：${authors.join(', ')}
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
    const response = await fetch(`${modelConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelConfig.apiKey}`,
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
    })

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`)
    }

    const aiResponse = await response.json()
    const content = aiResponse.choices?.[0]?.message?.content

    if (!content) {
      throw new Error('No content in AI response')
    }

    // 解析AI返回的JSON
    let analysis: AutoGraphAnalysis
    try {
      // 尝试提取JSON（可能包含在markdown代码块中）
    let jsonContent = content.trim()

      // 移除可能的markdown代码块标记
      if (jsonContent.startsWith('```json')) {
        jsonContent = jsonContent.replace(/^```json\s*/, '').replace(/```\s*$/, '')
      } else if (jsonContent.startsWith('```')) {
        jsonContent = jsonContent.replace(/^```\s*/, '').replace(/```\s*$/, '')
      }

      // 尝试修复常见的JSON问题
      jsonContent = jsonContent.trim()

      // 如果JSON不完整，尝试补全
      if (!jsonContent.endsWith('}')) {
    // 计算需要补全的括号
        const openBraces = (jsonContent.match(/{/g) || []).length
        const closeBraces = (jsonContent.match(/}/g) || []).length
        const openBrackets = (jsonContent.match(/\[/g) || []).length
        const closeBrackets = (jsonContent.match(/]/g) || []).length

        // 补全缺失的括号
        for (let i = 0; i < openBrackets - closeBrackets; i++) {
          jsonContent += ']'
        }
        for (let i = 0; i < openBraces - closeBraces; i++) {
          jsonContent += '}'
        }
      }

      analysis = JSON.parse(jsonContent)

      // 验证必需字段
      if (!analysis.concepts) analysis.concepts = []
      if (!analysis.methods) analysis.methods = []
      if (!analysis.suggestedTags) analysis.suggestedTags = []
      if (!analysis.relatedPapers) analysis.relatedPapers = []

    } catch (error) {
      console.error('Failed to parse AI response:', content)
      console.error('Parse error:', error)

      // 返回默认结构而不是抛出错误
      analysis = {
        concepts: [],
        methods: [],
        suggestedTags: [],
        relatedPapers: []
      }
    }

    // 分析与现有论文的关联
    const existingItems = getKnowledgeItems().filter(item => item.id !== knowledgeItemId)
    const relatedPapers = []

    for (const item of existingItems) {
      let relationshipScore = 0
      let relationshipType: 'similar_to' | 'cites' | 'extends' = 'similar_to'
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

    return NextResponse.json(result)
  } catch (error) {
    console.error('Knowledge graph analysis error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Analysis failed',
        nodesCreated: 0,
        edgesCreated: 0,
      } as GraphBuildResponse,
      { status: 500 }
    )
  }
}