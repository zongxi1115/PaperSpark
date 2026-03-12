'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, Skeleton, Chip, Progress } from '@heroui/react'
import { Icon } from '@iconify/react'
import GuideMindMap from './GuideMindMap'
import type { TextBlock, AIGuideSummary, MindMapNode, BlockKeyPoints, ModelConfig } from '@/lib/types'
import { getGuideByKnowledgeId, saveGuide } from '@/lib/pdfCache'

interface AIGuidePanelProps {
  documentId: string
  knowledgeItemId: string
  blocks: TextBlock[]
  fullText?: string
  modelConfig: ModelConfig | null
  onBlockClick?: (blockId: string, pageNum: number) => void
}

export default function AIGuidePanel({
  documentId,
  knowledgeItemId,
  blocks,
  fullText,
  modelConfig,
  onBlockClick,
}: AIGuidePanelProps) {
  const [loading, setLoading] = useState(false)
  const [loadingCache, setLoadingCache] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)

  const [summary, setSummary] = useState<AIGuideSummary | null>(null)
  const [structure, setStructure] = useState<MindMapNode[]>([])
  const [blockKeyPoints, setBlockKeyPoints] = useState<BlockKeyPoints[]>([])

  // 使用 ref 防止重复加载
  const loadedRef = useRef(false)

  // 加载缓存的导读数据
  const loadCachedGuide = useCallback(async () => {
    if (loadedRef.current || !knowledgeItemId) return
    loadedRef.current = true
    setLoadingCache(true)

    try {
      const cached = await getGuideByKnowledgeId(knowledgeItemId)
      if (cached) {
        if (cached.summary) setSummary(cached.summary)
        if (cached.structure) setStructure(cached.structure)
        if (cached.blockKeyPoints) setBlockKeyPoints(cached.blockKeyPoints)
      }
    } catch (error) {
      console.error('Load cached guide error:', error)
    } finally {
      setLoadingCache(false)
    }
  }, [knowledgeItemId])

  // 保存导读数据到缓存
  const saveGuideToCache = useCallback(async (
    newSummary?: AIGuideSummary | null,
    newStructure?: MindMapNode[],
    newBlockKeyPoints?: BlockKeyPoints[]
  ) => {
    if (!documentId || !knowledgeItemId) return

    const now = new Date().toISOString()
    await saveGuide({
      id: documentId,
      documentId,
      knowledgeItemId,
      summary: newSummary || summary,
      structure: newStructure || structure,
      blockKeyPoints: newBlockKeyPoints || blockKeyPoints,
      generatedAt: now,
      updatedAt: now,
    })
  }, [documentId, knowledgeItemId, summary, structure, blockKeyPoints])

  // 组件挂载时加载缓存
  useEffect(() => {
    loadCachedGuide()
  }, [loadCachedGuide])

  // 生成所有导读内容
  const generateAll = useCallback(async () => {
    if (!modelConfig || !blocks.length) return

    setLoading(true)
    setProgress(0)

    try {
      const response = await fetch('/api/ai/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          knowledgeItemId,
          blocks,
          fullText,
          modelConfig,
          action: 'all',
        }),
      })

      const result = await response.json()

      if (result.success) {
        const newSummary = result.summary || null
        const newStructure = result.structure || []
        const newBlockKeyPoints = result.blockKeyPoints || []

        if (newSummary) setSummary(newSummary)
        if (newStructure.length) setStructure(newStructure)
        if (newBlockKeyPoints.length) setBlockKeyPoints(newBlockKeyPoints)

        // 保存到缓存
        await saveGuideToCache(newSummary, newStructure, newBlockKeyPoints)

        setProgress(100)
      }
    } catch (error) {
      console.error('Generate guide error:', error)
    } finally {
      setLoading(false)
    }
  }, [documentId, knowledgeItemId, blocks, fullText, modelConfig, saveGuideToCache])

  // 单独生成概要
  const generateSummary = useCallback(async () => {
    if (!modelConfig) return
    setGenerating('summary')

    try {
      const text = fullText || blocks.map(b => b.text).join('\n\n')
      const response = await fetch('/api/ai/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          knowledgeItemId,
          blocks,
          fullText: text,
          modelConfig,
          action: 'summary',
        }),
      })

      const result = await response.json()
      if (result.success && result.summary) {
        setSummary(result.summary)
        await saveGuideToCache(result.summary, undefined, undefined)
      }
    } catch (error) {
      console.error('Generate summary error:', error)
    } finally {
      setGenerating(null)
    }
  }, [documentId, knowledgeItemId, blocks, fullText, modelConfig, saveGuideToCache])

  // 单独生成结构
  const generateStructure = useCallback(async () => {
    if (!modelConfig) return
    setGenerating('structure')

    try {
      const response = await fetch('/api/ai/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          knowledgeItemId,
          blocks,
          modelConfig,
          action: 'structure',
        }),
      })

      const result = await response.json()
      if (result.success && result.structure) {
        setStructure(result.structure)
        await saveGuideToCache(undefined, result.structure, undefined)
      }
    } catch (error) {
      console.error('Generate structure error:', error)
    } finally {
      setGenerating(null)
    }
  }, [documentId, knowledgeItemId, blocks, modelConfig, saveGuideToCache])

  // 单独生成关键要点
  const generateKeyPoints = useCallback(async () => {
    if (!modelConfig) return
    setGenerating('keypoints')

    try {
      const response = await fetch('/api/ai/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          knowledgeItemId,
          blocks,
          modelConfig,
          action: 'keypoints',
        }),
      })

      const result = await response.json()
      if (result.success && result.blockKeyPoints) {
        setBlockKeyPoints(result.blockKeyPoints)
        await saveGuideToCache(undefined, undefined, result.blockKeyPoints)
      }
    } catch (error) {
      console.error('Generate keypoints error:', error)
    } finally {
      setGenerating(null)
    }
  }, [documentId, knowledgeItemId, blocks, modelConfig, saveGuideToCache])

  // 处理节点点击
  const handleNodeClick = useCallback(
    (blockId: string | undefined, pageNum: number | undefined) => {
      if (blockId && pageNum && onBlockClick) {
        onBlockClick(blockId, pageNum)
      }
    },
    [onBlockClick]
  )

  const hasAnyContent = summary || structure.length > 0 || blockKeyPoints.length > 0

  // 加载缓存中
  if (loadingCache) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-[#333]">
          <h3 className="text-sm font-medium text-gray-300">AI 导读</h3>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-500">
            <Icon icon="mdi:loading" className="animate-spin" />
            <span className="text-xs">加载中...</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between p-3 border-b border-[#333]">
        <h3 className="text-sm font-medium text-gray-300">AI 导读</h3>
        <div className="flex gap-1">
          {!hasAnyContent && (
            <Button
              size="sm"
              color="primary"
              variant="flat"
              isLoading={loading}
              onPress={generateAll}
              isDisabled={!modelConfig || blocks.length === 0}
            >
              生成导读
            </Button>
          )}
          {hasAnyContent && (
            <Button
              size="sm"
              variant="light"
              className="text-gray-400"
              onPress={generateAll}
              isDisabled={loading || !modelConfig}
            >
              <Icon icon="mdi:refresh" className="text-sm" />
            </Button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {loading && (
        <div className="px-3 py-2">
          <Progress value={progress} size="sm" color="primary" />
        </div>
      )}

      {/* 内容区域 */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* 概要部分 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">文章概要</span>
            {!summary && (
              <Button
                size="sm"
                variant="light"
                className="text-xs text-gray-500 h-6 min-w-0 px-2"
                isLoading={generating === 'summary'}
                onPress={generateSummary}
                isDisabled={!modelConfig}
              >
                生成
              </Button>
            )}
          </div>

          {loading && !summary ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full rounded bg-[#333]" />
              <Skeleton className="h-4 w-3/4 rounded bg-[#333]" />
            </div>
          ) : summary ? (
            <div className="space-y-3 text-xs">
              <div>
                <span className="text-gray-500">研究背景：</span>
                <p className="text-gray-300 mt-1">{summary.background}</p>
              </div>
              <div>
                <span className="text-gray-500">核心方法：</span>
                <p className="text-gray-300 mt-1">{summary.methods}</p>
              </div>
              <div>
                <span className="text-gray-500">主要结论：</span>
                <p className="text-gray-300 mt-1">{summary.conclusions}</p>
              </div>
              {summary.keyPoints?.length > 0 && (
                <div>
                  <span className="text-gray-500">关键要点：</span>
                  <ul className="mt-1 space-y-1">
                    {summary.keyPoints.map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-gray-300">
                        <span className="text-blue-400 mt-0.5">•</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-600">点击"生成"按钮生成文章概要</p>
          )}
        </div>

        {/* 思维导图 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">文章结构</span>
            {!structure.length && (
              <Button
                size="sm"
                variant="light"
                className="text-xs text-gray-500 h-6 min-w-0 px-2"
                isLoading={generating === 'structure'}
                onPress={generateStructure}
                isDisabled={!modelConfig}
              >
                生成
              </Button>
            )}
          </div>

          {structure.length > 0 ? (
            <GuideMindMap structure={structure} onNodeClick={handleNodeClick} />
          ) : (
            <div className="h-40 flex items-center justify-center border border-dashed border-[#333] rounded-lg">
              <p className="text-xs text-gray-600">
                {loading ? '生成中...' : '点击"生成"按钮生成思维导图'}
              </p>
            </div>
          )}
        </div>

        {/* 段落关键要点 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">段落讲解</span>
            {!blockKeyPoints.length && (
              <Button
                size="sm"
                variant="light"
                className="text-xs text-gray-500 h-6 min-w-0 px-2"
                isLoading={generating === 'keypoints'}
                onPress={generateKeyPoints}
                isDisabled={!modelConfig}
              >
                生成
              </Button>
            )}
          </div>

          {blockKeyPoints.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-auto">
              {blockKeyPoints.slice(0, 20).map((block) => (
                <div
                  key={block.blockId}
                  className="p-2 bg-[#1a1a1a] rounded border border-[#333] cursor-pointer hover:border-[#444] transition-colors"
                  onClick={() => onBlockClick?.(block.blockId, block.pageNum)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Chip size="sm" variant="flat" className="text-[10px] h-5">
                      P.{block.pageNum}
                    </Chip>
                    <p className="text-xs text-gray-500 truncate flex-1">
                      {block.text.slice(0, 50)}...
                    </p>
                  </div>
                  <ul className="space-y-0.5">
                    {block.keyPoints.slice(0, 3).map((point, i) => (
                      <li key={i} className="text-xs text-gray-400 flex items-start gap-1">
                        <span className="text-purple-400">•</span>
                        <span className="truncate">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {blockKeyPoints.length > 20 && (
                <p className="text-xs text-gray-600 text-center">
                  还有 {blockKeyPoints.length - 20} 个段落...
                </p>
              )}
            </div>
          ) : (
            <div className="h-20 flex items-center justify-center border border-dashed border-[#333] rounded-lg">
              <p className="text-xs text-gray-600">
                {loading ? '生成中...' : '点击"生成"按钮提取段落关键要点'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
