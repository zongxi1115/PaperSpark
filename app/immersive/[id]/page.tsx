'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button, Progress, Chip, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { getKnowledgeItem, getSettings, getSelectedSmallModel } from '@/lib/storage'
import { 
  getPDFDocumentByKnowledgeId, 
  getPDFPagesByDocumentId, 
  getTranslation,
  savePDFDocument,
  savePDFPages,
  saveTranslation,
  hasImmersiveCache 
} from '@/lib/pdfCache'
import { parsePDFFromBase64, parsePDFFromURL } from '@/lib/pdfParser'
import type { TextBlock, PDFPageCache, ModelConfig } from '@/lib/types'

type ProcessStatus = 'idle' | 'parsing' | 'chunking' | 'translating' | 'done' | 'error'

export default function ImmersiveReaderPage() {
  const params = useParams()
  const router = useRouter()
  const knowledgeId = params.id as string

  const [status, setStatus] = useState<ProcessStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [pages, setPages] = useState<PDFPageCache[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [showChinese, setShowChinese] = useState(true)
  const [scale, setScale] = useState(1.5)
  const [documentTitle, setDocumentTitle] = useState('')

  // 检查缓存并加载数据
  const loadDocument = useCallback(async () => {
    setStatus('parsing')
    setProgressText('正在检查缓存...')

    try {
      // 获取知识库条目
      const item = getKnowledgeItem(knowledgeId)
      if (!item) {
        setError('未找到文档')
        setStatus('error')
        return
      }
      setDocumentTitle(item.title)

      // 检查是否已有完整缓存
      const hasCache = await hasImmersiveCache(knowledgeId)
      
      if (hasCache) {
        setProgressText('正在加载缓存...')
        const doc = await getPDFDocumentByKnowledgeId(knowledgeId)
        if (doc) {
          const cachedPages = await getPDFPagesByDocumentId(doc.id)
          setPages(cachedPages)
          setStatus('done')
          return
        }
      }

      // 没有缓存，需要解析 PDF
      setProgressText('正在解析 PDF...')
      setProgress(10)

      // 获取 PDF 数据
      let pdfBase64: string | null = null
      let pdfUrl: string | null = null

      if (item.sourceType === 'upload' && item.sourceId) {
        // 从 IndexedDB 获取上传的文件
        const { getStoredFile } = await import('@/lib/localFiles')
        const fileRecord = await getStoredFile(item.sourceId)
        if (fileRecord?.blob) {
          // 转换为 base64
          const arrayBuffer = await fileRecord.blob.arrayBuffer()
          const uint8Array = new Uint8Array(arrayBuffer)
          let binary = ''
          for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i])
          }
          pdfBase64 = btoa(binary)
        }
      } else if (item.attachmentUrl) {
        pdfUrl = item.attachmentUrl
      }

      if (!pdfBase64 && !pdfUrl) {
        setError('无法获取 PDF 文件')
        setStatus('error')
        return
      }

      // 在客户端解析 PDF
      setProgressText('正在提取文本...')
      setProgress(20)

      let parseResult
      if (pdfBase64) {
        parseResult = await parsePDFFromBase64(pdfBase64, knowledgeId, (current, total) => {
          const pct = 20 + (current / total) * 30
          setProgress(pct)
          setProgressText(`正在解析第 ${current}/${total} 页...`)
        })
      } else if (pdfUrl) {
        parseResult = await parsePDFFromURL(pdfUrl, knowledgeId, (current, total) => {
          const pct = 20 + (current / total) * 30
          setProgress(pct)
          setProgressText(`正在解析第 ${current}/${total} 页...`)
        })
      }

      if (!parseResult) {
        throw new Error('PDF 解析失败')
      }

      setProgress(50)

      // 保存文档缓存到 IndexedDB
      await savePDFDocument({
        id: knowledgeId,
        knowledgeItemId: knowledgeId,
        fileName: item.fileName || 'unknown.pdf',
        pageCount: parseResult.pages.length,
        metadata: {
          title: parseResult.metadata.title || item.title,
          authors: parseResult.metadata.authors || item.authors,
          abstract: parseResult.metadata.abstract || item.abstract || '',
          year: parseResult.metadata.year || item.year || '',
          journal: parseResult.metadata.journal || '',
          keywords: parseResult.metadata.keywords || [],
          references: parseResult.metadata.references || [],
        },
        parsedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      // 保存页面缓存
      await savePDFPages(parseResult.pages)

      setProgress(60)
      setProgressText('正在智能分块...')

      // 准备分块数据
      const allBlocks: { id: string; text: string; type: string }[] = []
      parseResult.pages.forEach(page => {
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
      const chunkRes = await fetch('/api/pdf/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: allBlocks.slice(0, 200), modelConfig }),
      })

      setProgress(70)
      setProgressText('正在翻译...')

      let chunks: { id: string; text: string }[] = []
      if (chunkRes.ok) {
        const chunkData = await chunkRes.json()
        chunks = chunkData.chunks || allBlocks
      } else {
        chunks = allBlocks
      }

      // 批量翻译
      const translateRes = await fetch('/api/pdf/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: knowledgeId, chunks, modelConfig }),
      })

      if (!translateRes.ok) {
        const errData = await translateRes.json()
        throw new Error(errData.error || '翻译失败')
      }

      // 重新加载页面数据
      const finalPages = await getPDFPagesByDocumentId(knowledgeId)
      setPages(finalPages)
      setStatus('done')
      setProgress(100)
      setProgressText('完成')

    } catch (err) {
      console.error('Load document error:', err)
      setError(err instanceof Error ? err.message : '加载失败')
      setStatus('error')
    }
  }, [knowledgeId])

  useEffect(() => {
    loadDocument()
  }, [loadDocument])

  // 渲染文本块
  const renderBlocks = (page: PDFPageCache) => {
    return page.blocks.map((block) => {
      // 跳过页眉页脚
      if (block.type === 'header' || block.type === 'footer') {
        return null
      }

      const displayText = showChinese && block.translated ? block.translated : block.text
      const isTranslated = showChinese && block.translated

      return (
        <div
          key={block.id}
          className="text-block absolute select-text"
          style={{
            left: block.bbox.x * scale,
            top: block.bbox.y * scale,
            width: block.bbox.width * scale,
            minHeight: block.bbox.height * scale,
            fontSize: block.style.fontSize * scale * 0.8,
            fontFamily: isTranslated ? 'system-ui, sans-serif' : block.style.fontFamily,
            fontWeight: block.style.isBold ? 'bold' : 'normal',
            fontStyle: block.style.isItalic ? 'italic' : 'normal',
            color: isTranslated ? '#1a1a1a' : '#333',
            lineHeight: 1.4,
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {displayText}
        </div>
      )
    })
  }

  // 加载状态
  if (status === 'idle' || status === 'parsing' || status === 'chunking' || status === 'translating') {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] bg-gray-50">
        <div className="w-96 p-8 bg-white rounded-xl shadow-lg">
          <div className="text-center mb-6">
            <Icon icon="mdi:file-document-outline" className="text-6xl text-primary mb-4" />
            <h2 className="text-xl font-semibold">{documentTitle || '正在加载...'}</h2>
          </div>
          <Progress 
            value={progress} 
            className="mb-4" 
            color="primary"
            size="sm"
          />
          <p className="text-center text-gray-500">{progressText}</p>
        </div>
      </div>
    )
  }

  // 错误状态
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-52px)] bg-gray-50">
        <div className="w-96 p-8 bg-white rounded-xl shadow-lg text-center">
          <Icon icon="mdi:alert-circle-outline" className="text-6xl text-danger mb-4" />
          <h2 className="text-xl font-semibold mb-2">加载失败</h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <div className="flex gap-4 justify-center">
            <Button color="primary" onPress={loadDocument}>
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

  // 正常渲染
  const currentPgData = pages.find(p => p.pageNum === currentPage)

  return (
    <div className="flex h-[calc(100vh-52px)] bg-gray-100">
      {/* 左侧工具栏 */}
      <div className="w-14 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-2">
        <Tooltip content="返回" placement="right">
          <Button
            isIconOnly
            variant="light"
            onPress={() => router.back()}
          >
            <Icon icon="mdi:arrow-left" className="text-xl" />
          </Button>
        </Tooltip>

        <div className="w-8 h-px bg-gray-200 my-2" />

        <Tooltip content={showChinese ? "显示原文" : "显示译文"} placement="right">
          <Button
            isIconOnly
            color={showChinese ? "primary" : "default"}
            variant={showChinese ? "solid" : "light"}
            onPress={() => setShowChinese(!showChinese)}
          >
            <Icon icon="mdi:translate" className="text-xl" />
          </Button>
        </Tooltip>

        <Tooltip content="放大" placement="right">
          <Button
            isIconOnly
            variant="light"
            onPress={() => setScale(s => Math.min(s + 0.25, 3))}
            isDisabled={scale >= 3}
          >
            <Icon icon="mdi:magnify-plus" className="text-xl" />
          </Button>
        </Tooltip>

        <Tooltip content="缩小" placement="right">
          <Button
            isIconOnly
            variant="light"
            onPress={() => setScale(s => Math.max(s - 0.25, 0.5))}
            isDisabled={scale <= 0.5}
          >
            <Icon icon="mdi:magnify-minus" className="text-xl" />
          </Button>
        </Tooltip>

        <div className="mt-auto flex flex-col gap-2">
          <Chip size="sm" variant="flat">
            {scale.toFixed(2)}x
          </Chip>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* 页面控制 */}
          <div className="flex items-center justify-between mb-4 bg-white rounded-lg p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
                isDisabled={currentPage <= 1}
              >
                <Icon icon="mdi:chevron-left" />
              </Button>
              <span className="text-sm">
                第 {currentPage} / {pages.length} 页
              </span>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => setCurrentPage(p => Math.min(pages.length, p + 1))}
                isDisabled={currentPage >= pages.length}
              >
                <Icon icon="mdi:chevron-right" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              {showChinese && (
                <Chip size="sm" color="primary" variant="flat">
                  译文模式
                </Chip>
              )}
              {!showChinese && (
                <Chip size="sm" variant="flat">
                  原文模式
                </Chip>
              )}
            </div>
          </div>

          {/* PDF 页面渲染 */}
          {currentPgData && (
            <div
              className="bg-white shadow-lg mx-auto relative"
              style={{
                width: currentPgData.width * scale,
                height: currentPgData.height * scale,
              }}
            >
              {renderBlocks(currentPgData)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
