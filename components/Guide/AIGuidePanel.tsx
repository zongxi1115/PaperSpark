'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Button, Skeleton, Chip, Progress, Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/react'
import { Icon } from '@iconify/react'
import GuideMindMap from './GuideMindMap'
import type {
  TextBlock,
  AIGuideSummary,
  MindMapNode,
  BlockKeyPoints,
  ModelConfig,
  AIGuideHighlight,
  GuideFocusTarget,
  GuideCache,
  AIGuideAction,
  AIGuideResponse,
} from '@/lib/types'
import { getGuideByKnowledgeId, saveGuide } from '@/lib/pdfCache'

type GuideSection = 'summary' | 'structure' | 'keypoints' | 'highlights'

const GUIDE_SECTIONS: GuideSection[] = ['summary', 'structure', 'highlights', 'keypoints']

interface AIGuidePanelProps {
  documentId: string
  knowledgeItemId: string
  blocks: TextBlock[]
  fullText?: string
  modelConfig: ModelConfig | null
  onBlockClick?: (target: GuideFocusTarget) => void
}

export default function AIGuidePanel({
  documentId,
  knowledgeItemId,
  blocks,
  fullText,
  modelConfig,
  onBlockClick,
}: AIGuidePanelProps) {
  const [loadingCache, setLoadingCache] = useState(true)
  const [allLoading, setAllLoading] = useState(false)
  const [sectionLoading, setSectionLoading] = useState<Record<GuideSection, boolean>>({
    summary: false,
    structure: false,
    keypoints: false,
    highlights: false,
  })
  const [progress, setProgress] = useState(0)

  const [summary, setSummary] = useState<AIGuideSummary | null>(null)
  const [structure, setStructure] = useState<MindMapNode[]>([])
  const [highlights, setHighlights] = useState<AIGuideHighlight[]>([])
  const [blockKeyPoints, setBlockKeyPoints] = useState<BlockKeyPoints[]>([])
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)

  // 使用 ref 防止重复加载
  const loadedRef = useRef(false)
  const guideDataRef = useRef<GuideCache>({
    id: documentId,
    documentId,
    knowledgeItemId,
    summary: null,
    structure: [],
    blockKeyPoints: [],
    highlights: [],
    modelUsed: modelConfig?.modelName || 'unknown',
    generatedAt: '',
    updatedAt: '',
  })

  useEffect(() => {
    guideDataRef.current = {
      ...guideDataRef.current,
      id: documentId,
      documentId,
      knowledgeItemId,
      summary,
      structure,
      blockKeyPoints,
      highlights,
      modelUsed: modelConfig?.modelName || guideDataRef.current.modelUsed || 'unknown',
    }
  }, [documentId, knowledgeItemId, summary, structure, blockKeyPoints, highlights, modelConfig])

  // 加载缓存的导读数据
  const loadCachedGuide = useCallback(async () => {
    if (loadedRef.current || !knowledgeItemId) return
    loadedRef.current = true
    setLoadingCache(true)

    try {
      const cached = await getGuideByKnowledgeId(knowledgeItemId)
      if (cached) {
        guideDataRef.current = {
          ...guideDataRef.current,
          ...cached,
          id: documentId,
          documentId,
          knowledgeItemId,
        }
        if (cached.summary) setSummary(cached.summary)
        if (cached.structure) setStructure(cached.structure)
        if (cached.highlights) setHighlights(cached.highlights)
        if (cached.blockKeyPoints) setBlockKeyPoints(cached.blockKeyPoints)
      }
    } catch (error) {
      console.error('Load cached guide error:', error)
    } finally {
      setLoadingCache(false)
    }
  }, [knowledgeItemId])

  // 保存导读数据到缓存
  const saveGuideToCache = useCallback(async (nextGuide: GuideCache) => {
    if (!documentId || !knowledgeItemId) return

    const now = new Date().toISOString()
    await saveGuide({
      ...nextGuide,
      id: documentId,
      documentId,
      knowledgeItemId,
      modelUsed: modelConfig?.modelName || 'unknown',
      generatedAt: nextGuide.generatedAt || now,
      updatedAt: now,
    })
  }, [documentId, knowledgeItemId, modelConfig])

  const commitGuidePatch = useCallback(async (patch: Partial<GuideCache>) => {
    const nextGuide: GuideCache = {
      ...guideDataRef.current,
      ...patch,
      id: documentId,
      documentId,
      knowledgeItemId,
      modelUsed: modelConfig?.modelName || guideDataRef.current.modelUsed || 'unknown',
      generatedAt: guideDataRef.current.generatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    guideDataRef.current = nextGuide

    if (Object.prototype.hasOwnProperty.call(patch, 'summary')) {
      setSummary((patch.summary as AIGuideSummary | null | undefined) ?? null)
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'structure')) {
      setStructure(patch.structure || [])
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'highlights')) {
      setHighlights(patch.highlights || [])
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'blockKeyPoints')) {
      setBlockKeyPoints(patch.blockKeyPoints || [])
    }

    await saveGuideToCache(nextGuide)
  }, [documentId, knowledgeItemId, modelConfig, saveGuideToCache])

  // 组件挂载时加载缓存
  useEffect(() => {
    loadCachedGuide()
  }, [loadCachedGuide])

  const generateSection = useCallback(async (
    action: GuideSection,
    options?: { onSettled?: () => void }
  ) => {
    if (!modelConfig) {
      options?.onSettled?.()
      return
    }

    if (action !== 'summary' && blocks.length === 0) {
      options?.onSettled?.()
      return
    }

    setSectionLoading(prev => ({ ...prev, [action]: true }))

    try {
      const requestBody: {
        documentId: string
        knowledgeItemId: string
        blocks: TextBlock[]
        modelConfig: ModelConfig
        action: AIGuideAction
        fullText?: string
      } = {
        documentId,
        knowledgeItemId,
        blocks,
        modelConfig,
        action,
      }

      if (action === 'summary') {
        requestBody.fullText = fullText || blocks.map(block => block.text).join('\n\n')
      }

      const response = await fetch('/api/ai/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const result = await response.json() as AIGuideResponse
      if (!result.success) {
        return
      }

      if (action === 'summary' && result.summary) {
        await commitGuidePatch({ summary: result.summary })
      }

      if (action === 'structure' && result.structure) {
        await commitGuidePatch({ structure: result.structure })
      }

      if (action === 'highlights' && result.highlights) {
        await commitGuidePatch({ highlights: result.highlights })
      }

      if (action === 'keypoints' && result.blockKeyPoints) {
        await commitGuidePatch({ blockKeyPoints: result.blockKeyPoints })
      }
    } catch (error) {
      console.error(`Generate ${action} error:`, error)
    } finally {
      setSectionLoading(prev => ({ ...prev, [action]: false }))
      options?.onSettled?.()
    }
  }, [blocks, commitGuidePatch, documentId, fullText, knowledgeItemId, modelConfig])

  const generateAll = useCallback(async () => {
    if (!modelConfig || !blocks.length || allLoading) return

    let completed = 0
    setAllLoading(true)
    setProgress(0)

    const handleSettled = () => {
      completed += 1
      setProgress(Math.round((completed / GUIDE_SECTIONS.length) * 100))
    }

    try {
      await Promise.allSettled(
        GUIDE_SECTIONS.map(action => generateSection(action, { onSettled: handleSettled }))
      )
    } finally {
      setAllLoading(false)
    }
  }, [allLoading, blocks.length, generateSection, modelConfig])

  // 处理节点点击
  const handleNodeClick = useCallback(
    (target: GuideFocusTarget) => {
      if (target.blockId && target.pageNum && onBlockClick) {
        onBlockClick(target)
      }
    },
    [onBlockClick]
  )

  const hasAnyContent = Boolean(summary) || structure.length > 0 || highlights.length > 0 || blockKeyPoints.length > 0
  const hasActiveGeneration = allLoading || Object.values(sectionLoading).some(Boolean)

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
              isLoading={allLoading}
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
              isDisabled={hasActiveGeneration || !modelConfig}
            >
              <Icon icon="mdi:refresh" className="text-sm" />
            </Button>
          )}
        </div>
      </div>

      {/* 进度条 */}
      {allLoading && (
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
                isLoading={sectionLoading.summary}
                onPress={() => generateSection('summary')}
                isDisabled={!modelConfig || sectionLoading.summary}
              >
                生成
              </Button>
            )}
          </div>

          {sectionLoading.summary && !summary ? (
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
            <div className="flex items-center gap-1">
              {structure.length > 0 && (
                <Button
                  isIconOnly
                  size="sm"
                  variant="light"
                  className="text-gray-500 min-w-0 h-6 w-6"
                  onPress={() => setMindMapFullscreen(true)}
                >
                  <Icon icon="mdi:fullscreen" className="text-sm" />
                </Button>
              )}
              {!structure.length && (
                <Button
                  size="sm"
                  variant="light"
                  className="text-xs text-gray-500 h-6 min-w-0 px-2"
                  isLoading={sectionLoading.structure}
                  onPress={() => generateSection('structure')}
                  isDisabled={!modelConfig || sectionLoading.structure}
                >
                  生成
                </Button>
              )}
            </div>
          </div>

          {structure.length > 0 ? (
            <GuideMindMap structure={structure} onNodeClick={handleNodeClick} />
          ) : (
            <div className="h-40 flex items-center justify-center border border-dashed border-[#333] rounded-lg">
              <p className="text-xs text-gray-600">
                {sectionLoading.structure ? '生成中...' : '点击"生成"按钮生成思维导图'}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-400">文章重点</span>
            {!highlights.length && (
              <Button
                size="sm"
                variant="light"
                className="text-xs text-gray-500 h-6 min-w-0 px-2"
                isLoading={sectionLoading.highlights}
                onPress={() => generateSection('highlights')}
                isDisabled={!modelConfig || sectionLoading.highlights}
              >
                生成
              </Button>
            )}
          </div>

          {highlights.length > 0 ? (
            <div className="space-y-2">
              {highlights.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full rounded-xl border border-[#333] bg-[#171717] px-3 py-3 text-left transition-colors hover:border-[#4d72ff] hover:bg-[#1d1f2a]"
                  onClick={() => onBlockClick?.({
                    blockId: item.blockId,
                    pageNum: item.pageNum,
                    title: item.title,
                    note: item.note,
                  })}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Chip size="sm" variant="flat" className="text-[10px] h-5">
                      P.{item.pageNum}
                    </Chip>
                    <span className="text-xs font-medium text-blue-300">{item.title}</span>
                  </div>
                  {item.quote && (
                    <p className="text-[11px] text-gray-500 mb-1.5 line-clamp-2">
                      {item.quote}
                    </p>
                  )}
                  <p className="text-xs text-gray-300 leading-relaxed">{item.note}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="h-24 flex items-center justify-center border border-dashed border-[#333] rounded-lg">
              <p className="text-xs text-gray-600">
                {sectionLoading.highlights ? '生成中...' : '点击"生成"按钮提取文章重点'}
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
                isLoading={sectionLoading.keypoints}
                onPress={() => generateSection('keypoints')}
                isDisabled={!modelConfig || sectionLoading.keypoints}
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
                  onClick={() => onBlockClick?.({
                    blockId: block.blockId,
                    pageNum: block.pageNum,
                    title: '段落讲解',
                    note: block.keyPoints.join('； '),
                  })}
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
                {sectionLoading.keypoints ? '生成中...' : '点击"生成"按钮提取段落关键要点'}
              </p>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={mindMapFullscreen} onClose={() => setMindMapFullscreen(false)} size="5xl">
        <ModalContent className="bg-[#161616] text-white">
          <ModalHeader className="border-b border-[#2a2a2a]">文章结构</ModalHeader>
          <ModalBody className="p-4">
            <GuideMindMap
              structure={structure}
              onNodeClick={handleNodeClick}
              className="h-[70vh]"
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  )
}
