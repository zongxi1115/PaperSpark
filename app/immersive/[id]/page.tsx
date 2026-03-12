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
  deleteAnnotation,
  updateAnnotation,
  getFullTextByKnowledgeId,
} from '@/lib/pdfCache'
import PDFViewer from '@/components/PDF/PDFViewer'
import AIGuidePanel from '@/components/Guide/AIGuidePanel'
import type { TextBlock, PDFAnnotation, TranslationStreamEvent, HighlightColor, TranslationBlockPayload } from '@/lib/types'
import { HIGHLIGHT_COLORS } from '@/lib/types'
import { parsePDFWithSurya } from '@/lib/suryaParser'

function attachPageMetrics(blocks: TextBlock[], pageWidth: number, pageHeight: number) {
  return blocks.map(block => ({
    ...block,
    sourcePageWidth: block.sourcePageWidth || pageWidth,
    sourcePageHeight: block.sourcePageHeight || pageHeight,
  }))
}

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
  const [sidebarTab, setSidebarTab] = useState<'info' | 'translate' | 'notes' | 'guide'>('guide')
  const [sidebarWidth, setSidebarWidth] = useState(288) // 288px = 72 * 4

  // PDF 数据
  const [blocks, setBlocks] = useState<TextBlock[]>([])
  const [translatedBlocks, setTranslatedBlocks] = useState<Map<string, string>>(new Map())
  const [fullText, setFullText] = useState<string>('')

  // 跳转控制
  const [jumpToBlock, setJumpToBlock] = useState<{ blockId: string; pageNum: number } | null>(null)

  // 翻译状态
  const [translating, setTranslating] = useState(false)
  const [translationProgress, setTranslationProgress] = useState({ current: 0, total: 0 })
  const [showTranslation, setShowTranslation] = useState(false)
  const [hasTranslation, setHasTranslation] = useState(false)
  const [structureParsing, setStructureParsing] = useState(false)
  const [suryaReady, setSuryaReady] = useState(false)

  // 批注
  const [annotations, setAnnotations] = useState<PDFAnnotation[]>([])
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')

  // 元数据
  const [metadata, setMetadata] = useState<{
    title: string
    authors: string[]
    abstract: string
    year: string
    journal: string
    references?: string[]
    keywords?: string[]
  } | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(true)
  const [abstractExpanded, setAbstractExpanded] = useState(false)

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
        const allBlocks = existingPages.flatMap(p => attachPageMetrics(p.blocks, p.width, p.height))
        setBlocks(allBlocks)
      }

      // 加载全文内容
      if (existingDoc.fullText) {
        setFullText(existingDoc.fullText)
      } else if (existingPages.length > 0) {
        // 如果没有缓存的全文，从页面拼接
        const text = existingPages
          .sort((a, b) => a.pageNum - b.pageNum)
          .map(p => p.fullText || p.blocks.map(b => b.text).join('\n'))
          .join('\n\n')
        setFullText(text)
      }

      setMetadata({
        title: existingDoc.metadata.title,
        authors: existingDoc.metadata.authors,
        abstract: existingDoc.metadata.abstract,
        year: existingDoc.metadata.year,
        journal: existingDoc.metadata.journal,
        references: existingDoc.metadata.references || [],
        keywords: existingDoc.metadata.keywords || [],
      })
      setMetadataLoading(false)
    } else {
      setMetadata({
        title: item.title,
        authors: item.authors,
        abstract: item.abstract || '',
        year: item.year || '',
        journal: item.journal || '',
        references: [],
        keywords: [],
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
      const allBlocks = result.pages.flatMap(p => attachPageMetrics(p.blocks, p.width, p.height))
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

      // 设置全文内容
      if (result.fullText) {
        setFullText(result.fullText)
      }

      setMetadata({
        title: mergedMetadata.title,
        authors: mergedMetadata.authors,
        abstract: mergedMetadata.abstract,
        year: mergedMetadata.year,
        journal: mergedMetadata.journal,
        references: mergedMetadata.references,
        keywords: mergedMetadata.keywords,
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

  // 添加批注（PDFViewer 已经保存，这里只更新状态）
  const handleAnnotationAdd = useCallback((annotation: PDFAnnotation) => {
    setAnnotations(prev => [...prev, annotation])
  }, [])

  // 删除批注
  const handleAnnotationDelete = useCallback(async (id: string) => {
    await deleteAnnotation(id)
    setAnnotations(prev => prev.filter(a => a.id !== id))
    if (editingAnnotationId === id) setEditingAnnotationId(null)
  }, [editingAnnotationId])

  // 更新批注笔记
  const handleAnnotationNoteUpdate = useCallback(async (id: string, content: string) => {
    const type = content.trim() ? 'note' : 'highlight'
    await updateAnnotation(id, { content, type })
    setAnnotations(prev => prev.map(a =>
      a.id === id
        ? { ...a, content, type, updatedAt: new Date().toISOString() }
        : a
    ))
    setEditingAnnotationId(null)
  }, [])

  const handleAnnotationUpdate = useCallback((annotation: PDFAnnotation) => {
    setAnnotations(prev => prev.map(item => (
      item.id === annotation.id
        ? {
            ...item,
            ...annotation,
            createdAt: item.createdAt,
          }
        : item
    )))
  }, [])

  const handleAnnotationJump = useCallback((pageNum: number) => {
    setCurrentPage(pageNum)
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

        <div className="w-6 h-px bg-[#444] my-2" />

        <Tooltip content="AI导读" placement="right">
          <Button
            isIconOnly
            size="sm"
            variant={sidebarTab === 'guide' ? 'solid' : 'light'}
            color={sidebarTab === 'guide' ? 'primary' : 'default'}
            className={sidebarTab === 'guide' ? '' : 'text-gray-400 hover:text-white'}
            onPress={() => setSidebarTab('guide')}
          >
            <Icon icon="mdi:robot-outline" className="text-xl" />
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
      <div 
        className="bg-[#252525] border-r border-[#333] flex flex-col overflow-hidden relative"
        style={{ width: sidebarWidth }}
      >
        {/* 拖动调整宽度手柄 */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors z-10"
          onMouseDown={(e) => {
            e.preventDefault()
            const startX = e.clientX
            const startWidth = sidebarWidth

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const delta = moveEvent.clientX - startX
              const newWidth = Math.max(200, Math.min(500, startWidth + delta))
              setSidebarWidth(newWidth)
            }

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove)
              document.removeEventListener('mouseup', handleMouseUp)
              document.body.style.cursor = ''
              document.body.style.userSelect = ''
            }

            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
          }}
        />

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
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs text-gray-500">摘要</label>
                      {metadata.abstract.length > 150 && (
                        <button
                          className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                          onClick={() => setAbstractExpanded(!abstractExpanded)}
                        >
                          {abstractExpanded ? '收起' : '展开'}
                        </button>
                      )}
                    </div>
                    <p 
                      className={`text-xs text-gray-400 leading-relaxed ${!abstractExpanded ? 'line-clamp-5' : ''}`}
                    >
                      {metadata.abstract}
                    </p>
                  </div>
                )}

                {/* References */}
                {metadata?.references && metadata.references.length > 0 && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500 block mb-2">
                      参考文献 ({metadata.references.length})
                    </label>
                    <div className="space-y-2 max-h-64 overflow-auto">
                      {metadata.references.map((ref, idx) => {
                        // 解析链接 (DOI, URL, arXiv 等)
                        const doiMatch = ref.match(/10\.\d{4,}\/[^\s]+/gi)
                        const urlMatch = ref.match(/https?:\/\/[^\s]+/gi)
                        const arxivMatch = ref.match(/arXiv:\s*(\d+\.\d+)/i)
                        
                        const links: { type: string; url: string }[] = []
                        if (doiMatch) {
                          links.push({ type: 'DOI', url: `https://doi.org/${doiMatch[0]}` })
                        }
                        if (urlMatch) {
                          links.push({ type: 'Link', url: urlMatch[0] })
                        }
                        if (arxivMatch) {
                          links.push({ type: 'arXiv', url: `https://arxiv.org/abs/${arxivMatch[1]}` })
                        }

                        return (
                          <div 
                            key={idx} 
                            className="p-2 bg-[#1a1a1a] rounded-lg text-xs text-gray-400 leading-relaxed hover:bg-[#222] transition-colors"
                          >
                            <p className="mb-1">{ref}</p>
                            {links.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {links.map((link, linkIdx) => (
                                  <a
                                    key={linkIdx}
                                    href={link.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Icon icon="mdi:open-in-new" className="text-[10px]" />
                                    <span>{link.type}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
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
          <div className="flex-1 overflow-auto p-3">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-sm font-medium text-gray-300">
                批注
                {annotations.length > 0 && (
                  <span className="ml-1.5 text-[10px] bg-[#333] text-gray-400 rounded-full px-1.5 py-0.5">
                    {annotations.length}
                  </span>
                )}
              </h3>
              {annotations.filter(a => a.type === 'note').length > 0 && (
                <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
                  <Icon icon="mdi:note-text-outline" className="text-xs" />
                  {annotations.filter(a => a.type === 'note').length} 条笔记
                </span>
              )}
            </div>

            {annotations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-500 px-4">
                <Icon icon="mdi:comment-text-outline" className="text-4xl mb-3 text-gray-600" />
                <p className="text-sm text-center">暂无批注</p>
                <p className="text-xs mt-1.5 text-gray-600 text-center leading-relaxed">
                  选中 PDF 文本后点击颜色添加高亮，或在空白处双击直接创建文本批注
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {annotations.map(ann => (
                  <div
                    key={ann.id}
                    className="bg-[#1a1a1a] rounded-xl overflow-hidden group border border-transparent hover:border-[#333] transition-colors"
                  >
                    {/* 头部：页码 + 类型标记 + 删除 */}
                    <div
                      className="flex items-center justify-between px-3 py-1.5"
                      style={{ borderLeft: `3px solid ${HIGHLIGHT_COLORS[ann.color].border}` }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-medium cursor-pointer hover:text-blue-400 transition-colors"
                          style={{ color: HIGHLIGHT_COLORS[ann.color].border }}
                          onClick={() => handleAnnotationJump(ann.pageNum)}
                          title="跳转到该页"
                        >
                          第 {ann.pageNum} 页
                        </span>
                        {ann.type === 'note' && (
                          <span className="flex items-center gap-0.5 text-[10px] text-blue-400">
                            <Icon icon="mdi:note-text-outline" className="text-[10px]" />
                            笔记
                          </span>
                        )}
                      </div>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 min-w-5 h-5"
                        onPress={() => handleAnnotationDelete(ann.id)}
                      >
                        <Icon icon="mdi:delete-outline" className="text-xs" />
                      </Button>
                    </div>

                    {/* 选中文本引用 */}
                    <div className="px-3 pt-2 pb-1">
                      <p
                        className="text-xs text-gray-400 italic leading-relaxed line-clamp-3 pl-2 border-l-2 cursor-pointer hover:text-gray-300 transition-colors"
                        style={{ borderColor: HIGHLIGHT_COLORS[ann.color].border + '60' }}
                        onClick={() => handleAnnotationJump(ann.pageNum)}
                      >
                        {ann.selectedText || '空白处批注'}
                      </p>
                    </div>

                    {/* 笔记内容 / 编辑区 */}
                    {editingAnnotationId === ann.id ? (
                      <div className="px-3 pb-3 pt-1">
                        <textarea
                          className="w-full bg-[#252535] text-gray-200 text-xs rounded-lg px-2.5 py-2 resize-none focus:outline-none border border-gray-600 focus:border-blue-500 placeholder-gray-600"
                          rows={3}
                          value={editingNoteText}
                          onChange={e => setEditingNoteText(e.target.value)}
                          placeholder="写下你的想法..."
                          autoFocus
                        />
                        <div className="flex gap-2 mt-1.5 justify-end">
                          <Button
                            size="sm"
                            variant="light"
                            className="text-gray-500 h-6 min-w-0 px-2 text-xs"
                            onPress={() => setEditingAnnotationId(null)}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            color="primary"
                            className="h-6 min-w-0 px-2.5 text-xs"
                            onPress={() => handleAnnotationNoteUpdate(ann.id, editingNoteText)}
                          >
                            保存
                          </Button>
                        </div>
                      </div>
                    ) : ann.content ? (
                      <div
                        className="mx-3 mb-3 mt-1 rounded-lg bg-[#252535] border border-blue-900/30 px-2.5 py-2 cursor-pointer hover:border-blue-700/50 transition-colors group/note"
                        onClick={() => {
                          setEditingAnnotationId(ann.id)
                          setEditingNoteText(ann.content || '')
                        }}
                        title="点击编辑笔记"
                      >
                        <div className="flex items-start gap-1.5">
                          <Icon icon="mdi:note-text-outline" className="text-blue-400 text-xs mt-0.5 shrink-0" />
                          <p className="text-xs text-gray-300 leading-relaxed flex-1">{ann.content}</p>
                          <Icon icon="mdi:pencil-outline" className="text-gray-600 group-hover/note:text-gray-400 text-xs shrink-0 mt-0.5 transition-colors" />
                        </div>
                      </div>
                    ) : (
                      <div className="px-3 pb-2.5">
                        <button
                          className="text-[11px] text-gray-600 hover:text-blue-400 flex items-center gap-1 transition-colors"
                          onClick={() => {
                            setEditingAnnotationId(ann.id)
                            setEditingNoteText('')
                          }}
                        >
                          <Icon icon="mdi:plus-circle-outline" className="text-xs" />
                          添加笔记
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AI导读 */}
        {sidebarTab === 'guide' && (
          <AIGuidePanel
            documentId={knowledgeId}
            knowledgeItemId={knowledgeId}
            blocks={blocks}
            fullText={fullText}
            modelConfig={getSelectedSmallModel(getSettings())}
            onBlockClick={(blockId, pageNum) => {
              if (pageNum) {
                setCurrentPage(pageNum)
                setJumpToBlock({ blockId, pageNum })
              }
            }}
          />
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
              onAnnotationUpdate={handleAnnotationUpdate}
              jumpToBlock={jumpToBlock}
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
