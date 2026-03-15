'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button, Spinner, addToast, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@heroui/react'
import { getKnowledgeGraph, getGraphStats, saveKnowledgeGraph } from '@/lib/knowledgeGraph'
import type { KnowledgeGraphNode, KnowledgeGraphEdge, KnowledgeNodeType } from '@/lib/types'

const nodeColors: Record<KnowledgeNodeType, string> = {
  paper: '#3b82f6',
  concept: '#10b981',
  author: '#f59e0b',
  method: '#8b5cf6',
  dataset: '#ec4899',
  keyword: '#6b7280',
}

const nodeLabels: Record<KnowledgeNodeType, string> = {
  paper: '论文',
  concept: '概念',
  author: '作者',
  method: '方法',
  dataset: '数据集',
  keyword: '关键词',
}

/**
 * 智能布局算法：按节点类型分区排列
 * - 论文：中心位置
 * - 作者：右侧弧形区域
 * - 方法：左侧弧形区域
 * - 概念：上方弧形区域
 * - 关键词/数据集：下方弧形区域
 */
function calculateNodePositions(nodes: KnowledgeGraphNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const centerX = 600
  const centerY = 400

  // 按类型分组
  const nodesByType: Record<KnowledgeNodeType, KnowledgeGraphNode[]> = {
    paper: [],
    concept: [],
    author: [],
    method: [],
    dataset: [],
    keyword: [],
  }

  nodes.forEach(node => {
    nodesByType[node.type].push(node)
  })

  // 论文节点：中心位置，多个论文时水平排列
  const papers = nodesByType.paper
  papers.forEach((node, index) => {
    const offsetX = (index - (papers.length - 1) / 2) * 200
    positions.set(node.id, {
      x: centerX + offsetX,
      y: centerY,
    })
  })

  // 作者节点：右侧弧形分布 (角度范围: -60° 到 60°，即右侧扇形)
  const authors = nodesByType.author
  const authorRadius = 350
  authors.forEach((node, index) => {
    const angleRange = Math.PI / 3 // 60度范围
    const startAngle = -angleRange / 2 - Math.PI / 2 // 从 -30° 开始
    const angle = authors.length > 1
      ? startAngle + (index / (authors.length - 1)) * angleRange
      : -Math.PI / 2
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * authorRadius,
      y: centerY + Math.sin(angle) * authorRadius,
    })
  })

  // 方法节点：左侧弧形分布
  const methods = nodesByType.method
  const methodRadius = 350
  methods.forEach((node, index) => {
    const angleRange = Math.PI / 3
    const startAngle = Math.PI / 2 - angleRange / 2 // 从 60° 开始
    const angle = methods.length > 1
      ? startAngle + (index / (methods.length - 1)) * angleRange
      : Math.PI / 2
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * methodRadius,
      y: centerY + Math.sin(angle) * methodRadius,
    })
  })

  // 概念节点：上方弧形分布
  const concepts = nodesByType.concept
  const conceptRadius = 320
  concepts.forEach((node, index) => {
    const angleRange = Math.PI * 0.6 // 108度范围
    const startAngle = -Math.PI - angleRange / 2 // 从左侧开始
    const angle = concepts.length > 1
      ? startAngle + (index / (concepts.length - 1)) * angleRange
      : -Math.PI / 2 * 3 // 正上方
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * conceptRadius,
      y: centerY + Math.sin(angle) * conceptRadius,
    })
  })

  // 关键词节点：下方弧形分布
  const keywords = nodesByType.keyword
  const keywordRadius = 380
  keywords.forEach((node, index) => {
    const angleRange = Math.PI * 0.5
    const startAngle = -angleRange / 2
    const angle = keywords.length > 1
      ? startAngle + (index / (keywords.length - 1)) * angleRange
      : Math.PI / 2 // 正下方
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * keywordRadius,
      y: centerY + Math.sin(angle) * keywordRadius,
    })
  })

  // 数据集节点：右下角区域
  const datasets = nodesByType.dataset
  const datasetRadius = 300
  datasets.forEach((node, index) => {
    const angleRange = Math.PI / 4
    const startAngle = Math.PI / 6
    const angle = datasets.length > 1
      ? startAngle + (index / (datasets.length - 1)) * angleRange
      : Math.PI / 4
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * datasetRadius,
      y: centerY + Math.sin(angle) * datasetRadius,
    })
  })

  return positions
}

function KnowledgeGraphContent() {
  const router = useRouter()
  const { fitView } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ nodeCount: 0, edgeCount: 0, nodeTypes: {} as Record<string, number> })
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure()
  const [deleteTarget, setDeleteTarget] = useState<{ nodeId: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const requestDeletePaperNode = useCallback((nodeId: string, title: string) => {
    setDeleteTarget({ nodeId, title })
    onDeleteOpen()
  }, [onDeleteOpen])

  const deletePaperSubgraph = useCallback((paperNodeId: string) => {
    const graph = getKnowledgeGraph()
    if (!graph) return { removedNodes: 0, removedEdges: 0 }

    const beforeNodeCount = graph.nodes.length
    const beforeEdgeCount = graph.edges.length

    graph.nodes = graph.nodes.filter(node => node.id !== paperNodeId)
    graph.edges = graph.edges.filter(edge => edge.sourceId !== paperNodeId && edge.targetId !== paperNodeId)

    // 删除因本次删除导致的孤立非论文节点（概念/方法/作者等）
    const connectedNodeIds = new Set<string>()
    graph.edges.forEach(edge => {
      connectedNodeIds.add(edge.sourceId)
      connectedNodeIds.add(edge.targetId)
    })
    graph.nodes = graph.nodes.filter(node => node.type === 'paper' || connectedNodeIds.has(node.id))

    graph.updatedAt = new Date().toISOString()
    saveKnowledgeGraph(graph)

    return {
      removedNodes: beforeNodeCount - graph.nodes.length,
      removedEdges: beforeEdgeCount - graph.edges.length,
    }
  }, [])

  // 加载图谱数据
  const loadGraph = useCallback(() => {
    setLoading(true)
    try {
      const graph = getKnowledgeGraph()
      const graphStats = getGraphStats()
      setStats(graphStats)

      if (!graph || graph.nodes.length === 0) {
        setNodes([])
        setEdges([])
        setLoading(false)
    return
      }

      // 使用智能布局算法计算节点位置
      const nodePositions = calculateNodePositions(graph.nodes)

      // 转换节点为 ReactFlow 格式
      const flowNodes: Node[] = graph.nodes.map((node: KnowledgeGraphNode) => {
        const calculatedPosition = nodePositions.get(node.id) || { x: 600, y: 400 }
        
        // 根据节点类型设置不同的尺寸
        const nodeSizes: Record<KnowledgeNodeType, { width: number; height: number }> = {
          paper: { width: 180, height: 70 },
          author: { width: 120, height: 50 },
          concept: { width: 130, height: 55 },
          method: { width: 130, height: 55 },
          dataset: { width: 120, height: 50 },
          keyword: { width: 100, height: 45 },
        }
        const size = nodeSizes[node.type]
        const canDelete = node.type === 'paper'

        return {
          id: node.id,
          type: 'default',
          position: node.position || calculatedPosition,
          data: {
            label: (
              <div
                className={canDelete ? 'paper-node-label' : undefined}
                style={{ textAlign: 'center', padding: '4px 0', position: 'relative' }}
              >
                {canDelete && (
                  <button
                    type="button"
                    className="paper-node-close"
                    aria-label="删除该文档节点"
                    title="删除"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      requestDeletePaperNode(node.id, node.label)
                    }}
                  >
                    ×
                  </button>
                )}
                <div style={{ 
                  fontSize: node.type === 'paper' ? 12 : 11, 
                  fontWeight: 600,
                  maxWidth: size.width - 20,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {node.label}
                </div>
                <div style={{ 
                  fontSize: 9, 
                  color: 'rgba(255,255,255,0.8)', 
                  marginTop: 2 
                }}>
                  {nodeLabels[node.type]}
                </div>
              </div>
            ),
          },
          style: {
            background: nodeColors[node.type],
            color: 'white',
            border: `2px solid ${nodeColors[node.type]}`,
            boxShadow: `0 4px 12px ${nodeColors[node.type]}40`,
            borderRadius: node.type === 'paper' ? 12 : 8,
            padding: 10,
            fontSize: 12,
            width: size.width,
            height: size.height,
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        }
      })

      // 关系类型对应的颜色
      const edgeColors: Record<string, string> = {
        authored_by: '#f59e0b',       // 作者关系 - 橙色
        contains_concept: '#10b981',  // 概念关系 - 绿色
        applies_method: '#8b5cf6',    // 方法关系 - 紫色
        uses_dataset: '#ec4899',      // 数据集关系 - 粉色
        cites: '#3b82f6',             // 引用关系 - 蓝色
        related_to: '#6b7280',        // 相关关系 - 灰色
      }

      // 转换边为 ReactFlow 格式
      const flowEdges: Edge[] = graph.edges.map((edge: KnowledgeGraphEdge) => {
        const edgeColor = edgeColors[edge.type] || '#94a3b8'
        
        return {
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          label: edge.label,
          type: 'bezier',
          animated: edge.strength > 0.7,
          style: {
            stroke: edgeColor,
            strokeWidth: 1.5 + edge.strength * 1.5,
            opacity: 0.8,
          },
          labelStyle: {
            fontSize: 10,
            fill: edgeColor,
            fontWeight: 500,
          },
          labelBgStyle: {
            fill: 'var(--bg-primary)',
            fillOpacity: 0.9,
          },
          labelBgPadding: [4, 6] as [number, number],
          labelBgBorderRadius: 4,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor,
            width: 15,
            height: 15,
          },
        }
      })

      setNodes(flowNodes)
      setEdges(flowEdges)
    } catch (error) {
      console.error('Failed to load graph:', error)
      addToast({ title: '加载图谱失败', color: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [setNodes, setEdges, requestDeletePaperNode])

  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  // 节点点击事件
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    const graphNode = getKnowledgeGraph()?.nodes.find(n => n.id === node.id)
    if (graphNode?.type === 'paper' && graphNode.knowledgeItemId) {
      router.push(`/immersive/${graphNode.knowledgeItemId}`)
    }
  }, [router])

  // 重新布局：清除节点位置缓存，重新计算布局
  const handleRelayout = useCallback(() => {
    const graph = getKnowledgeGraph()
    if (!graph || graph.nodes.length === 0) return

    // 清除所有节点的 position 属性
    graph.nodes.forEach(node => {
      delete node.position
    })

    // 重新计算位置
    const nodePositions = calculateNodePositions(graph.nodes)

    // 更新节点位置
    setNodes(nodes => nodes.map(node => {
      const newPosition = nodePositions.get(node.id)
      return newPosition ? { ...node, position: newPosition } : node
    }))

    // 延迟调用 fitView 确保节点位置已更新
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 })
    }, 50)
  }, [setNodes, fitView])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <Spinner size="lg" />
      </div>
    )
  }

  if (nodes.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>知识图谱为空</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            开始阅读论文，系统会自动构建知识图谱
          </p>
        </div>
        <Button color="primary" onPress={() => router.push('/')}>
       返回首页
        </Button>
      </div>
    )
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <style>{`
        .paper-node-close {
          position: absolute;
          right: 6px;
          top: 6px;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.55);
          background: rgba(0, 0, 0, 0.25);
          color: rgba(255, 255, 255, 0.9);
          font-size: 14px;
          line-height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.15s ease, background 0.15s ease, transform 0.15s ease;
        }
        .paper-node-label:hover .paper-node-close {
          opacity: 1;
          pointer-events: auto;
        }
        .paper-node-close:hover {
          background: rgba(0, 0, 0, 0.35);
          transform: scale(1.04);
        }
      `}</style>

      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} size="md">
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              将删除文档节点 <span style={{ fontWeight: 600 }}>{deleteTarget?.title || ''}</span>，并移除与其相连的关系；同时会清理因此产生的孤立节点。
              <div style={{ marginTop: 8, color: 'var(--text-muted)' }}>该操作不可撤销。</div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteClose} isDisabled={deleting}>
              取消
            </Button>
            <Button
              color="danger"
              onPress={async () => {
                if (!deleteTarget) return
                setDeleting(true)
                try {
                  const result = deletePaperSubgraph(deleteTarget.nodeId)
                  addToast({ title: `已删除：${result.removedNodes} 节点 · ${result.removedEdges} 关系`, color: 'success' })
                  onDeleteClose()
                  setDeleteTarget(null)
                  loadGraph()
                } catch (error) {
                  console.error('Delete paper node error:', error)
                  addToast({ title: '删除失败', color: 'danger' })
                } finally {
                  setDeleting(false)
                }
              }}
              isLoading={deleting}
            >
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 头部工具栏 */}
    <div style={{
        position: 'absolute',
        top: 16,
        left: 16,
        right: 16,
        zIndex: 10,
        display: 'flex',
        justifyContent: 'space-between',
     alignItems: 'center',
      background: 'var(--bg-primary)',
        padding: '12px 16px',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0.1)',
      }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>知识图谱</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {stats.nodeCount} 个节点 · {stats.edgeCount} 个关系
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="flat" onPress={handleRelayout}>
            重新布局
          </Button>
          <Button size="sm" variant="flat" onPress={loadGraph}>
            刷新
          </Button>
          <Button size="sm" variant="flat" onPress={() => router.push('/')}>
            返回
          </Button>
        </div>
    </div>

      {/* 图例 */}
      <div style={{
     position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
        background: 'var(--bg-primary)',
      padding: 12,
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>图例</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(nodeLabels).map(([type, label]) => (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: nodeColors[type as KnowledgeNodeType],
              }} />
              <span style={{ fontSize: 11 }}>{label}</span>
            </div>
          ))}
        </div>
    </div>

      {/* React Flow 图谱 */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2, duration: 200 }}
        attributionPosition="bottom-right"
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            const graphNode = getKnowledgeGraph()?.nodes.find(n => n.id === node.id)
            return graphNode ? nodeColors[graphNode.type] : '#94a3b8'
          }}
          style={{
            background: 'var(--bg-secondary)',
          }}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  )
}

// 包装 ReactFlowProvider 以支持 useReactFlow hook
export default function KnowledgeGraphPage() {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphContent />
    </ReactFlowProvider>
  )
}
