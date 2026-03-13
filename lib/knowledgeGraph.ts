import type {
  KnowledgeGraph,
  KnowledgeGraphNode,
  KnowledgeGraphEdge,
  AutoGraphAnalysis,
  KnowledgeNodeType,
  KnowledgeRelationType
} from './types'

const STORAGE_KEY = 'knowledge_graph'

// 获取知识图谱
export function getKnowledgeGraph(): KnowledgeGraph | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch (error) {
    console.error('Failed to load knowledge graph:', error)
    return null
  }
}

// 保存知识图谱
export function saveKnowledgeGraph(graph: KnowledgeGraph): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(graph))
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

  return graph.nodes.find(node =>
    node.label.toLowerCase() === label.toLowerCase() &&
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