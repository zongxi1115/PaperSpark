'use client'

import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Node,
  Edge,
  MarkerType,
  NodeProps,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { MindMapNode, MindMapNodeType } from '@/lib/types'

// 自定义节点组件 - 纵向布局
function MindMapNodeComponent({ data }: NodeProps<{ label: string; type: MindMapNodeType; blockId?: string; pageNum?: number }>) {
  const nodeType = data.type
  const bgColors: Record<MindMapNodeType, string> = {
    root: 'bg-gradient-to-b from-blue-600 to-blue-700 border-blue-400',
    section: 'bg-gradient-to-b from-purple-600 to-purple-700 border-purple-400',
    paragraph: 'bg-gradient-to-b from-slate-700 to-slate-800 border-slate-500',
  }

  const textSizes: Record<MindMapNodeType, string> = {
    root: 'text-sm font-bold',
    section: 'text-xs font-medium',
    paragraph: 'text-[11px]',
  }

  const paddings: Record<MindMapNodeType, string> = {
    root: 'px-4 py-2',
    section: 'px-3 py-2',
    paragraph: 'px-2 py-1.5',
  }

  return (
    <div
      className={`${bgColors[nodeType]} ${textSizes[nodeType]} ${paddings[nodeType]} rounded-lg shadow-lg border cursor-pointer hover:shadow-xl hover:scale-105 transition-all`}
      style={{ minWidth: '60px', maxWidth: '180px' }}
    >
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-white/50 !border-0" />
      <div className="text-white text-center truncate" title={data.label}>
        {data.label}
      </div>
      {data.pageNum && (
        <div className="text-[9px] text-white/50 text-center mt-0.5">第{data.pageNum}页</div>
      )}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-white/50 !border-0" />
    </div>
  )
}

const nodeTypes = {
  mindMapNode: MindMapNodeComponent,
}

interface GuideMindMapProps {
  structure: MindMapNode[]
  onNodeClick?: (blockId: string | undefined, pageNum: number | undefined) => void
}

// 将树形结构转换为 React Flow 节点和边 - 纵向布局
function convertToFlowElements(
  nodes: MindMapNode[],
  onNodeClick?: (blockId: string | undefined, pageNum: number | undefined) => void
): { nodes: Node[]; edges: Edge[] } {
  const flowNodes: Node[] = []
  const flowEdges: Edge[] = []
  const levelGapY = 70 // 纵向间距

  function traverse(node: MindMapNode, parentId: string | null, level: number, xOffset: number): { width: number; centerX: number } {
    const nodeId = node.id
    const nodeWidth = 140 // 节点宽度

    // 先处理子节点，计算总宽度
    let totalChildWidth = 0
    const childResults: { width: number; centerX: number }[] = []

    if (node.children && node.children.length > 0) {
      let childX = xOffset
      for (const child of node.children) {
        const result = traverse(child, nodeId, level + 1, childX)
        childResults.push(result)
        totalChildWidth += result.width
        childX += result.width
      }
    }

    // 当前节点的居中位置
    const myX = childResults.length > 0
      ? xOffset + totalChildWidth / 2
      : xOffset + nodeWidth / 2
    const myY = level * levelGapY

    flowNodes.push({
      id: nodeId,
      type: 'mindMapNode',
      position: { x: myX - nodeWidth / 2, y: myY },
      data: {
        label: node.label,
        type: node.type,
        blockId: node.blockId,
        pageNum: node.pageNum,
      },
      draggable: false,
    })

    if (parentId) {
      flowEdges.push({
        id: `${parentId}-${nodeId}`,
        source: parentId,
        target: nodeId,
        type: 'smoothstep',
        animated: false,
        style: { stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(255,255,255,0.25)' },
      })
    }

    const totalWidth = Math.max(nodeWidth + 20, totalChildWidth)
    return { width: totalWidth, centerX: myX }
  }

  // 计算布局
  let currentX = 0
  for (const rootNode of nodes) {
    const result = traverse(rootNode, null, 0, currentX)
    currentX += result.width + 30
  }

  return { nodes: flowNodes, edges: flowEdges }
}

export default function GuideMindMap({ structure, onNodeClick }: GuideMindMapProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => convertToFlowElements(structure, onNodeClick),
    [structure, onNodeClick]
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (onNodeClick && node.data.blockId) {
        onNodeClick(node.data.blockId, node.data.pageNum)
      }
    },
    [onNodeClick]
  )

  if (!structure || structure.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-xs">
        <p>暂无结构数据</p>
      </div>
    )
  }

  return (
    <div className="h-64 w-full bg-[#1a1a1a] rounded-lg border border-[#333] overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(255,255,255,0.03)" gap={16} />
        <Controls
          className="!bg-[#252525] !border !border-[#333] !rounded-lg"
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  )
}
