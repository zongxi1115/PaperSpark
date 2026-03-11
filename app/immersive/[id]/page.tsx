'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Chip, Tooltip, Skeleton, Progress, Tabs, Tab } from '@heroui/react'
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
  const [scale, setScale] = useState(1)
  const [sidebarTab, setSidebarTab] = useState('info')
  
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
      const url = URL.createObjectURL(blob)
      setPdfUrl(url)
      setLoading(false)

    } catch (err) {
      console.error('Load PDF error:', err)
      setError(err instanceof Error ? err.message : '加载失败')
      setLoading(false)
    }
  }, [knowledgeId])

  // 后台处理
  const processPDF = useCallback(async () => {
    if (processedRef.current) return
    processedRef.current = true

    const existingDoc = await getPDFDocumentByKnowledgeId(knowledgeId)
    if (existingDoc) {
      const translation = await getTranslation(knowledgeId)
      if (translation) {
        setHasTranslation(true)
        const pages = await getPDFPagesByDocumentId(knowledgeId)
        if (pages.length > 0) {
          setTotalPages(pages.length)
        }
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

      const { parsePDF } = await import('@/lib/pdfParser')
      const result = await parsePDF(arrayBuffer, knowledgeId, (current, total) => {
        setProcessProgress(10 + (current / total) * 40)
        setProcessStatus(`提取文本 ${current}/${total}...`)
      })

      setTotalPages(result.pages.length)
      setProcessProgress(55)
      setProcessStatus('保存文档...')

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

      setMetadata({
        title: result.metadata.title || item.title,
        authors: result.metadata.authors?.length ? result.metadata.authors : item.authors,
        abstract: result.metadata.abstract || item.abstract || '',
        year: result.metadata.year || item.year || '',
        journal: result.metadata.journal || item.journal || '',
      })
      setMetadataLoading(false)

      await savePDFPages(result.pages)

      setProcessProgress(60)
      setProcessStatus('智能分块...')

      const allBlocks: { id: string; text: string; type: string }[] = []
      result.pages.forEach(page => {
        page.blocks.forEach(block => {
          if (block.text.trim() && block.type !== 'header' && block.type !== 'footer') {
            allBlocks.push({ id: block.id, text: block.text, type: block.type })
          }
        })
      })

      const settings = getSettings()
      const modelConfig = getSelectedSmallModel(settings)

      let chunks = allBlocks
      try {
        const chunkRes = await fetch('/api/pdf/chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: allBlocks.slice(0, 300), modelConfig }),
        })
        if (chunkRes.ok) {
          const chunkData = await chunkRes.json()
          if (chunkData.chunks?.length) chunks = chunkData.chunks
        }
      } catch { /* ignore */ }

      setProcessProgress(70)
      setProcessStatus('翻译中...')

      const translateRes = await fetch('/api/pdf/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: knowledgeId, chunks, modelConfig }),
      })

      if (translateRes.ok) {
        setHasTranslation(true)
        setProcessProgress(100)
        setProcessStatus('完成')
      } else {
        setProcessStatus('翻译失败')
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

  useEffect(() => {
    if (pdfUrl && !loading) {
      const timer = setTimeout(() => processPDF(), 1500)
      return () => clearTimeout(timer)
    }
  }, [pdfUrl, loading, processPDF])

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [pdfUrl])

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

        <Tooltip content="批注" placement="right">
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

        {/* 处理状态 */}
        {processing && (
          <Tooltip content={processStatus} placement="right">
            <div className="flex flex-col items-center p-2">
              <Icon icon="mdi:sync" className="text-xl text-blue-400 animate-spin" />
              <span className="text-[10px] text-gray-500 mt-1">{Math.round(processProgress)}%</span>
            </div>
          </Tooltip>
        )}

        {hasTranslation && !processing && (
          <Tooltip content="翻译已完成" placement="right">
            <Icon icon="mdi:check-circle" className="text-xl text-green-500" />
          </Tooltip>
        )}
      </div>

      {/* 左侧面板 */}
      {sidebarTab !== 'none' && (
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

              {/* 处理进度 */}
              {processing && (
                <div className="mt-6 p-3 bg-[#1a1a1a] rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon icon="mdi:sync" className="text-blue-400 animate-spin" />
                    <span className="text-xs text-gray-400">{processStatus}</span>
                  </div>
                  <Progress value={processProgress} size="sm" color="primary" />
                </div>
              )}
            </div>
          )}

          {/* 翻译结果 */}
          {sidebarTab === 'translate' && (
            <div className="flex-1 overflow-auto p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">翻译结果</h3>
              
              {processing && !hasTranslation && (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <Icon icon="mdi:sync" className="text-3xl animate-spin mb-2" />
                  <p className="text-sm">正在翻译中...</p>
                  <Progress value={processProgress} size="sm" color="primary" className="w-32 mt-2" />
                </div>
              )}

              {!processing && !hasTranslation && (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <Icon icon="mdi:translate" className="text-3xl mb-2" />
                  <p className="text-sm">尚未翻译</p>
                  <Button size="sm" color="primary" variant="flat" className="mt-2" onPress={processPDF}>
                    开始翻译
                  </Button>
                </div>
              )}

              {hasTranslation && (
                <div className="text-sm text-gray-400">
                  <p className="text-green-400 mb-2">✓ 翻译已完成</p>
                  <p className="text-xs">点击文档中的段落查看翻译</p>
                </div>
              )}
            </div>
          )}

          {/* 批注 */}
          {sidebarTab === 'notes' && (
            <div className="flex-1 overflow-auto p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">批注</h3>
              <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                <Icon icon="mdi:comment-text-outline" className="text-3xl mb-2" />
                <p className="text-sm">暂无批注</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部工具栏 */}
        <div className="h-10 bg-[#252525] border-b border-[#333] flex items-center px-3 gap-2">
          <div className="flex items-center gap-1">
            <Tooltip content="缩小">
              <Button isIconOnly size="sm" variant="light" className="text-gray-400 hover:text-white min-w-8 h-8" onPress={() => setScale(s => Math.max(0.5, s - 0.25))}>
                <Icon icon="mdi:magnify-minus" className="text-lg" />
              </Button>
            </Tooltip>
            <span className="text-xs text-gray-500 w-12 text-center">{Math.round(scale * 100)}%</span>
            <Tooltip content="放大">
              <Button isIconOnly size="sm" variant="light" className="text-gray-400 hover:text-white min-w-8 h-8" onPress={() => setScale(s => Math.min(3, s + 0.25))}>
                <Icon icon="mdi:magnify-plus" className="text-lg" />
              </Button>
            </Tooltip>
            <Tooltip content="适应宽度">
              <Button isIconOnly size="sm" variant="light" className="text-gray-400 hover:text-white min-w-8 h-8" onPress={() => setScale(1)}>
                <Icon icon="mdi:fit-to-width" className="text-lg" />
              </Button>
            </Tooltip>
          </div>

          <div className="w-px h-5 bg-[#444] mx-2" />

          {/* 翻译切换 */}
          <Tooltip content="显示翻译">
            <Button 
              isIconOnly 
              size="sm" 
              variant="light" 
              className="text-gray-400 hover:text-white min-w-8 h-8"
            >
              <Icon icon="mdi:translate" className="text-lg" />
            </Button>
          </Tooltip>

          <div className="flex-1" />

          {/* 页码 */}
          <div className="flex items-center gap-2">
            <Tooltip content="上一页">
              <Button isIconOnly size="sm" variant="light" className="text-gray-400 hover:text-white min-w-8 h-8" onPress={() => setCurrentPage(p => Math.max(1, p - 1))} isDisabled={currentPage <= 1}>
                <Icon icon="mdi:chevron-left" className="text-lg" />
              </Button>
            </Tooltip>
            <span className="text-sm text-gray-400 px-2">
              {currentPage} / {totalPages || '?'}
            </span>
            <Tooltip content="下一页">
              <Button isIconOnly size="sm" variant="light" className="text-gray-400 hover:text-white min-w-8 h-8" onPress={() => setCurrentPage(p => Math.min(totalPages || 999, p + 1))} isDisabled={!totalPages || currentPage >= totalPages}>
                <Icon icon="mdi:chevron-right" className="text-lg" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* PDF 查看器 */}
        <div className="flex-1 overflow-auto p-4 flex justify-center">
          {pdfUrl && (
            <div 
              className="bg-white shadow-2xl rounded-sm overflow-hidden"
              style={{ 
                width: `${scale * 100}%`,
                maxWidth: '900px',
                minWidth: '400px'
              }}
            >
              <iframe
                ref={iframeRef}
                src={pdfUrl}
                className="w-full h-[calc(100vh-180px)] border-0"
                title="PDF Viewer"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
