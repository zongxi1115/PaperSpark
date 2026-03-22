import type {
  KnowledgeGraph,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  AutoGraphAnalysis,
  KnowledgeNodeType,
  KnowledgeRelationType
} from './types'
import { getJSON, setJSON } from './storage/StorageUtils'

const STORAGE_KEY = 'knowledge_graph'

function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim()
}

// 获取知识图谱
export function getKnowledgeGraph(): KnowledgeGraph | null {
  if (typeof window === 'undefined') return null

  try {
    return getJSON<KnowledgeGraph | null>(STORAGE_KEY, null)
  } catch (error) {
    console.error('Failed to load knowledge graph:', error)
    return null
  }
}

// 保存知识图谱
export function saveKnowledgeGraph(graph: KnowledgeGraph): void {
  if (typeof window === 'undefined') return

  try {
    setJSON(STORAGE_KEY, graph)
  } catch (error) {
    console.error('Failed to save knowledge graph:', error)
  }
}

// 初始化空的知识图谱
export function initializeKnowledgeGraph(): KnowledgeGraph {
  const graph: KnowledgeGraph = {
    id: 'main-graph',
    name: '知识图谱',
    description: '论文知识图谱',
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  saveKnowledgeGraph(graph)
  return graph
}

// 获取或创建知识图谱
export function getOrCreateKnowledgeGraph(): KnowledgeGraph {
  const existing = getKnowledgeGraph()
  return existing || initializeKnowledgeGraph()
}

// 添加节点
export function addGraphNode(node: Omit<KnowledgeGraphNode, 'id' | 'createdAt' | 'updatedAt'>): KnowledgeGraphNode {
  const graph = getOrCreateKnowledgeGraph()

  const newNode: KnowledgeGraphNode = {
    ...node,
    id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  graph.nodes.push(newNode)
  graph.updatedAt = new Date().toISOString()
  saveKnowledgeGraph(graph)

  return newNode
}

// 添加边
export function addGraphEdge(edge: Omit<KnowledgeGraphEdge, 'id' | 'createdAt' | 'updatedAt'>): KnowledgeGraphEdge {
  const graph = getOrCreateKnowledgeGraph()

  const newEdge: KnowledgeGraphEdge = {
    ...edge,
    id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  graph.edges.push(newEdge)
  graph.updatedAt = new Date().toISOString()
  saveKnowledgeGraph(graph)

  return newEdge
}

// 查找节点
export function findNodeByLabel(label: string, type?: KnowledgeNodeType): KnowledgeGraphNode | null {
  const graph = getKnowledgeGraph()
  if (!graph) return null

  const normalizedTarget = normalizeLabel(label)

  return graph.nodes.find(node =>
    normalizeLabel(node.label) === normalizedTarget &&
    (!type || node.type === type)
  ) || null
}

// 查找论文节点
export function findPaperNode(knowledgeItemId: string): KnowledgeGraphNode | null {
  const graph = getKnowledgeGraph()
  if (!graph) return null

  return graph.nodes.find(node =>
    node.type === 'paper' &&
    node.knowledgeItemId === knowledgeItemId
  ) || null
}

// 查找相关节点
export function findRelatedNodes(nodeId: string): Array<{ node: KnowledgeGraphNode; edge: KnowledgeGraphEdge }> {
  const graph = getKnowledgeGraph()
  if (!graph) return []

  const relatedEdges = graph.edges.filter(edge =>
    edge.sourceId === nodeId || edge.targetId === nodeId
  )

  return relatedEdges.map(edge => {
    const relatedNodeId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId
    const relatedNode = graph.nodes.find(node => node.id === relatedNodeId)
    return { node: relatedNode!, edge }
  }).filter(item => item.node)
}

// 检查边是否存在
export function edgeExists(sourceId: string, targetId: string, type?: KnowledgeRelationType): boolean {
  const graph = getKnowledgeGraph()
  if (!graph) return false

  return graph.edges.some(edge =>
    edge.sourceId === sourceId &&
    edge.targetId === targetId &&
    (!type || edge.type === type)
  )
}

// 更新节点权重
export function updateNodeWeight(nodeId: string, weightDelta: number = 0.1): void {
  const graph = getKnowledgeGraph()
  if (!graph) return

  const node = graph.nodes.find(n => n.id === nodeId)
  if (node) {
    node.weight = Math.min(1, node.weight + weightDelta)
    node.updatedAt = new Date().toISOString()
    graph.updatedAt = new Date().toISOString()
    saveKnowledgeGraph(graph)
  }
}

// 获取图谱统计信息
export function getGraphStats(): { nodeCount: number; edgeCount: number; nodeTypes: Record<string, number> } {
  const graph = getKnowledgeGraph()
  if (!graph) return { nodeCount: 0, edgeCount: 0, nodeTypes: {} }

  const nodeTypes: Record<string, number> = {}
  graph.nodes.forEach(node => {
    nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1
  })

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodeTypes
  }
}

// 清理孤立节点（没有任何连接的节点）
export function cleanupOrphanNodes(): number {
  const graph = getKnowledgeGraph()
  if (!graph) return 0

  const connectedNodeIds = new Set<string>()
  graph.edges.forEach(edge => {
    connectedNodeIds.add(edge.sourceId)
    connectedNodeIds.add(edge.targetId)
  })

  const orphanNodes = graph.nodes.filter(node =>
    node.type !== 'paper' && !connectedNodeIds.has(node.id)
  )

  if (orphanNodes.length > 0) {
    graph.nodes = graph.nodes.filter(node =>
      node.type === 'paper' || connectedNodeIds.has(node.id)
    )
    graph.updatedAt = new Date().toISOString()
    saveKnowledgeGraph(graph)
  }

  return orphanNodes.length
}

type BuildGraphInput = {
  knowledgeItemId: string
  title: string
  authors: string[]
  analysis: AutoGraphAnalysis
}

export function buildKnowledgeGraphFromAnalysis(input: BuildGraphInput): {
  nodesCreated: number
  edgesCreated: number
} {
  const graph = getOrCreateKnowledgeGraph()
  const now = new Date().toISOString()
  let nodesCreated = 0
  let edgesCreated = 0

  const findNodeInGraph = (label: string, type?: KnowledgeNodeType): KnowledgeGraphNode | null => {
    const normalized = normalizeLabel(label)
    return graph.nodes.find(node => normalizeLabel(node.label) === normalized && (!type || node.type === type)) || null
  }

  const upsertNode = (
    label: string,
    type: KnowledgeNodeType,
    create: Omit<KnowledgeGraphNode, 'id' | 'createdAt' | 'updatedAt'>,
    weightDelta: number,
  ): KnowledgeGraphNode => {
    const existing =
      type === 'paper'
        ? graph.nodes.find(node => node.type === 'paper' && node.knowledgeItemId === input.knowledgeItemId) || null
        : findNodeInGraph(label, type)

    if (existing) {
      existing.weight = Math.min(1, existing.weight + weightDelta)
      existing.updatedAt = now
      return existing
    }

    const newNode: KnowledgeGraphNode = {
      ...create,
      id: `node_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      createdAt: now,
      updatedAt: now,
    }
    graph.nodes.push(newNode)
    nodesCreated++
    return newNode
  }

  const addEdgeIfNotExists = (
    sourceId: string,
    targetId: string,
    type: KnowledgeRelationType,
    label: string,
    strength: number,
    properties: Record<string, unknown> = {},
  ) => {
    const exists = graph.edges.some(edge => edge.sourceId === sourceId && edge.targetId === targetId && edge.type === type)
    if (exists) return

    const edge: KnowledgeGraphEdge = {
      id: `edge_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      sourceId,
      targetId,
      type,
      label,
      strength,
      properties,
      createdAt: now,
      updatedAt: now,
    }
    graph.edges.push(edge)
    edgesCreated++
  }

  const paperNode = upsertNode(
    input.title,
    'paper',
    {
      type: 'paper',
      label: input.title,
      description: `论文: ${input.title}`,
      knowledgeItemId: input.knowledgeItemId,
      properties: {
        authors: input.authors,
        type: 'research_paper',
      },
      weight: 0.8,
    },
    0.1,
  )

  for (const author of input.authors) {
    const authorNode = upsertNode(
      author,
      'author',
      {
        type: 'author',
        label: author,
        description: `作者: ${author}`,
        properties: { name: author },
        weight: 0.3,
      },
      0.05,
    )

    addEdgeIfNotExists(paperNode.id, authorNode.id, 'authored_by', '作者', 0.9)
  }

  for (const concept of input.analysis.concepts) {
    if (concept.confidence < 0.7) continue

    const conceptNode = upsertNode(
      concept.name,
      'concept',
      {
        type: 'concept',
        label: concept.name,
        description: concept.description,
        properties: { confidence: concept.confidence },
        weight: Math.min(0.6, concept.confidence),
      },
      0.05,
    )

    addEdgeIfNotExists(paperNode.id, conceptNode.id, 'contains_concept', '包含概念', concept.confidence, {
      confidence: concept.confidence,
    })
  }

  for (const method of input.analysis.methods) {
    if (method.confidence < 0.6) continue

    const methodNode = upsertNode(
      method.name,
      'method',
      {
        type: 'method',
        label: method.name,
        description: method.description,
        properties: { confidence: method.confidence },
        weight: Math.min(0.5, method.confidence),
      },
      0.05,
    )

    addEdgeIfNotExists(paperNode.id, methodNode.id, 'applies_method', '应用方法', method.confidence, {
      confidence: method.confidence,
    })
  }

  for (const tag of input.analysis.suggestedTags) {
    const keywordNode = upsertNode(
      tag,
      'keyword',
      {
        type: 'keyword',
        label: tag,
        description: `关键词: ${tag}`,
        properties: {},
        weight: 0.2,
      },
      0.02,
    )

    addEdgeIfNotExists(paperNode.id, keywordNode.id, 'contains_concept', '关键词', 0.5, { type: 'keyword' })
  }

  for (const relatedPaper of input.analysis.relatedPapers) {
    if (relatedPaper.confidence < 0.4) continue
    const relatedPaperNode = graph.nodes.find(
      node => node.type === 'paper' && node.knowledgeItemId === relatedPaper.knowledgeItemId,
    )
    if (!relatedPaperNode) continue

    addEdgeIfNotExists(
      paperNode.id,
      relatedPaperNode.id,
      relatedPaper.relationshipType,
      relatedPaper.relationshipType,
      relatedPaper.confidence,
      {
        reason: relatedPaper.reason,
        confidence: relatedPaper.confidence,
      },
    )
  }

  graph.updatedAt = now
  saveKnowledgeGraph(graph)

  return {
    nodesCreated,
    edgesCreated,
  }
}