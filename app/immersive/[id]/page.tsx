'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Tooltip, Skeleton, Progress, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
import { getKnowledgeItem, getSettings, getSelectedSmallModel, updateKnowledgeItem, deleteKnowledgeItem, getEmbeddingModelConfig } from '@/lib/storage'
import {
  getPDFDocumentByKnowledgeId,
  savePDFDocument,
  updatePDFDocument,
  getPDFPagesByDocumentId,
  savePDFPages,
  deletePDFFile,
  getTranslation,
  deleteTranslation,
  getAnnotationsByDocumentId,
  deleteAnnotation,
  updateAnnotation,
  getFullTextByKnowledgeId,
  deleteKnowledgeItemCache,
} from '@/lib/pdfCache'
import PDFViewer from '@/components/PDF/PDFViewer'
import HTMLReader from '@/components/PDF/HTMLReader'
import AIGuidePanel from '@/components/Guide/AIGuidePanel'
import ImmersiveChatPanel from '@/components/Assistant/ImmersiveChatPanel'
import ImmersiveCanvasPanel from '@/components/Assistant/ImmersiveCanvasPanel'
import type { KnowledgeItem, TextBlock, PDFAnnotation, TranslationStreamEvent, HighlightColor, TranslationBlockPayload, GuideFocusTarget } from '@/lib/types'
import { HIGHLIGHT_COLORS } from '@/lib/types'
import { parsePDFWithSurya } from '@/lib/suryaParser'
import { indexKnowledgeForRAG, deleteKnowledgeVectors } from '@/lib/rag'

function attachPageMetrics(blocks: TextBlock[], pageWidth: number, pageHeight: number) {
  return blocks.map(block => ({
    ...block,
    sourcePageWidth: block.sourcePageWidth || pageWidth,
    sourcePageHeight: block.sourcePageHeight || pageHeight,
  }))
}

const REFERENCE_SECTION_PATTERN = /^(references|bibliography|参考文献|引用文献|文献引用)$/i
const DOI_PATTERN = /\b(10\.\d{4,9}\/[\w.()/:;+-]+)\b/ig
const URL_PATTERN = /https?:\/\/[^\s<>")\]]+/ig
const ARXIV_PATTERN = /\barXiv:\s*([a-z\-.]+\/\d{7}|\d{4}\.\d{4,5}(?:v\d+)?)\b/i

function normalizeReferenceText(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
}

function stripTrailingLinkPunctuation(value: string) {
  return value.replace(/[),.;\]]+$/, '')
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  values.forEach(value => {
    const normalized = normalizeReferenceText(value)
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return
    seen.add(key)
    result.push(normalized)
  })

  return result
}

function mergeReferenceLists(...lists: Array<string[] | undefined>) {
  return dedupeStrings(lists.flatMap(list => list || []))
}

function extractReferenceLinks(reference: string) {
  const links: Array<{ type: string; url: string }> = []
  const pushLink = (type: string, url: string) => {
    const cleaned = stripTrailingLinkPunctuation(url)
    if (!cleaned || links.some(item => item.url === cleaned)) return
    links.push({ type, url: cleaned })
  }

  const doiMatches = Array.from(reference.matchAll(DOI_PATTERN)).map(match => stripTrailingLinkPunctuation(match[1]))
  doiMatches.forEach(doi => pushLink('DOI', `https://doi.org/${doi}`))

  const urlMatches = Array.from(reference.matchAll(URL_PATTERN)).map(match => stripTrailingLinkPunctuation(match[0]))
  urlMatches.forEach(url => {
    const type = /doi\.org\//i.test(url) ? 'DOI' : 'Link'
    pushLink(type, url)
  })

  const arxivMatch = reference.match(ARXIV_PATTERN)
  if (arxivMatch?.[1]) {
    pushLink('arXiv', `https://arxiv.org/abs/${arxivMatch[1]}`)
  }

  return links
}

function extractReferencesFromBlocks(blocks: TextBlock[]) {
  const orderedBlocks = [...blocks].sort((left, right) => {
    if (left.pageNum !== right.pageNum) return left.pageNum - right.pageNum
    if ((left.order ?? 0) !== (right.order ?? 0)) return (left.order ?? 0) - (right.order ?? 0)
    if (left.bbox.y !== right.bbox.y) return left.bbox.y - right.bbox.y
    return left.bbox.x - right.bbox.x
  })

  let inReferenceSection = false
  const references: string[] = []

  orderedBlocks.forEach(block => {
    const text = normalizeReferenceText(block.text)
    if (!text) return

    if (block.type === 'title' || block.type === 'subtitle') {
      inReferenceSection = REFERENCE_SECTION_PATTERN.test(text)
      return
    }

    const hasIdentifier = DOI_PATTERN.test(text) || URL_PATTERN.test(text) || ARXIV_PATTERN.test(text)
    DOI_PATTERN.lastIndex = 0
    URL_PATTERN.lastIndex = 0

    const looksLikeReference =
      block.type === 'reference' ||
      block.sourceLabel === 'Footnote' ||
      (inReferenceSection && ['paragraph', 'list', 'caption'].includes(block.type)) ||
      (hasIdentifier && text.length > 32)

    if (!looksLikeReference) return
    if (text.length < 24) return
    references.push(text)
  })

  return dedupeStrings(references)
}

export default function ImmersiveReaderPage() {
  const params = useParams()
  const router = useRouter()
  const knowledgeId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [documentTitle, setDocumentTitle] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [readerMode, setReaderMode] = useState<'pdf' | 'html'>('pdf')
  const [sidebarTab, setSidebarTab] = useState<'info' | 'translate' | 'notes' | 'guide' | 'qa' | 'canvas'>('guide')
  const [sidebarWidth, setSidebarWidth] = useState(288) // 288px = 72 * 4

  // PDF 数据
  const [blocks, setBlocks] = useState<TextBlock[]>([])
  const [translatedBlocks, setTranslatedBlocks] = useState<Map<string, string>>(new Map())
  const [fullText, setFullText] = useState<string>('')

  // 跳转控制
  const [jumpToBlock, setJumpToBlock] = useState<{ blockId: string; pageNum: number } | null>(null)
  const [focusedGuideTarget, setFocusedGuideTarget] = useState<GuideFocusTarget | null>(null)
  const [focusOverlayMode, setFocusOverlayMode] = useState<'block' | 'sentence'>('block')
  const [selectionQuestionContext, setSelectionQuestionContext] = useState<{
    id: string
    text: string
    pageNum: number
    blockId?: string
  } | null>(null)

  // 翻译状态
  const [translating, setTranslating] = useState(false)
  const [translationProgress, setTranslationProgress] = useState({ current: 0, total: 0 })
  const [showTranslation, setShowTranslation] = useState(false)
  const [hasTranslation, setHasTranslation] = useState(false)
  const [translationDisplayMode, setTranslationDisplayMode] = useState<'overlay' | 'parallel'>('overlay')
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
  const pdfBlobRef = useRef<Blob | null>(null)
  const pdfFileNameRef = useRef<string>('document.pdf')

  // 删除确认弹窗
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure()
  const [deleting, setDeleting] = useState(false)

  // 删除文档
  const handleDeleteDocument = useCallback(async () => {
    setDeleting(true)
    try {
      // 删除本地缓存（PDF文件、文档缓存、页面、翻译、批注、导读、向量）
      await deleteKnowledgeItemCache(knowledgeId)
      // 删除远程向量数据库
      await deleteKnowledgeVectors(knowledgeId)
      // 删除知识库条目
      deleteKnowledgeItem(knowledgeId)

      addToast({ title: '文档已删除', color: 'success' })
      onDeleteClose()
      router.push('/documents')
    } catch (error) {
      console.error('Delete document error:', error)
      addToast({ title: '删除失败', color: 'danger' })
    } finally {
      setDeleting(false)
    }
  }, [knowledgeId, onDeleteClose, router])

  const buildRAGIndex = useCallback(async (sourceBlocks: TextBlock[], documentUpdatedAt: string) => {
    updateKnowledgeItem(knowledgeId, {
      ragStatus: 'indexing',
      ragError: '',
    })

    const settings = getSettings()
    const embeddingConfig = getEmbeddingModelConfig(settings)

    const result = await indexKnowledgeForRAG({
      documentId: knowledgeId,
      blocks: sourceBlocks,
      embeddingConfig,
    })

    if (result.success) {
      updateKnowledgeItem(knowledgeId, {
        ragStatus: 'indexed',
        ragIndexedAt: new Date().toISOString(),
        ragChunks: result.count,
        ragStoredLocally: result.storedLocally,
        ragError: '',
        ragDocumentUpdatedAt: documentUpdatedAt,
      })
      return
    }

    updateKnowledgeItem(knowledgeId, {
      ragStatus: 'failed',
      ragError: result.error || 'RAG 建库失败',
    })
  }, [knowledgeId])

  const resolvePdfSource = useCallback(async (item: KnowledgeItem) => {
    const guessFileName = () => {
      const raw = item.attachmentFileName || item.fileName || item.title || 'document'
      const normalized = raw.trim() || 'document'
      return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`
    }

    if (item.sourceType === 'upload' && item.sourceId) {
      const { getStoredFile } = await import('@/lib/localFiles')
      const fileRecord = await getStoredFile(item.sourceId)
      if (!fileRecord?.blob) return null
      return { blob: fileRecord.blob, fileName: fileRecord.name || guessFileName() }
    }

    const remoteUrl = item.attachmentUrl || (item.sourceType === 'url' ? item.url : undefined)
    if (!remoteUrl) return null

    const fileName = guessFileName()
    const res = await fetch(
      `/api/pdf/proxy?url=${encodeURIComponent(remoteUrl)}&filename=${encodeURIComponent(fileName)}`,
      { cache: 'no-store' },
    )

    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      throw new Error(payload?.error || '获取 PDF 失败')
    }

    return { blob: await res.blob(), fileName }
  }, [])

  // 加载 PDF 文件
  const loadPDF = useCallback(async () => {
    processedRef.current = false
    pdfBlobRef.current = null
    pdfFileNameRef.current = 'document.pdf'

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

      const resolved = await resolvePdfSource(item)
      if (!resolved?.blob) {
        setError('无法获取 PDF 文件')
        setLoading(false)
        return
      }

      pdfBlobRef.current = resolved.blob
      pdfFileNameRef.current = resolved.fileName

      // 存储 Blob 而不是 ArrayBuffer，避免 ArrayBuffer 被 PDF.js Worker detach 后无法重用
      setPdfBlob(resolved.blob)
      // 不再缓存原始 PDF blob（历史版本可能写入过，顺手清理）
      void deletePDFFile(knowledgeId)
      setLoading(false)

    } catch (err) {
      console.error('Load PDF error:', err)
      setError(err instanceof Error ? err.message : '加载失败')
      setLoading(false)
    }
  }, [knowledgeId, resolvePdfSource])

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
    const pictureBlockIds = new Set(
      existingPages.flatMap(page =>
        page.blocks
          .filter(block => block.sourceLabel === 'Picture')
          .map(block => block.id),
      ),
    )
    const missingPictureBlocks =
      existingDoc?.parser === 'surya' &&
      existingDoc?.parseStatus === 'completed' &&
      Number(existingDoc?.structureCounts?.Picture || 0) > 0 &&
      pictureBlockIds.size === 0
    const hasCompletedSuryaCache =
      existingDoc?.parser === 'surya' &&
      existingDoc?.parseStatus === 'completed' &&
      existingPages.length > 0 &&
      !missingPictureBlocks
    setSuryaReady(hasCompletedSuryaCache)

    // 同步缓存状态到 localStorage（修复缓存标记与实际数据不一致的问题）
    if (item.hasImmersiveCache !== hasCompletedSuryaCache) {
      updateKnowledgeItem(knowledgeId, { hasImmersiveCache: hasCompletedSuryaCache })
    }

    const cachedBlocks = existingPages.flatMap(page => attachPageMetrics(page.blocks, page.width, page.height))
    const extractedCachedReferences = extractReferencesFromBlocks(cachedBlocks)

    if (existingDoc) {
      if (existingDoc.parser === 'surya') {
        const translation = await getTranslation(knowledgeId)
        if (translation) {
          const visibleBlocks = translation.blocks.filter(block => !pictureBlockIds.has(block.blockId))
          setHasTranslation(visibleBlocks.length > 0)
          const transMap = new Map(visibleBlocks.map(b => [b.blockId, b.translated]))
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
        setBlocks(cachedBlocks)
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

      const mergedReferences = mergeReferenceLists(existingDoc.metadata.references || [], extractedCachedReferences)

      if (mergedReferences.length !== (existingDoc.metadata.references || []).length) {
        await updatePDFDocument(knowledgeId, {
          metadata: {
            ...existingDoc.metadata,
            references: mergedReferences,
          },
        })
      }

      setMetadata({
        title: existingDoc.metadata.title,
        authors: existingDoc.metadata.authors,
        abstract: existingDoc.metadata.abstract,
        year: existingDoc.metadata.year,
        journal: existingDoc.metadata.journal,
        references: mergedReferences,
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
      if (item.ragStatus !== 'indexed' || item.ragDocumentUpdatedAt !== existingDoc.updatedAt) {
        const cachedBlocks = existingPages.flatMap(p => attachPageMetrics(p.blocks, p.width, p.height))
      void buildRAGIndex(cachedBlocks, existingDoc.updatedAt)
      }

      // 自动构建知识图谱（如果还没有构建过）
      void (async () => {
        const { autoGraphBuild, shouldAutoGraphBuild } = await import('@/lib/autoGraph')
        const fullTextContent = await getFullTextByKnowledgeId(knowledgeId)
        if (shouldAutoGraphBuild(item)) {
        const graphResult = await autoGraphBuild(item, fullTextContent || undefined)
        if (graphResult.success) {
            console.log('[AutoGraph] Knowledge graph built successfully')
          } else {
            console.warn('[AutoGraph] Failed to build graph:', graphResult.error)
       }
        }
      })()

      return
    }

    setStructureParsing(true)
    setMetadataLoading(!existingDoc)
    try {
      const fallbackFileName = (() => {
        const raw = item.attachmentFileName || item.fileName || item.title || 'document'
        const normalized = raw.trim() || 'document'
        return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`
      })()

      let fileName = pdfFileNameRef.current || fallbackFileName
      let fileBlob: Blob | null =
        pdfBlobRef.current ||
        pdfBlob

      if (!fileBlob) {
        const resolved = await resolvePdfSource(item)
        if (resolved?.blob) {
          fileBlob = resolved.blob
          fileName = resolved.fileName || fileName
        }
      }

      if (!fileBlob) {
        setMetadataLoading(false)
        return
      }

      pdfBlobRef.current = fileBlob
      pdfFileNameRef.current = fileName

      const fallbackMetadata = {
        title: existingDoc?.metadata.title || item.title,
        authors: existingDoc?.metadata.authors?.length ? existingDoc.metadata.authors : item.authors,
        abstract: existingDoc?.metadata.abstract || item.abstract || '',
        year: existingDoc?.metadata.year || item.year || '',
        journal: existingDoc?.metadata.journal || item.journal || '',
        keywords: existingDoc?.metadata.keywords || [],
        references: mergeReferenceLists(existingDoc?.metadata.references || [], extractedCachedReferences),
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
          fileName,
          pageCount: existingPages.length,
          metadata: fallbackMetadata,
          parser: 'surya',
          parseStatus: 'processing',
          parsedAt: now,
          updatedAt: now,
        })
      }

      const metadataModelConfig = getSelectedSmallModel(getSettings())
      const result = await parsePDFWithSurya({
        documentId: knowledgeId,
        fileBlob,
        fileName,
        keepOutputs: false,
        includeMetadata: Boolean(metadataModelConfig?.apiKey && metadataModelConfig?.modelName),
        modelConfig: metadataModelConfig || undefined,
      })

      setTotalPages(result.pages.length)
      const allBlocks = result.pages.flatMap(p => attachPageMetrics(p.blocks, p.width, p.height))
      setBlocks(allBlocks)
      setSuryaReady(true)

      const extractedReferences = extractReferencesFromBlocks(allBlocks)

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
        keywords: dedupeStrings(result.metadata.keywords || []),
        references: mergeReferenceLists(result.metadata.references || [], extractedReferences),
      }
      const parsedAt = new Date().toISOString()

      await savePDFDocument({
        id: knowledgeId,
        knowledgeItemId: knowledgeId,
        fileName,
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
      void buildRAGIndex(allBlocks, parsedAt)

      // 自动构建知识图谱
      void (async () => {
        const { autoGraphBuild, shouldAutoGraphBuild } = await import('@/lib/autoGraph')
        if (shouldAutoGraphBuild(item)) {
          const graphResult = await autoGraphBuild(item, result.fullText)
          if (graphResult.success) {
       console.log('[AutoGraph] Knowledge graph built successfully')
          } else {
         console.warn('[AutoGraph] Failed to build graph:', graphResult.error)
          }
        }
      })()

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
  }, [buildRAGIndex, knowledgeId, pdfBlob, resolvePdfSource])

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
      sourceLabel: block.sourceLabel,
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
    translated: b.sourceLabel === 'Picture' ? undefined : translatedBlocks.get(b.id),
  }))
  const visibleTranslatedEntries = Array.from(translatedBlocks.entries()).filter(
    ([id]) => blocks.find(block => block.id === id)?.sourceLabel !== 'Picture',
  )
  const canTranslate = suryaReady && !structureParsing && blocks.length > 0
  const canUseHtmlView = suryaReady && blocks.length > 0
  const structurePendingTooltip = '文档结构未完成，请等待解析完成后操作'
  const translateActionTooltip = canTranslate
    ? '开始翻译文档'
    : structurePendingTooltip

  useEffect(() => {
    if (!canUseHtmlView && readerMode === 'html') {
      setReaderMode('pdf')
    }
  }, [canUseHtmlView, readerMode])

  useEffect(() => {
    loadPDF()
  }, [loadPDF])

  useEffect(() => {
    if (pdfBlob && !loading) {
      const timer = setTimeout(() => processPDF(), 500)
      return () => clearTimeout(timer)
    }
  }, [pdfBlob, loading, processPDF])

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

        <Tooltip content="AI问答" placement="right">
          <Button
            isIconOnly
            size="sm"
            variant={sidebarTab === 'qa' ? 'solid' : 'light'}
            color={sidebarTab === 'qa' ? 'primary' : 'default'}
            className={sidebarTab === 'qa' ? '' : 'text-gray-400 hover:text-white'}
            onPress={() => setSidebarTab('qa')}
          >
            <Icon icon="mdi:chat-processing-outline" className="text-xl" />
          </Button>
        </Tooltip>

        <Tooltip content="AI Canvas" placement="right">
          <Button
            isIconOnly
            size="sm"
            variant={sidebarTab === 'canvas' ? 'solid' : 'light'}
            color={sidebarTab === 'canvas' ? 'primary' : 'default'}
            className={sidebarTab === 'canvas' ? '' : 'text-gray-400 hover:text-white'}
            onPress={() => setSidebarTab('canvas')}
          >
            <Icon icon="mdi:draw" className="text-xl" />
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

        <div className="w-6 h-px bg-[#444] my-2" />

        <Tooltip content="删除文档" placement="right">
          <Button
            isIconOnly
            size="sm"
            variant="light"
            className="text-gray-400 hover:text-red-400"
            onPress={onDeleteOpen}
          >
            <Icon icon="mdi:delete-outline" className="text-xl" />
          </Button>
        </Tooltip>
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
                        const links = extractReferenceLinks(ref)

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
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="flat"
                    color={showTranslation ? 'primary' : 'default'}
                    onPress={() => setShowTranslation(!showTranslation)}
                  >
                    {showTranslation ? '隐藏译文' : '显示译文'}
                  </Button>
                  <div className="flex items-center gap-1 rounded-lg border border-[#3a3a3a] bg-[#1a1a1a] p-1">
                    <Button
                      size="sm"
                      variant={translationDisplayMode === 'overlay' ? 'solid' : 'light'}
                      color={translationDisplayMode === 'overlay' ? 'primary' : 'default'}
                      className="min-w-0 px-2"
                      onPress={() => setTranslationDisplayMode('overlay')}
                    >
                      原位
                    </Button>
                    <Button
                      size="sm"
                      variant={translationDisplayMode === 'parallel' ? 'solid' : 'light'}
                      color={translationDisplayMode === 'parallel' ? 'primary' : 'default'}
                      className="min-w-0 px-2"
                      onPress={() => setTranslationDisplayMode('parallel')}
                    >
                      并排
                    </Button>
                  </div>
                </div>
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

            {(visibleTranslatedEntries.length > 0 || hasTranslation) && (
              <div className="space-y-3">
                <p className={`text-xs ${translating ? 'text-blue-400' : 'text-green-400'}`}>
                  {translating ? '实时回显中…' : '✓ 翻译已完成'}
                </p>
                <div className="max-h-96 overflow-auto space-y-2">
                  {visibleTranslatedEntries.slice(0, 20).map(([id, translated]) => {
                    const block = blocks.find(b => b.id === id)
                    return (
                      <div key={id} className="p-2 bg-[#1a1a1a] rounded text-xs">
                        <p className="text-gray-500 mb-1 line-clamp-2">{block?.text?.slice(0, 100)}...</p>
                        <p className="text-gray-300">{translated?.slice(0, 150)}...</p>
                      </div>
                    )
                  })}
                  {visibleTranslatedEntries.length > 20 && (
                    <p className="text-xs text-gray-500 text-center">... 还有 {visibleTranslatedEntries.length - 20} 条</p>
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
            onBlockClick={(target) => {
              if (target.pageNum) {
                setSidebarTab('guide')
                setCurrentPage(target.pageNum)
                setJumpToBlock({ blockId: target.blockId, pageNum: target.pageNum })
                setFocusedGuideTarget(target)
                setFocusOverlayMode('block')
              }
            }}
          />
        )}

        {sidebarTab === 'qa' && (
          <ImmersiveChatPanel
            knowledgeItemId={knowledgeId}
            title={metadata?.title || documentTitle}
            blocks={blocks}
            selectionContext={selectionQuestionContext}
            onCitationClick={(target) => {
              setCurrentPage(target.pageNum)
              setJumpToBlock({ blockId: target.blockId, pageNum: target.pageNum })
              setFocusedGuideTarget(target)
              setFocusOverlayMode('sentence')
            }}
          />
        )}

        {sidebarTab === 'canvas' && (
          <ImmersiveCanvasPanel
            knowledgeItemId={knowledgeId}
            title={metadata?.title || documentTitle}
            fullText={fullText}
            blocks={blocks}
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

          <div className="flex items-center gap-1 rounded-lg border border-[#3a3a3a] bg-[#1a1a1a] p-1">
            <Tooltip content="查看原生 PDF 页面">
              <Button
                isIconOnly
                size="sm"
                variant={readerMode === 'pdf' ? 'solid' : 'light'}
                color={readerMode === 'pdf' ? 'primary' : 'default'}
                className="min-w-8 h-8"
                onPress={() => setReaderMode('pdf')}
              >
                <Icon icon="mdi:file-pdf-box" className="text-lg" />
              </Button>
            </Tooltip>
            <Tooltip content={canUseHtmlView ? '使用 Surya 结构块进入 HTML 阅览模式' : structurePendingTooltip}>
              <span className="inline-flex">
                <Button
                  isIconOnly
                  size="sm"
                  variant={readerMode === 'html' ? 'solid' : 'light'}
                  color={readerMode === 'html' ? 'primary' : 'default'}
                  className="min-w-8 h-8"
                  onPress={() => setReaderMode('html')}
                  isDisabled={!canUseHtmlView}
                >
                  <Icon icon="mdi:text-box-search-outline" className="text-lg" />
                </Button>
              </span>
            </Tooltip>
          </div>

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

          {(hasTranslation || translating || translatedBlocks.size > 0) && (
            <div className="flex items-center gap-1 rounded-lg border border-[#3a3a3a] bg-[#1a1a1a] p-1">
              <Tooltip content={readerMode === 'pdf' ? '译文覆盖在原 PDF 上' : '在原文段落下方显示译文'}>
                <Button
                  isIconOnly
                  size="sm"
                  variant={translationDisplayMode === 'overlay' ? 'solid' : 'light'}
                  color={translationDisplayMode === 'overlay' ? 'primary' : 'default'}
                  className="min-w-8 h-8"
                  onPress={() => setTranslationDisplayMode('overlay')}
                  isDisabled={!showTranslation}
                >
                  <Icon icon="mdi:layers-outline" className="text-lg" />
                </Button>
              </Tooltip>
              <Tooltip content={readerMode === 'pdf' ? '右侧生成对应位置的译文页，图片保持原样' : '按双栏对照阅读原文与译文'}>
                <Button
                  isIconOnly
                  size="sm"
                  variant={translationDisplayMode === 'parallel' ? 'solid' : 'light'}
                  color={translationDisplayMode === 'parallel' ? 'primary' : 'default'}
                  className="min-w-8 h-8"
                  onPress={() => setTranslationDisplayMode('parallel')}
                  isDisabled={!showTranslation}
                >
                  <Icon icon="mdi:view-column-outline" className="text-lg" />
                </Button>
              </Tooltip>
            </div>
          )}

          {!hasTranslation && !translating && (
            <Tooltip content={translateActionTooltip}>
              <span className="inline-flex">
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={startStreamingTranslation}
                  isDisabled={!canTranslate}
                >
                  翻译文档
                </Button>
              </span>
            </Tooltip>
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

        {/* 阅读查看器 */}
        <div className="flex-1 overflow-hidden">
          {pdfBlob ? (
            readerMode === 'pdf' ? (
              <PDFViewer
                pdfBlob={pdfBlob}
                currentPage={currentPage}
                scale={scale}
                documentId={knowledgeId}
                onPageChange={setCurrentPage}
                onTotalPagesChange={setTotalPages}
                blocks={blocksWithTranslation}
                showTranslation={showTranslation}
                translationDisplayMode={translationDisplayMode}
                annotations={annotations}
                onAnnotationAdd={handleAnnotationAdd}
                onAnnotationDelete={handleAnnotationDelete}
                onAnnotationUpdate={handleAnnotationUpdate}
                onAskSelection={(selection) => {
                  setSelectionQuestionContext({
                    id: `${Date.now()}`,
                    text: selection.text,
                    pageNum: selection.pageNum,
                    blockId: selection.blockId,
                  })
                  setSidebarTab('qa')
                }}
                jumpToBlock={jumpToBlock}
                focusTarget={focusedGuideTarget}
                focusOverlayMode={focusOverlayMode}
              />
            ) : (
              <HTMLReader
                pdfBlob={pdfBlob}
                documentId={knowledgeId}
                currentPage={currentPage}
                scale={scale}
                onPageChange={setCurrentPage}
                onTotalPagesChange={setTotalPages}
                blocks={blocksWithTranslation}
                showTranslation={showTranslation}
                translationDisplayMode={translationDisplayMode}
                onAnnotationAdd={handleAnnotationAdd}
                onAskSelection={(selection) => {
                  setSelectionQuestionContext({
                    id: `${Date.now()}`,
                    text: selection.text,
                    pageNum: selection.pageNum,
                    blockId: selection.blockId,
                  })
                  setSidebarTab('qa')
                }}
                jumpToBlock={jumpToBlock}
                focusTarget={focusedGuideTarget}
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>PDF 加载中...</p>
            </div>
          )}
        </div>
      </div>

      {/* 删除确认弹窗 */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose}>
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            <p className="text-gray-300">
              确定要删除文档 <span className="font-medium text-white">{documentTitle}</span> 吗？
            </p>
            <p className="text-sm text-gray-500">
              此操作将删除文档本身、所有翻译缓存、批注和 RAG 索引数据，且无法恢复。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onDeleteClose}>取消</Button>
            <Button color="danger" onPress={handleDeleteDocument} isLoading={deleting}>
              确认删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
