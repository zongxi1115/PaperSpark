import { NextRequest, NextResponse } from 'next/server'
import type { AutoGraphAnalysis } from '@/lib/types'
import {
  getOrCreateKnowledgeGraph,
  addGraphNode,
  addGraphEdge,
  findNodeByLabel,
  findPaperNode,
  edgeExists,
  updateNodeWeight
} from '@/lib/knowledgeGraph'
import { updateKnowledgeItem } from '@/lib/storage'

export async function POST(request: NextRequest) {
  try {
    const body: {
      knowledgeItemId: string
      title: string
      authors: string[]
      analysis: AutoGraphAnalysis
    } = await request.json()

    const { knowledgeItemId, title, authors, analysis } = body

    let nodesCreated = 0
    let edgesCreated = 0

    // 确保知识图谱存在
    getOrCreateKnowledgeGraph()

    // 1. 创建或更新论文节点
    let paperNode = findPaperNode(knowledgeItemId)
    if (!paperNode) {
      paperNode = addGraphNode({
        type: 'paper',
        label: title,
        description: `论文: ${title}`,
        knowledgeItemId,
        properties: {
          authors,
          type: 'research_paper'
        },
        weight: 0.8
      })
      nodesCreated++
    } else {
      // 更新现有节点权重
      updateNodeWeight(paperNode.id, 0.1)
    }

    // 2. 创建作者节点和关系
    for (const author of authors) {
      let authorNode = findNodeByLabel(author, 'author')
      if (!authorNode) {
        authorNode = addGraphNode({
          type: 'author',
          label: author,
          description: `作者: ${author}`,
          properties: {
            name: author
          },
          weight: 0.3
        })
        nodesCreated++
      } else {
        updateNodeWeight(authorNode.id, 0.05)
      }

      // 创建作者关系
      if (!edgeExists(paperNode.id, authorNode.id, 'authored_by')) {
        addGraphEdge({
          sourceId: paperNode.id,
          targetId: authorNode.id,
          type: 'authored_by',
          label: '作者',
          strength: 0.9,
          properties: {}
        })
        edgesCreated++
      }
    }

    // 3. 创建概念节点和关系
    for (const concept of analysis.concepts) {
      if (concept.confidence < 0.7) continue

      let conceptNode = findNodeByLabel(concept.name, 'concept')
      if (!conceptNode) {
        conceptNode = addGraphNode({
          type: 'concept',
          label: concept.name,
          description: concept.description,
          properties: {
            confidence: concept.confidence
          },
          weight: Math.min(0.6, concept.confidence)
        })
        nodesCreated++
      } else {
        updateNodeWeight(conceptNode.id, 0.05)
      }

      // 创建概念关系
      if (!edgeExists(paperNode.id, conceptNode.id, 'contains_concept')) {
        addGraphEdge({
          sourceId: paperNode.id,
          targetId: conceptNode.id,
          type: 'contains_concept',
          label: '包含概念',
          strength: concept.confidence,
          properties: {
            confidence: concept.confidence
          }
        })
        edgesCreated++
      }
    }

    // 4. 创建方法节点和关系
    for (const method of analysis.methods) {
      if (method.confidence < 0.6) continue

      let methodNode = findNodeByLabel(method.name, 'method')
      if (!methodNode) {
        methodNode = addGraphNode({
          type: 'method',
          label: method.name,
          description: method.description,
          properties: {
            confidence: method.confidence
          },
          weight: Math.min(0.5, method.confidence)
        })
        nodesCreated++
      } else {
        updateNodeWeight(methodNode.id, 0.05)
      }

      // 创建方法关系
      if (!edgeExists(paperNode.id, methodNode.id, 'applies_method')) {
        addGraphEdge({
          sourceId: paperNode.id,
          targetId: methodNode.id,
          type: 'applies_method',
          label: '应用方法',
          strength: method.confidence,
          properties: {
            confidence: method.confidence
          }
        })
        edgesCreated++
      }
    }

    // 5. 创建关键词节点和关系
    for (const tag of analysis.suggestedTags) {
      let keywordNode = findNodeByLabel(tag, 'keyword')
      if (!keywordNode) {
        keywordNode = addGraphNode({
          type: 'keyword',
          label: tag,
          description: `关键词: ${tag}`,
          properties: {},
          weight: 0.2
        })
        nodesCreated++
      } else {
        updateNodeWeight(keywordNode.id, 0.02)
      }

      // 创建关键词关系
      if (!edgeExists(paperNode.id, keywordNode.id, 'contains_concept')) {
        addGraphEdge({
          sourceId: paperNode.id,
          targetId: keywordNode.id,
          type: 'contains_concept',
          label: '关键词',
          strength: 0.5,
          properties: {
            type: 'keyword'
          }
        })
        edgesCreated++
      }
    }

    // 6. 创建论文间的关联关系
    for (const relatedPaper of analysis.relatedPapers) {
      if (relatedPaper.confidence < 0.4) continue

      const relatedPaperNode = findPaperNode(relatedPaper.knowledgeItemId)
      if (relatedPaperNode && !edgeExists(paperNode.id, relatedPaperNode.id, relatedPaper.relationshipType)) {
        addGraphEdge({
          sourceId: paperNode.id,
          targetId: relatedPaperNode.id,
          type: relatedPaper.relationshipType,
          label: getRelationshipLabel(relatedPaper.relationshipType),
          strength: relatedPaper.confidence,
          properties: {
            reason: relatedPaper.reason,
            confidence: relatedPaper.confidence
          }
        })
        edgesCreated++
      }
    }

    // 7. 更新知识库条目，添加建议的标签
    const existingTags = new Set()
    updateKnowledgeItem(knowledgeItemId, (item) => {
      const currentTags = item.tags || []
      currentTags.forEach(tag => existingTags.add(tag))

      const newTags = analysis.suggestedTags.filter(tag => !existingTags.has(tag))
      return {
        ...item,
        tags: [...currentTags, ...newTags.slice(0, 5)] // 最多添加5个新标签
      }
    })

    return NextResponse.json({
      success: true,
      nodesCreated,
      edgesCreated,
      message: `成功创建 ${nodesCreated} 个节点和 ${edgesCreated} 个关系`
    })
  } catch (error) {
    console.error('Knowledge graph build error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Build failed',
        nodesCreated: 0,
        edgesCreated: 0
      },
      { status: 500 }
    )
  }
}

function getRelationshipLabel(type: string): string {
  const labels: Record<string, string> = {
    'cites': '引用',
    'extends': '扩展',
    'uses': '使用',
    'similar_to': '相似',
    'authored_by': '作者',
    'contains_concept': '包含概念',
    'applies_method': '应用方法'
  }
  return labels[type] || type
}