'use client'

import { useEffect, useState, useCallback } from 'react'
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
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button, Spinner, addToast } from '@heroui/react'
import { getKnowledgeGraph, getGraphStats } from '@/lib/knowledgeGraph'
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

export default function KnowledgeGraphPage() {
  const router = useRouter()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ nodeCount: 0, edgeCount: 0, nodeTypes: {} as Record<string, number> })

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

      // 转换节点为 ReactFlow 格式
      const flowNodes: Node[] = graph.nodes.map((node: KnowledgeGraphNode, index: number) => {
        const angle = (index / graph.nodes.length) * 2 * Math.PI
        const radius = 300 + node.weight * 200

        return {
          id: node.id,
          type: 'default',
          position: node.position || {
          x: 400 + Math.cos(angle) * radius,
            y: 300 + Math.sin(angle) * radius,
          },
          data: {
            label: (
              <div style={{ textAlign: 'center' }}>
           <div style={{ fontSize: 11, fontWeight: 600 }}>{node.label}</div>
       <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                  {nodeLabels[node.type]}
                </div>
          </div>
            ),
          },
        style: {
            background: nodeColors[node.type],
          color: 'white',
            border: '2px solid white',
            borderRadius: 8,
            padding: 10,
            fontSize: 12,
            width: 120 + node.weight * 80,
            height: 60 + node.weight * 40,
          },
       sourcePosition: Position.Right,
        targetPosition: Position.Left,
        }
      })

      // 转换边为 ReactFlow 格式
      const flowEdges: Edge[] = graph.edges.map((edge: KnowledgeGraphEdge) => ({
        id: edge.id,
      source: edge.sourceId,
        target: edge.targetId,
        label: edge.label,
        type: 'smoothstep',
        animated: edge.strength > 0.7,
        style: {
          stroke: '#94a3b8',
          strokeWidth: 1 + edge.strength * 2,
        },
        labelStyle: {
        fontSize: 10,
          fill: '#64748b',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#94a3b8',
        },
      }))

      setNodes(flowNodes)
      setEdges(flowEdges)
    } catch (error) {
      console.error('Failed to load graph:', error)
      addToast({ title: '加载图谱失败', color: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [setNodes, setEdges])

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
        attributionPosition="bottom-right"
      >
        <Background />
      <Controls />
        <MiniMap
          nodeColor={(node) => {
         const graphNode = getKnowledgeGraph()?.nodes.find(n => n.id === node.id)
            return graphNode ? nodeColors[graphNode.type] : '#94a3b8'
          }}
          style={{
         background: 'var(--bg-secondary)',
          }}
        />
      </ReactFlow>
    </div>
  )
}