'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Chip, Tooltip, Skeleton, Progress } from '@heroui/react'
import { Icon } from '@iconify/react'
import { getKnowledgeItem, getSettings, getSelectedSmallModel } from '@/lib/storage'
import { 
  getPDFFile, 
  savePDFFile, 
  getPDFDocumentByKnowledgeId, 
  savePDFDocument,
  getPDFPagesByDocumentId,
  savePDFPages,
  getTranslation,
  saveTranslation,
} from '@/lib/pdfCache'

export default function ImmersiveReaderPage() {
  const params = useParams()
  const router = useRouter()
  const knowledgeId = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [documentTitle, setDocumentTitle] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  
  // 后台处理状态
  const [processing, setProcessing] = useState(false)
  const [processProgress, setProcessProgress] = useState(0)
  const [processStatus, setProcessStatus] = useState('')
  const [hasTranslation, setHasTranslation] = useState(false)
  
  // 元数据
  const [metadata, setMetadata] = useState<{
    title: string
    authors: string[]
    abstract: string
    year: string
    journal: string
  } | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(true)

  const iframeRef = useRef<HTMLIFrameElement>(null)
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
        const url = URL.createObjectURL(cachedFile.blob)
        setPdfUrl(url)
        setLoading(false)
        return
      }

      // 获取 PDF
      let blob: Blob | null = null

      if (item.sourceType === 'upload' && item.sourceId) {
        // 从 IndexedDB 获取上传的文件
        const { getStoredFile } = await import('@/lib/localFiles')
        const fileRecord = await getStoredFile(item.sourceId)
        if (fileRecord?.blob) {
          blob = fileRecord.blob
        }
      } else if (item.attachmentUrl) {
        // 通过代理获取远程 PDF
        const res = await fetch(`/api/pdf/proxy?url=${encodeURIComponent(item.attachmentUrl)}`)
        if (!res.ok) {
          throw new Error('获取 PDF 失败')
        }
        const data = await res.json()
        // base64 转 blob
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

      // 缓存 PDF 文件
      await savePDFFile(knowledgeId, blob, item.fileName || 'document.pdf')

      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      setLoading(false)

    } catch (err) {
      console.error('Load PDF error:', err)
      setError(err instanceof Error ? err.message : '加载失败')
      setLoading(false)
    }
  }, [knowledgeId])

  // 后台处理：文本提取、智能分块、翻译
  const processPDF = useCallback(async () => {
    if (processedRef.current) return
    processedRef.current = true

    // 检查是否已有翻译缓存
    const existingDoc = await getPDFDocumentByKnowledgeId(knowledgeId)
    if (existingDoc) {
      const translation = await getTranslation(knowledgeId)
      if (translation) {
        setHasTranslation(true)
        const pages = await getPDFPagesByDocumentId(knowledgeId)
        if (pages.length > 0) {
          setTotalPages(pages.length)
        }
        // 从缓存恢复元数据
        setMetadata({
          title: existingDoc.metadata.title,
          authors: existingDoc.metadata.authors,
          abstract: existingDoc.metadata.abstract,
          year: existingDoc.metadata.year,
          journal: existingDoc.metadata.journal,
        })
        setMetadataLoading(false)
        return
      }
    }

    setProcessing(true)
    setProcessStatus('正在提取文本...')
    setProcessProgress(10)

    try {
      const item = getKnowledgeItem(knowledgeId)
      if (!item) return

      const cachedFile = await getPDFFile(knowledgeId)
      if (!cachedFile) {
        setMetadataLoading(false)
        return
      }

      const arrayBuffer = await cachedFile.blob.arrayBuffer()

      // 使用 PDF.js 提取文本
      const { parsePDF } = await import('@/lib/pdfParser')
      const result = await parsePDF(arrayBuffer, knowledgeId, (current, total) => {
        setProcessProgress(10 + (current / total) * 40)
        setProcessStatus(`正在提取文本 ${current}/${total}...`)
      })

      setTotalPages(result.pages.length)
      setProcessProgress(55)
      setProcessStatus('正在保存文档...')

      // 保存文档缓存
      await savePDFDocument({
        id: knowledgeId,
        knowledgeItemId: knowledgeId,
        fileName: cachedFile.fileName,
        pageCount: result.pages.length,
        metadata: {
          title: result.metadata.title || item.title,
          authors: result.metadata.authors?.length ? result.metadata.authors : item.authors,
          abstract: result.metadata.abstract || item.abstract || '',
          year: result.metadata.year || item.year || '',
          journal: result.metadata.journal || item.journal || '',
          keywords: result.metadata.keywords || [],
          references: result.metadata.references || [],
        },
        parsedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // 更新元数据显示
      setMetadata({
        title: result.metadata.title || item.title,
        authors: result.metadata.authors?.length ? result.metadata.authors : item.authors,
        abstract: result.metadata.abstract || item.abstract || '',
        year: result.metadata.year || item.year || '',
        journal: result.metadata.journal || item.journal || '',
      })
      setMetadataLoading(false)

      // 保存页面缓存
      await savePDFPages(result.pages)

      setProcessProgress(60)
      setProcessStatus('正在智能分块...')

      // 准备分块数据
      const allBlocks: { id: string; text: string; type: string }[] = []
      result.pages.forEach(page => {
        page.blocks.forEach(block => {
          if (block.text.trim() && block.type !== 'header' && block.type !== 'footer') {
            allBlocks.push({
              id: block.id,
              text: block.text,
              type: block.type,
            })
          }
        })
      })

      // 获取小模型配置
      const settings = getSettings()
      const modelConfig = getSelectedSmallModel(settings)

      // 智能分块
      let chunks: { id: string; text: string }[] = allBlocks
      try {
        const chunkRes = await fetch('/api/pdf/chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: allBlocks.slice(0, 300), modelConfig }),
        })
        if (chunkRes.ok) {
          const chunkData = await chunkRes.json()
          if (chunkData.chunks?.length) {
            chunks = chunkData.chunks
          }
        }
      } catch {
        // 分块失败，使用原始块
      }

      setProcessProgress(70)
      setProcessStatus('正在翻译...')

      // 批量翻译
      const translateRes = await fetch('/api/pdf/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: knowledgeId, chunks, modelConfig }),
      })

      if (translateRes.ok) {
        setHasTranslation(true)
        setProcessProgress(100)
        setProcessStatus('翻译完成')
      } else {
        setProcessStatus('翻译失败，可稍后重试')
      }

    } catch (err) {
      console.error('Process PDF error:', err)
      setProcessStatus('处理失败')
      setMetadataLoading(false)
    } finally {
      setProcessing(false)
    }
  }, [knowledgeId])

  useEffect(() => {
    loadPDF()
  }, [loadPDF])

  // PDF 加载完成后开始后台处理
  useEffect(() => {
    if (pdfUrl && !loading) {
      // 延迟 1 秒开始后台处理，让用户先看到 PDF
      const timer = setTimeout(() => {
        processPDF()
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [pdfUrl, loading, processPDF])

  // 清理 URL
  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [pdfUrl])

  // 加载状态
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] bg-gray-50">
        <div className="w-96 p-8 bg-white rounded-xl shadow-lg">
          <div className="text-center mb-6">
            <Icon icon="mdi:file-document-outline" className="text-6xl text-primary mb-4" />
            <h2 className="text-xl font-semibold">正在加载 PDF...</h2>
          </div>
          <div className="flex justify-center">
            <Icon icon="mdi:loading" className="text-3xl text-primary animate-spin" />
          </div>
        </div>
      </div>
    )
  }

  // 错误状态
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] bg-gray-50">
        <div className="w-96 p-8 bg-white rounded-xl shadow-lg text-center">
          <Icon icon="mdi:alert-circle-outline" className="text-6xl text-danger mb-4" />
          <h2 className="text-xl font-semibold mb-2">加载失败</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <div className="flex gap-4 justify-center">
            <Button color="primary" onPress={loadPDF}>
              重试
            </Button>
            <Button variant="light" onPress={() => router.back()}>
              返回
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-52px)] bg-gray-100">
      {/* 左侧工具栏 */}
      <div className="w-14 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-2">
        <Tooltip content="返回" placement="right">
          <Button isIconOnly variant="light" onPress={() => router.back()}>
            <Icon icon="mdi:arrow-left" className="text-xl" />
          </Button>
        </Tooltip>

        <div className="w-8 h-px bg-gray-200 my-2" />

        <Tooltip content="上一页" placement="right">
          <Button
            isIconOnly
            variant="light"
            onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
            isDisabled={currentPage <= 1}
          >
            <Icon icon="mdi:chevron-up" className="text-xl" />
          </Button>
        </Tooltip>

        <Tooltip content="下一页" placement="right">
          <Button
            isIconOnly
            variant="light"
            onPress={() => setCurrentPage(p => p + 1)}
            isDisabled={!totalPages || currentPage >= totalPages}
          >
            <Icon icon="mdi:chevron-down" className="text-xl" />
          </Button>
        </Tooltip>

        <div className="w-8 h-px bg-gray-200 my-2" />

        {/* 处理状态指示 */}
        {processing && (
          <Tooltip content={processStatus} placement="right">
            <div className="flex flex-col items-center">
              <Icon icon="mdi:sync" className="text-xl text-primary animate-spin" />
              <span className="text-xs text-gray-500 mt-1">{Math.round(processProgress)}%</span>
            </div>
          </Tooltip>
        )}

        {hasTranslation && !processing && (
          <Tooltip content="翻译已完成" placement="right">
            <Icon icon="mdi:check-circle" className="text-xl text-success" />
          </Tooltip>
        )}

        <div className="mt-auto flex flex-col items-center gap-2">
          {totalPages > 0 && (
            <span className="text-xs text-gray-400">{currentPage}/{totalPages}</span>
          )}
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部信息栏 */}
        <div className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* 标题 */}
              {metadataLoading ? (
                <Skeleton className="h-6 w-3/4 rounded-lg" />
              ) : (
                <h1 className="text-lg font-semibold truncate">
                  {metadata?.title || documentTitle}
                </h1>
              )}
              
              {/* 作者 */}
              <div className="mt-1">
                {metadataLoading ? (
                  <Skeleton className="h-4 w-1/2 rounded-lg" />
                ) : (
                  <p className="text-sm text-gray-500">
                    {metadata?.authors?.length ? metadata.authors.join(', ') : ''}
                    {metadata?.year && ` (${metadata.year})`}
                    {metadata?.journal && ` - ${metadata.journal}`}
                  </p>
                )}
              </div>

              {/* 摘要 */}
              {(metadataLoading || metadata?.abstract) && (
                <div className="mt-2">
                  {metadataLoading ? (
                    <div className="space-y-1">
                      <Skeleton className="h-3 w-full rounded" />
                      <Skeleton className="h-3 w-full rounded" />
                      <Skeleton className="h-3 w-3/4 rounded" />
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600 line-clamp-3">
                      {metadata?.abstract}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 处理进度 */}
            {processing && (
              <div className="w-48 flex-shrink-0">
                <Progress 
                  value={processProgress} 
                  size="sm" 
                  color="primary"
                  className="mb-1"
                />
                <p className="text-xs text-gray-500 text-center">{processStatus}</p>
              </div>
            )}
          </div>
        </div>

        {/* PDF 查看器 */}
        <div className="flex-1 overflow-auto p-4">
          {pdfUrl && (
            <iframe
              ref={iframeRef}
              src={pdfUrl}
              className="w-full h-full min-h-[800px] border-0 rounded-lg shadow-lg"
              title="PDF Viewer"
            />
          )}
        </div>
      </div>
    </div>
  )
}