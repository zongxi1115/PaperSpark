'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Tooltip, Skeleton, Progress, Chip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { getKnowledgeItem, getSettings, getSelectedSmallModel, updateKnowledgeItem } from '@/lib/storage'
import {
  getPDFFile,
  savePDFFile,
  getPDFDocumentByKnowledgeId,
  savePDFDocument,
  updatePDFDocument,
  getPDFPagesByDocumentId,
  savePDFPages,
  getTranslation,
  deleteTranslation,
  getAnnotationsByDocumentId,
  saveAnnotation,
  deleteAnnotation,
} from '@/lib/pdfCache'
import PDFViewer from '@/components/PDF/PDFViewer'
import type { TextBlock, PDFAnnotation, TranslationStreamEvent, HighlightColor, TranslationBlockPayload } from '@/lib/types'
import { HIGHLIGHT_COLORS } from '@/lib/types'
import { parsePDFWithSurya } from '@/lib/suryaParser'

export default function ImmersiveReaderPage() {
  const params = useParams()
  const router = useRouter()
  const knowledgeId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null)
  const [documentTitle, setDocumentTitle] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [sidebarTab, setSidebarTab] = useState<'info' | 'translate' | 'notes'>('info')

  // PDF 数据
  const [blocks, setBlocks] = useState<TextBlock[]>([])
  const [translatedBlocks, setTranslatedBlocks] = useState<Map<string, string>>(new Map())

  // 翻译状态
  const [translating, setTranslating] = useState(false)
  const [translationProgress, setTranslationProgress] = useState({ current: 0, total: 0 })
  const [showTranslation, setShowTranslation] = useState(false)
  const [hasTranslation, setHasTranslation] = useState(false)
  const [structureParsing, setStructureParsing] = useState(false)
  const [suryaReady, setSuryaReady] = useState(false)

  // 批注
  const [annotations, setAnnotations] = useState<PDFAnnotation[]>([])

  // 元数据
  const [metadata, setMetadata] = useState<{
    title: string
    authors: string[]
    abstract: string
    year: string
    journal: string
  } | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(true)

  const processedRef = useRef(false)

  // 加载 PDF 文件
  const loadPDF = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const item = getKnowledgeItem(knowledgeId)
      if (!item) {
        setError('未找到文档')
        setLoading(false)
        return
      }
      setDocumentTitle(item.title)

      // 检查是否有缓存的 PDF 文件
      const cachedFile = await getPDFFile(knowledgeId)
      if (cachedFile) {
        const arrayBuffer = await cachedFile.blob.arrayBuffer()
        setPdfData(arrayBuffer)
        setLoading(false)
        return
      }

      // 获取 PDF
      let blob: Blob | null = null

      if (item.sourceType === 'upload' && item.sourceId) {
        const { getStoredFile } = await import('@/lib/localFiles')
        const fileRecord = await getStoredFile(item.sourceId)
        if (fileRecord?.blob) {
          blob = fileRecord.blob
        }
      } else if (item.attachmentUrl) {
        const res = await fetch(`/api/pdf/proxy?url=${encodeURIComponent(item.attachmentUrl)}`)
        if (!res.ok) {
          throw new Error('获取 PDF 失败')
        }
        const data = await res.json()
        const binaryString = atob(data.base64)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        blob = new Blob([bytes], { type: 'application/pdf' })
      }

      if (!blob) {
        setError('无法获取 PDF 文件')
        setLoading(false)
        return
      }

      await savePDFFile(knowledgeId, blob, item.fileName || 'document.pdf')
      const arrayBuffer = await blob.arrayBuffer()
      setPdfData(arrayBuffer)
      setLoading(false)

    } catch (err) {
      console.error('Load PDF error:', err)
      setError(err instanceof Error ? err.message : '加载失败')
      setLoading(false)
    }
  }, [knowledgeId])

  // 后台处理 - 解析 PDF
  const processPDF = useCallback(async () => {
    if (processedRef.current) return
    processedRef.current = true

    const item = getKnowledgeItem(knowledgeId)
    if (!item) return

    const anns = await getAnnotationsByDocumentId(knowledgeId)
    setAnnotations(anns)

    // 检查已有缓存
    const existingDoc = await getPDFDocumentByKnowledgeId(knowledgeId)
    const existingPages = await getPDFPagesByDocumentId(knowledgeId)
    const hasCompletedSuryaCache =
      existingDoc?.parser === 'surya' &&
      existingDoc?.parseStatus === 'completed' &&
      existingPages.length > 0
    setSuryaReady(hasCompletedSuryaCache)

    if (existingDoc) {
      if (existingDoc.parser === 'surya') {
        const translation = await getTranslation(knowledgeId)
        if (translation) {
          setHasTranslation(true)
          const transMap = new Map(translation.blocks.map(b => [b.blockId, b.translated]))
          setTranslatedBlocks(transMap)
        } else {
          setHasTranslation(false)
          setTranslatedBlocks(new Map())
        }
      } else {
        setHasTranslation(false)
        setTranslatedBlocks(new Map())
      }

      if (existingPages.length > 0) {
        setTotalPages(existingPages.length)
        const allBlocks = existingPages.flatMap(p => p.blocks)
        setBlocks(allBlocks)
      }

      setMetadata({
        title: existingDoc.metadata.title,
        authors: existingDoc.metadata.authors,
        abstract: existingDoc.metadata.abstract,
        year: existingDoc.metadata.year,
        journal: existingDoc.metadata.journal,
      })
      setMetadataLoading(false)
    } else {
      setMetadata({
        title: item.title,
        authors: item.authors,
        abstract: item.abstract || '',
        year: item.year || '',
        journal: item.journal || '',
      })
    }

    if (hasCompletedSuryaCache) {
      return
    }

    setStructureParsing(true)
    setMetadataLoading(!existingDoc)
    try {
      const cachedFile = await getPDFFile(knowledgeId)
      if (!cachedFile) {
        setMetadataLoading(false)
        return
      }

      const fallbackMetadata = {
        title: existingDoc?.metadata.title || item.title,
        authors: existingDoc?.metadata.authors?.length ? existingDoc.metadata.authors : item.authors,
        abstract: existingDoc?.metadata.abstract || item.abstract || '',
        year: existingDoc?.metadata.year || item.year || '',
        journal: existingDoc?.metadata.journal || item.journal || '',
        keywords: existingDoc?.metadata.keywords || [],
        references: existingDoc?.metadata.references || [],
      }

      const now = new Date().toISOString()
      if (existingDoc) {
        await updatePDFDocument(knowledgeId, {
          parser: 'surya',
          parseStatus: 'processing',
          parseError: '',
        })
      } else {
        await savePDFDocument({
          id: knowledgeId,
          knowledgeItemId: knowledgeId,
          fileName: cachedFile.fileName,
          pageCount: existingPages.length,
          metadata: fallbackMetadata,
          parser: 'surya',
          parseStatus: 'processing',
          parsedAt: now,
          updatedAt: now,
        })
      }

      const result = await parsePDFWithSurya({
        documentId: knowledgeId,
        fileBlob: cachedFile.blob,
        fileName: cachedFile.fileName,
        keepOutputs: false,
      })

      setTotalPages(result.pages.length)
      const allBlocks = result.pages.flatMap(p => p.blocks)
      setBlocks(allBlocks)
      setSuryaReady(true)

      if (existingDoc?.parser !== 'surya') {
        await deleteTranslation(knowledgeId)
        setHasTranslation(false)
        setTranslatedBlocks(new Map())
      }

      const mergedMetadata = {
        title: result.metadata.title || item.title,
        authors: result.metadata.authors?.length ? result.metadata.authors : item.authors,
        abstract: result.metadata.abstract || item.abstract || '',
        year: result.metadata.year || item.year || '',
        journal: result.metadata.journal || item.journal || '',
        keywords: result.metadata.keywords || [],
        references: result.metadata.references || [],
      }
      const parsedAt = new Date().toISOString()

      await savePDFDocument({
        id: knowledgeId,
        knowledgeItemId: knowledgeId,
        fileName: cachedFile.fileName,
        pageCount: result.pages.length,
        metadata: mergedMetadata,
        parser: 'surya',
        parseStatus: 'completed',
        parseError: '',
        fullText: result.fullText,
        structureCounts: result.structureCounts,
        parsedAt,
        updatedAt: parsedAt,
      })

      setMetadata({
        title: mergedMetadata.title,
        authors: mergedMetadata.authors,
        abstract: mergedMetadata.abstract,
        year: mergedMetadata.year,
        journal: mergedMetadata.journal,
      })

      await savePDFPages(result.pages)
      updateKnowledgeItem(knowledgeId, {
        hasImmersiveCache: true,
        immersiveCacheAt: parsedAt,
        extractedMetadata: mergedMetadata,
      })
      setMetadataLoading(false)

    } catch (err) {
      console.error('Process PDF error:', err)
      setSuryaReady(false)
      await updatePDFDocument(knowledgeId, {
        parser: 'surya',
        parseStatus: 'failed',
        parseError: err instanceof Error ? err.message : 'Surya 解析失败',
      })
      setMetadataLoading(false)
    } finally {
      setStructureParsing(false)
    }
  }, [knowledgeId])

  // 流式翻译
  const startStreamingTranslation = useCallback(async () => {
    if (translating || structureParsing || !suryaReady || blocks.length === 0) return

    setTranslating(true)
    setHasTranslation(false)
    setShowTranslation(true)
    setTranslatedBlocks(new Map())
    setTranslationProgress({ current: 0, total: blocks.length })

    const settings = getSettings()
    const modelConfig = getSelectedSmallModel(settings)

    const blocksData: TranslationBlockPayload[] = blocks.map(block => ({
      id: block.id,
      type: block.type,
      text: block.text,
      pageNum: block.pageNum,
      bbox: block.bbox,
      style: block.style,
    }))

    try {
      const response = await fetch('/api/pdf/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: knowledgeId, blocks: blocksData, modelConfig }),
      })

      if (!response.ok) {
        throw new Error('翻译请求失败')
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6)) as TranslationStreamEvent

              if (event.type === 'start') {
                setTranslationProgress({
                  current: event.data?.progress || 0,
                  total: event.data?.total || blocks.length,
                })
              } else if (event.type === 'progress') {
                setTranslationProgress({
                  current: event.data?.progress || 0,
                  total: event.data?.total || blocks.length,
                })
              } else if (event.type === 'chunk' && event.data) {
                const blockId = event.data.blockId || event.data.chunkId
                if (!blockId) continue

                setTranslatedBlocks(prev => {
                  const next = new Map(prev)
                  next.set(blockId, event.data.translated || '')
                  return next
                })

                if (event.data.done) {
                  setTranslationProgress({
                    current: event.data.progress || 0,
                    total: event.data.total || blocks.length,
                  })
                }
              } else if (event.type === 'complete') {
                setHasTranslation(true)
                // 重新加载翻译缓存以获取完整的 blockId 映射
                const translation = await getTranslation(knowledgeId)
                if (translation) {
                  const transMap = new Map(translation.blocks.map(b => [b.blockId, b.translated]))
                  setTranslatedBlocks(transMap)
                }
              } else if (event.type === 'error') {
                console.error('Translation error:', event.data?.error)
              }
            } catch (e) {
              console.error('Parse SSE error:', e)
            }
          }
        }
      }
    } catch (err) {
      console.error('Streaming translation error:', err)
    } finally {
      setTranslating(false)
    }
  }, [translating, structureParsing, suryaReady, blocks, knowledgeId])

  // 添加批注
  const handleAnnotationAdd = useCallback(async (annotation: PDFAnnotation) => {
    const newAnnotation = { ...annotation, documentId: knowledgeId }
    await saveAnnotation(newAnnotation)
    setAnnotations(prev => [...prev, newAnnotation])
  }, [knowledgeId])

  // 删除批注
  const handleAnnotationDelete = useCallback(async (id: string) => {
    await deleteAnnotation(id)
    setAnnotations(prev => prev.filter(a => a.id !== id))
  }, [])

  // 更新 blocks 的翻译
  const blocksWithTranslation = blocks.map(b => ({
    ...b,
    translated: translatedBlocks.get(b.id),
  }))
  const canTranslate = suryaReady && !structureParsing && blocks.length > 0

  useEffect(() => {
    loadPDF()
  }, [loadPDF])

  useEffect(() => {
    if (pdfData && !loading) {
      const timer = setTimeout(() => processPDF(), 500)
      return () => clearTimeout(timer)
    }
  }, [pdfData, loading, processPDF])

  // 加载状态
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] bg-[#1a1a1a]">
        <Icon icon="mdi:file-pdf-box" className="text-6xl text-blue-500 mb-4 animate-pulse" />
        <p className="text-gray-400">正在加载 PDF...</p>
      </div>
    )
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] bg-[#1a1a1a]">
        <Icon icon="mdi:alert-circle" className="text-6xl text-red-500 mb-4" />
        <p className="text-gray-400 mb-4">{error}</p>
        <div className="flex gap-4">
          <Button color="primary" onPress={loadPDF}>重试</Button>
          <Button variant="light" onPress={() => router.back()}>返回</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-52px)] bg-[#1a1a1a]">
      {/* 左侧边栏 */}
      <div className="w-12 bg-[#252525] flex flex-col items-center py-3 gap-1 border-r border-[#333]">
        <Tooltip content="返回" placement="right">
          <Button isIconOnly size="sm" variant="light" className="text-gray-400 hover:text-white" onPress={() => router.back()}>
            <Icon icon="mdi:arrow-left" className="text-xl" />
          </Button>
        </Tooltip>

        <div className="w-6 h-px bg-[#444] my-2" />

        <Tooltip content="文档信息" placement="right">
          <Button
            isIconOnly
            size="sm"
            variant={sidebarTab === 'info' ? 'solid' : 'light'}
            color={sidebarTab === 'info' ? 'primary' : 'default'}
            className={sidebarTab === 'info' ? '' : 'text-gray-400 hover:text-white'}
            onPress={() => setSidebarTab('info')}
          >
            <Icon icon="mdi:information-outline" className="text-xl" />
          </Button>
        </Tooltip>

        <Tooltip content="翻译结果" placement="right">
          <Button
            isIconOnly
            size="sm"
            variant={sidebarTab === 'translate' ? 'solid' : 'light'}
            color={sidebarTab === 'translate' ? 'primary' : 'default'}
            className={sidebarTab === 'translate' ? '' : 'text-gray-400 hover:text-white'}
            onPress={() => setSidebarTab('translate')}
          >
            <Icon icon="mdi:translate" className="text-xl" />
          </Button>
        </Tooltip>

        <Tooltip content={`批注 (${annotations.length})`} placement="right">
          <Button
            isIconOnly
            size="sm"
            variant={sidebarTab === 'notes' ? 'solid' : 'light'}
            color={sidebarTab === 'notes' ? 'primary' : 'default'}
            className={sidebarTab === 'notes' ? '' : 'text-gray-400 hover:text-white'}
            onPress={() => setSidebarTab('notes')}
          >
            <Icon icon="mdi:comment-text-outline" className="text-xl" />
          </Button>
        </Tooltip>

        <div className="flex-1" />

        {/* 翻译状态 */}
        {translating && (
          <Tooltip content={`翻译中 ${translationProgress.current}/${translationProgress.total}`} placement="right">
            <div className="flex flex-col items-center p-2">
              <Icon icon="mdi:sync" className="text-xl text-blue-400 animate-spin" />
              <span className="text-[10px] text-gray-500 mt-1">
                {translationProgress.current}/{translationProgress.total}
              </span>
            </div>
          </Tooltip>
        )}

        {structureParsing && (
          <Tooltip content="正在解析原文结构" placement="right">
            <Icon icon="mdi:file-search-outline" className="text-xl text-amber-400 animate-pulse" />
          </Tooltip>
        )}

        {hasTranslation && !translating && (
          <Tooltip content="翻译已完成" placement="right">
            <Icon icon="mdi:check-circle" className="text-xl text-green-500" />
          </Tooltip>
        )}
      </div>

      {/* 左侧面板 */}
      <div className="w-72 bg-[#252525] border-r border-[#333] flex flex-col overflow-hidden">
        {/* 文档信息 */}
        {sidebarTab === 'info' && (
          <div className="flex-1 overflow-auto p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">文档信息</h3>

            {metadataLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full rounded bg-[#333]" />
                <Skeleton className="h-4 w-3/4 rounded bg-[#333]" />
                <Skeleton className="h-4 w-1/2 rounded bg-[#333]" />
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="text-xs text-gray-500 block mb-1">标题</label>
                  <p className="text-sm text-gray-200">{metadata?.title || documentTitle}</p>
                </div>

                {metadata?.authors?.length > 0 && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500 block mb-1">作者</label>
                    <p className="text-sm text-gray-300">{metadata.authors.join(', ')}</p>
                  </div>
                )}

                {(metadata?.year || metadata?.journal) && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500 block mb-1">来源</label>
                    <p className="text-sm text-gray-400">
                      {metadata.journal && <span>{metadata.journal}</span>}
                      {metadata.year && <span> ({metadata.year})</span>}
                    </p>
                  </div>
                )}

                {metadata?.abstract && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500 block mb-1">摘要</label>
                    <p className="text-xs text-gray-400 leading-relaxed">{metadata.abstract}</p>
                  </div>
                )}
              </>
            )}

            {structureParsing && (
              <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-300">正在使用 Surya 解析整篇原文结构，完成后会覆盖本地块缓存。</p>
              </div>
            )}
          </div>
        )}

        {/* 翻译结果 */}
        {sidebarTab === 'translate' && (
          <div className="flex-1 overflow-auto p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-300">翻译</h3>
              {hasTranslation && (
                <Button
                  size="sm"
                  variant="flat"
                  color={showTranslation ? 'primary' : 'default'}
                  onPress={() => setShowTranslation(!showTranslation)}
                >
                  {showTranslation ? '隐藏译文' : '显示译文'}
                </Button>
              )}
            </div>

            {translating && (
              <div className="mb-4 p-3 bg-[#1a1a1a] rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Icon icon="mdi:sync" className="text-blue-400 animate-spin" />
                  <span className="text-xs text-gray-400">
                    翻译中 {translationProgress.current}/{translationProgress.total}
                  </span>
                </div>
                <Progress
                  value={translationProgress.total > 0 ? (translationProgress.current / translationProgress.total) * 100 : 0}
                  size="sm"
                  color="primary"
                />
              </div>
            )}

            {!translating && !hasTranslation && (
              <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                <Icon icon="mdi:translate" className="text-3xl mb-2" />
                <p className="text-sm">
                  {structureParsing
                    ? '正在等待结构解析完成'
                    : suryaReady
                      ? '尚未翻译'
                      : '结构缓存尚未就绪'}
                </p>
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  className="mt-2"
                  onPress={startStreamingTranslation}
                  isDisabled={!canTranslate}
                >
                  开始翻译
                </Button>
              </div>
            )}

            {(translatedBlocks.size > 0 || hasTranslation) && (
              <div className="space-y-3">
                <p className={`text-xs ${translating ? 'text-blue-400' : 'text-green-400'}`}>
                  {translating ? '实时回显中…' : '✓ 翻译已完成'}
                </p>
                <div className="max-h-96 overflow-auto space-y-2">
                  {Array.from(translatedBlocks.entries()).slice(0, 20).map(([id, translated]) => {
                    const block = blocks.find(b => b.id === id)
                    return (
                      <div key={id} className="p-2 bg-[#1a1a1a] rounded text-xs">
                        <p className="text-gray-500 mb-1 line-clamp-2">{block?.text?.slice(0, 100)}...</p>
                        <p className="text-gray-300">{translated?.slice(0, 150)}...</p>
                      </div>
                    )
                  })}
                  {translatedBlocks.size > 20 && (
                    <p className="text-xs text-gray-500 text-center">... 还有 {translatedBlocks.size - 20} 条</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 批注 */}
        {sidebarTab === 'notes' && (
          <div className="flex-1 overflow-auto p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">批注 ({annotations.length})</h3>

            {annotations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                <Icon icon="mdi:comment-text-outline" className="text-3xl mb-2" />
                <p className="text-sm">暂无批注</p>
                <p className="text-xs mt-1 text-gray-600">选中文本后点击颜色添加高亮</p>
              </div>
            ) : (
              <div className="space-y-2">
                {annotations.map(ann => (
                  <div
                    key={ann.id}
                    className="p-2 bg-[#1a1a1a] rounded group"
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                        style={{ backgroundColor: HIGHLIGHT_COLORS[ann.color].border }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-300 line-clamp-3">{ann.selectedText}</p>
                        <p className="text-[10px] text-gray-600 mt-1">第 {ann.pageNum} 页</p>
                      </div>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 min-w-6 h-6"
                        onPress={() => handleAnnotationDelete(ann.id)}
                      >
                        <Icon icon="mdi:delete-outline" className="text-sm" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部工具栏 */}
        <div className="h-10 bg-[#252525] border-b border-[#333] flex items-center px-3 gap-2">
          <div className="flex items-center gap-1">
            <Tooltip content="缩小">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className="text-gray-400 hover:text-white min-w-8 h-8"
                onPress={() => setScale(s => Math.max(0.5, s - 0.2))}
              >
                <Icon icon="mdi:magnify-minus" className="text-lg" />
              </Button>
            </Tooltip>
            <span className="text-xs text-gray-500 w-12 text-center">{Math.round(scale * 100)}%</span>
            <Tooltip content="放大">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className="text-gray-400 hover:text-white min-w-8 h-8"
                onPress={() => setScale(s => Math.min(3, s + 0.2))}
              >
                <Icon icon="mdi:magnify-plus" className="text-lg" />
              </Button>
            </Tooltip>
            <Tooltip content="适应宽度">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                className="text-gray-400 hover:text-white min-w-8 h-8"
                onPress={() => setScale(1.2)}
              >
                <Icon icon="mdi:fit-to-width" className="text-lg" />
              </Button>
            </Tooltip>
          </div>

          <div className="w-px h-5 bg-[#444] mx-2" />

          {/* 翻译切换 */}
          <Tooltip content={showTranslation ? '隐藏译文' : '显示译文'}>
            <Button
              isIconOnly
              size="sm"
              variant={showTranslation ? 'solid' : 'light'}
              color={showTranslation ? 'primary' : 'default'}
              className="text-gray-400 hover:text-white min-w-8 h-8"
              onPress={() => setShowTranslation(!showTranslation)}
              isDisabled={!hasTranslation && !translating && translatedBlocks.size === 0}
            >
              <Icon icon="mdi:translate" className="text-lg" />
            </Button>
          </Tooltip>

          {!hasTranslation && !translating && (
            <Button
              size="sm"
              color="primary"
              variant="flat"
              onPress={startStreamingTranslation}
              isDisabled={!canTranslate}
            >
              翻译文档
            </Button>
          )}

          {translating && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Icon icon="mdi:sync" className="animate-spin" />
              <span>{translationProgress.current}/{translationProgress.total}</span>
            </div>
          )}

          {structureParsing && (
            <div className="flex items-center gap-2 text-xs text-amber-300">
              <Icon icon="mdi:file-search-outline" className="animate-pulse" />
              <span>Surya 结构解析中</span>
            </div>
          )}

          <div className="flex-1" />

          {/* 页码显示（滚动时自动更新） */}
          <span className="text-sm text-gray-400 px-2">
            {currentPage} / {totalPages || '?'}
          </span>
        </div>

        {/* PDF 查看器 */}
        <div className="flex-1 overflow-hidden">
          {pdfData ? (
            <PDFViewer
              pdfData={pdfData}
              currentPage={currentPage}
              scale={scale}
              documentId={knowledgeId}
              onPageChange={setCurrentPage}
              onTotalPagesChange={setTotalPages}
              blocks={blocksWithTranslation}
              showTranslation={showTranslation}
              annotations={annotations}
              onAnnotationAdd={handleAnnotationAdd}
              onAnnotationDelete={handleAnnotationDelete}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>PDF 加载中...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
