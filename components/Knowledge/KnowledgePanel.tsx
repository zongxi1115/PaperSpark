'use client'
// TODO: fetch下来的文件需要保存到本地，后续沉浸式阅读直接从本地读取，避免重复下载和分析
import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
  Spinner,
  Tooltip,
  Divider,
  addToast,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
} from '@heroui/react'
import {
  getKnowledgeItems,
  addKnowledgeItem,
  updateKnowledgeItem,
  deleteKnowledgeItem,
  getZoteroConfig,
  saveZoteroConfig,
  generateId,
  getSettings,
  getSelectedSmallModel,
  getSelectedLargeModel,
} from '@/lib/storage'
import { storeFile } from '@/lib/localFiles'
import { deleteKnowledgeItemCache } from '@/lib/pdfCache'
import { deleteKnowledgeVectors } from '@/lib/rag'
import type { KnowledgeItem, ZoteroConfig } from '@/lib/types'

function getSourceLabel(item: KnowledgeItem) {
  if (item.sourceType === 'zotero') {
    return item.itemType === 'webpage' ? '网页' : 'Zotero'
  }
  if (item.sourceType === 'literature-search') {
    return '漫游搜索'
  }
  return item.sourceType === 'url' ? 'URL' : '上传'
}

export function KnowledgePanel() {
  const router = useRouter()
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [showTranslated, setShowTranslated] = useState(true) // true 显示中文，false 显示英文
  const [zoteroConfig, setZoteroConfig] = useState<ZoteroConfig | null>(null)
  const [zoteroUserId, setZoteroUserId] = useState('')
  const [zoteroApiKey, setZoteroApiKey] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { isOpen: isDetailOpen, onOpen: onDetailOpen, onClose: onDetailClose } = useDisclosure()
  const { isOpen: isZoteroOpen, onOpen: onZoteroOpen, onClose: onZoteroClose } = useDisclosure()
  const { isOpen: isImportOpen, onOpen: onImportOpen, onClose: onImportClose } = useDisclosure()
  const { isOpen: isDeleteConfirmOpen, onOpen: onDeleteConfirmOpen, onClose: onDeleteConfirmClose } = useDisclosure()
  const [deleting, setDeleting] = useState(false)
  const [itemToDelete, setItemToDelete] = useState<KnowledgeItem | null>(null)

  const getProxiedPdfUrl = useCallback((item: KnowledgeItem, options?: { download?: boolean }) => {
    const remoteUrl = item.attachmentUrl || (item.sourceType === 'url' ? item.url : undefined)
    if (!remoteUrl) return null

    const rawFileName = item.attachmentFileName || item.fileName || item.title || 'document'
    const normalized = rawFileName.trim() || 'document'
    const fileName = normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized}.pdf`

    const params = new URLSearchParams({
      url: remoteUrl,
      filename: fileName,
    })
    if (options?.download) params.set('download', '1')
    return `/api/pdf/proxy?${params.toString()}`
  }, [])

  const handleDownloadPdf = useCallback(async (item: KnowledgeItem) => {
    try {
      if (item.sourceType === 'upload' && item.sourceId) {
        const { getStoredFile } = await import('@/lib/localFiles')
        const record = await getStoredFile(item.sourceId)
        if (!record?.blob) {
          addToast({ title: '未找到本地 PDF 文件', color: 'warning' })
          return
        }

        const url = URL.createObjectURL(record.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = record.name || item.fileName || 'document.pdf'
        a.rel = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return
      }

      const proxyUrl = getProxiedPdfUrl(item, { download: true })
      if (!proxyUrl) {
        addToast({ title: '该条目没有可下载的 PDF', color: 'warning' })
        return
      }

      const a = document.createElement('a')
      a.href = proxyUrl
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch (error) {
      console.error('Download PDF error:', error)
      addToast({ title: '下载失败', color: 'danger' })
    }
  }, [getProxiedPdfUrl])

  // 加载知识库数据
  useEffect(() => {
    setItems(getKnowledgeItems())
    const config = getZoteroConfig()
    if (config) {
      setZoteroConfig(config)
      setZoteroUserId(config.userId)
      setZoteroApiKey(config.apiKey)
    }
  }, [])

  // 同步 Zotero
  const handleSyncZotero = useCallback(async () => {
    if (!zoteroUserId || !zoteroApiKey) {
      addToast({ title: '请先配置 Zotero', color: 'warning' })
      onZoteroOpen()
      return
    }

    setSyncing(true)
    try {
      const settings = getSettings()
      const citationStyle = settings.citationStyle || 'apa'
      const res = await fetch(`/api/zotero/items?userId=${zoteroUserId}&apiKey=${zoteroApiKey}&limit=50&style=${citationStyle}`)
      if (!res.ok) throw new Error('Failed to fetch items')
      
      const data = await res.json()
      const now = new Date().toISOString()
      
      // 将 Zotero 条目转换为知识库条目
      const newItems: KnowledgeItem[] = data.items.map((item: Record<string, unknown>) => ({
        id: generateId(),
        title: item.title as string,
        authors: item.authors as string[],
        abstract: item.abstract as string || '',
        year: item.year as string || '',
        journal: item.journal as string || '',
        doi: item.doi as string || '',
        url: item.url as string || '',
        tags: item.tags as string[] || [],
        sourceType: 'zotero' as const,
        sourceId: item.key as string,
        bib: item.bib as string,
        itemType: item.itemType as string,
        hasAttachment: item.hasAttachment as boolean,
        attachmentUrl: item.attachmentUrl as string,
        attachmentFileName: item.attachmentFileName as string,
        createdAt: now,
        updatedAt: now,
      }))

      // 保存到本地
      newItems.forEach(item => addKnowledgeItem(item))
      
      // 保存配置
      const config: ZoteroConfig = { userId: zoteroUserId, apiKey: zoteroApiKey, lastSync: now }
      saveZoteroConfig(config)
      setZoteroConfig(config)
      
      // 更新列表
      setItems(getKnowledgeItems())
      addToast({ title: `已同步 ${newItems.length} 篇文献`, color: 'success' })
    } catch (error) {
      console.error('Zotero sync error:', error)
      addToast({ title: '同步失败，请检查配置', color: 'danger' })
    } finally {
      setSyncing(false)
    }
  }, [zoteroUserId, zoteroApiKey, onZoteroOpen])

  // 点击条目显示详情
  const handleItemClick = useCallback((item: KnowledgeItem) => {
    setSelectedItem(item)
    setShowTranslated(true) // 默认显示中文翻译
    onDetailOpen()
  }, [onDetailOpen])

  // 打开删除确认弹窗
  const handleDeleteClick = useCallback((item: KnowledgeItem, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setItemToDelete(item)
    onDeleteConfirmOpen()
  }, [onDeleteConfirmOpen])

  // 确认删除条目
  const handleConfirmDelete = useCallback(async () => {
    if (!itemToDelete) return

    setDeleting(true)
    try {
      // 删除本地缓存
      await deleteKnowledgeItemCache(itemToDelete.id)
      // 删除远程向量
      await deleteKnowledgeVectors(itemToDelete.id)
      // 删除知识库条目
      deleteKnowledgeItem(itemToDelete.id)

      setItems(getKnowledgeItems())
      if (selectedItem?.id === itemToDelete.id) {
        setSelectedItem(null)
        onDetailClose()
      }
      addToast({ title: '已删除', color: 'default' })
      onDeleteConfirmClose()
      setItemToDelete(null)
    } catch (error) {
      console.error('Delete error:', error)
      addToast({ title: '删除失败', color: 'danger' })
    } finally {
      setDeleting(false)
    }
  }, [itemToDelete, selectedItem, onDetailClose, onDeleteConfirmClose])

  // 翻译英文摘要
  const handleTranslate = useCallback(async () => {
    if (!selectedItem?.abstract) return
    
    setTranslating(true)
    try {
      const settings = getSettings()
      const smallModelConfig = getSelectedSmallModel(settings)
      const res = await fetch('/api/ai/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: selectedItem.abstract,
          modelConfig: smallModelConfig,
          sourceLang: '英文',
          targetLang: '中文',
          style: '学术',
        }),
      })
      
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Translation failed')
      }
      
      const data = await res.json()
      const translated = data.translated || ''
      
      if (translated) {
        const updatedItem = { ...selectedItem, cachedSummary: translated }
        updateKnowledgeItem(selectedItem.id, { cachedSummary: translated })
        setItems(getKnowledgeItems())
        setSelectedItem(updatedItem)
        addToast({ title: '翻译完成', color: 'success' })
      }
    } catch (error) {
      console.error('Translation error:', error)
      addToast({ title: error instanceof Error ? error.message : '翻译失败', color: 'danger' })
    } finally {
      setTranslating(false)
    }
  }, [selectedItem])

  // 判断是否需要翻译（英文比例过高）
  const needsTranslation = useCallback((text: string) => {
    if (!text) return false
    const englishChars = text.match(/[a-zA-Z]/g) || []
    const ratio = englishChars.length / text.length
    return ratio > 0.6
  }, [])

  // 保存 Zotero 配置
  const handleSaveZoteroConfig = useCallback(() => {
    if (!zoteroUserId || !zoteroApiKey) {
      addToast({ title: '请填写完整配置', color: 'warning' })
      return
    }
    const config: ZoteroConfig = { userId: zoteroUserId, apiKey: zoteroApiKey }
    saveZoteroConfig(config)
    setZoteroConfig(config)
    onZoteroClose()
    addToast({ title: '配置已保存', color: 'success' })
  }, [zoteroUserId, zoteroApiKey, onZoteroClose])

  // 插入引用到文档
  const handleInsert = useCallback((item: KnowledgeItem, e?: React.MouseEvent) => {
    e?.stopPropagation()
    e?.preventDefault()
    
    // 发送引用插入事件
    const event = new CustomEvent('citation-insert', {
      detail: {
        citationId: item.id,
        title: item.title,
        authors: item.authors,
        year: item.year || '',
        journal: item.journal || '',
        doi: item.doi || '',
        url: item.url || '',
        bib: item.bib || '',
      },
    })
    window.dispatchEvent(event)
  }, [])

  // 导入弹窗状态
  const [importTab, setImportTab] = useState<'upload' | 'url'>('upload')
  const [importTitle, setImportTitle] = useState('')
  const [importAbstract, setImportAbstract] = useState('')
  const [importYear, setImportYear] = useState('')
  const [importAuthors, setImportAuthors] = useState('')
  const [importJournal, setImportJournal] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  // 重置导入表单
  const resetImportForm = useCallback(() => {
    setImportTab('upload')
    setImportTitle('')
    setImportAbstract('')
    setImportYear('')
    setImportAuthors('')
    setImportJournal('')
    setPendingFile(null)
    setImportUrl('')
  }, [])

  // 处理文件选择
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPendingFile(file)
      // 默认标题使用文件名（去除扩展名）
      const fileName = file.name.replace(/\.[^/.]+$/, '')
      setImportTitle(fileName)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  // 提交导入
  const handleImportSubmit = useCallback(async () => {
    if (importTab === 'upload' && !pendingFile) {
      addToast({ title: '请选择文件', color: 'warning' })
      return
    }
    if (importTab === 'url' && !importUrl.trim()) {
      addToast({ title: '请输入 URL', color: 'warning' })
      return
    }

    setLoading(true)
    try {
      let data: { fileName: string; fileType: NonNullable<KnowledgeItem['fileType']>; fileSize?: number; url?: string }
      let localFileId: string | undefined
      let fileToProcess = pendingFile

      if (importTab === 'upload' && pendingFile) {
        // 检查是否为 Word 文件，如果是则先转换为 PDF
        const fileName = pendingFile.name.toLowerCase()
        const isWordFile = fileName.endsWith('.doc') || fileName.endsWith('.docx')
        
        if (isWordFile) {
          addToast({ title: '正在将 Word 转换为 PDF...', color: 'primary' })
          
          const convertFormData = new FormData()
          convertFormData.append('file', pendingFile)
          
          const convertRes = await fetch('/api/knowledge/convert-to-pdf', {
            method: 'POST',
            body: convertFormData,
          })
          
          if (!convertRes.ok) {
            const errorData = await convertRes.json()
            throw new Error(errorData.error || 'Word 转 PDF 失败')
          }
          
          // 获取转换后的 PDF 文件
          const pdfBlob = await convertRes.blob()
          // 从 header 获取文件名并解码 URL 编码
          const encodedFileName = convertRes.headers.get('X-Converted-Filename')
          const pdfFileName = encodedFileName 
            ? decodeURIComponent(encodedFileName)
            : pendingFile.name.replace(/\.(docx?|dotx?)$/i, '.pdf')
          
          fileToProcess = new File([pdfBlob], pdfFileName, { type: 'application/pdf' })
          addToast({ title: 'Word 转换完成，正在导入...', color: 'success' })
        }

        // 先将文件存储到 IndexedDB，用于沉浸式阅读时获取
        const storeResult = await storeFile(fileToProcess)
        localFileId = storeResult.id

        const formData = new FormData()
        formData.append('file', fileToProcess)
        const res = await fetch('/api/knowledge/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error('Upload failed')
        data = await res.json()
      } else {
        const formData = new FormData()
        formData.append('url', importUrl)
        const res = await fetch('/api/knowledge/upload', { method: 'POST', body: formData })
        if (!res.ok) throw new Error('Import failed')
        data = await res.json()
      }

      const now = new Date().toISOString()
      // 确保 fileName 是解码后的
      const decodedFileName = data.fileName ? decodeURIComponent(data.fileName) : data.fileName
      const newItem: KnowledgeItem = {
        id: generateId(),
        title: importTitle || decodedFileName,
        authors: importAuthors ? importAuthors.split(',').map(a => a.trim()).filter(Boolean) : [],
        abstract: importAbstract || '',
        year: importYear || '',
        journal: importJournal || '',
        sourceType: importTab === 'url' ? 'url' : 'upload',
        sourceId: localFileId, // IndexedDB 文件 ID，用于沉浸式阅读获取 PDF
        fileName: decodedFileName,
        fileType: data.fileType,
        fileSize: data.fileSize,
        url: importTab === 'url' ? importUrl : undefined,
        hasAttachment: importTab === 'url',
        attachmentUrl: importTab === 'url' ? importUrl : undefined,
        attachmentFileName: importTab === 'url' ? decodedFileName : undefined,
        createdAt: now,
        updatedAt: now,
      }

      addKnowledgeItem(newItem)
      setItems(getKnowledgeItems())
      onImportClose()
      resetImportForm()
      addToast({ title: '导入成功', color: 'success' })
    } catch (error) {
      console.error('Import error:', error)
      addToast({ title: '导入失败', color: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [importTab, pendingFile, importUrl, importTitle, importAbstract, importYear, importAuthors, importJournal, onImportClose, resetImportForm])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 头部操作区 */}
      <div style={{ padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
          <Tooltip content="上传文件或从 URL 导入">
            <Button size="sm" variant="flat" color="primary" onPress={onImportOpen}>
              <ImportIcon /> 导入
            </Button>
          </Tooltip>
          <Tooltip content="查看知识图谱">
            <Button
              size="sm"
              variant="flat"
              color="secondary"
              onPress={() => router.push('/knowledge-graph')}
            >
              <GraphIcon /> 图谱
            </Button>
          </Tooltip>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Tooltip content="配置并同步 Zotero">
            <Button 
              size="sm" 
              variant={zoteroConfig ? 'flat' : 'solid'} 
              color={zoteroConfig ? 'default' : 'primary'}
              onPress={zoteroConfig ? handleSyncZotero : onZoteroOpen}
              isLoading={syncing}
            >
              <ZoteroIcon /> {zoteroConfig ? '同步' : 'Zotero'}
            </Button>
          </Tooltip>
          {zoteroConfig && (
            <Button size="sm" variant="light" isIconOnly onPress={onZoteroOpen}>
              <SettingsIcon />
            </Button>
          )}
        </div>
      </div>

      {/* 文献列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
            <Spinner size="sm" />
          </div>
        )}
        
        {items.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 13 }}>暂无文献</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>上传文件或同步 Zotero 开始</p>
          </div>
        )}

        {items.map(item => (
          <div
            key={item.id}
            onClick={() => handleItemClick(item)}
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'background 0.15s',
              position: 'relative',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'
              const actionBtn = e.currentTarget.querySelector('.action-btn') as HTMLElement
              if (actionBtn) actionBtn.style.opacity = '1'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'none'
              const actionBtn = e.currentTarget.querySelector('.action-btn') as HTMLElement
              if (actionBtn) actionBtn.style.opacity = '0'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                <FileIcon type={item.sourceType} hasAttachment={item.hasAttachment} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ 
                  fontSize: 13, 
                  fontWeight: 500, 
                  margin: 0, 
                  lineHeight: 1.4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  paddingRight: 50,
                }}>
                  {item.title}
                </p>
                {item.authors.length > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                    {item.authors.slice(0, 3).join(', ')}{item.authors.length > 3 && ' 等'}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                  {item.year && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.year}</span>
                  )}
                  <span style={{ 
                    fontSize: 10, 
                    padding: '1px 6px', 
                    background: 'var(--bg-tertiary)', 
                    borderRadius: 3,
                    color: 'var(--text-muted)',
                  }}>
                    {getSourceLabel(item)}
                  </span>
                  {item.hasAttachment && (
                    <span style={{ fontSize: 10, color: 'var(--accent-color)' }}>PDF</span>
                  )}
                  {item.hasImmersiveCache && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/immersive/${item.id}`)
                      }}
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 3,
                        border: '1px solid rgba(99,102,241,0.28)',
                        background: 'rgba(99,102,241,0.12)',
                        color: '#818cf8',
                        cursor: 'pointer',
                      }}
                      title="继续精读"
                    >
                      精读
                    </button>
                  )}
                  {item.ragStatus === 'indexing' && (
                    <span style={{ fontSize: 10, color: '#f59e0b' }}>建库中</span>
                  )}
                  {item.ragStatus === 'indexed' && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        background: 'rgba(16,185,129,0.12)',
                        borderRadius: 3,
                        color: '#10b981',
                      }}
                      title={item.ragStoredLocally ? '已索引（本地）' : '已索引（数据库）'}
                    >
                      RAG {item.ragChunks ? `· ${item.ragChunks}` : ''}
                    </span>
                  )}
                </div>
              </div>
              
              {/* PDF 操作下拉菜单 */}
              <Dropdown>
                <DropdownTrigger>
                  <button
                    className="action-btn"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: 0,
                      transition: 'opacity 0.15s',
                      flexShrink: 0,
                    }}
                    title="更多操作"
                  >
                    <MoreIcon />
                  </button>
                </DropdownTrigger>
                <DropdownMenu aria-label="PDF操作">
                  {/* 有 PDF 附件时显示下载和精读 */}
                  {(item.sourceType === 'upload' || item.hasAttachment || Boolean(item.attachmentUrl) || (item.sourceType === 'url' && Boolean(item.url))) && (
                    <>
                      <DropdownItem
                        key="download"
                        startContent={<DownloadIcon />}
                        onPress={() => handleDownloadPdf(item)}
                      >
                        下载 PDF
                      </DropdownItem>
                      <DropdownItem
                        key="immersive"
                        startContent={<BookOpenIcon />}
                        onPress={() => router.push(`/immersive/${item.id}`)}
                      >
                        沉浸式阅读
                      </DropdownItem>
                    </>
                  )}
                  <DropdownItem
                    key="insert"
                    startContent={<PlusIconSmall />}
                    onPress={() => handleInsert(item)}
                  >
                    插入引用
                  </DropdownItem>
                  <DropdownItem
                    key="delete"
                    startContent={<TrashIconSmall />}
                    className="text-danger"
                    color="danger"
                    onPress={() => handleDeleteClick(item)}
                  >
                    删除
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            </div>
            
            {/* 删除按钮 */}
            {/* <button
              className="delete-btn"
              onClick={(e) => handleDelete(item.id, e)}
              style={{
                position: 'absolute',
                right: 8,
                top: 8,
                width: 20,
                height: 20,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0,
                transition: 'opacity 0.15s',
              }}
              title="删除"
            >
              <TrashIconSmall />
            </button> */}
          </div>
        ))}
      </div>

      {/* 旋转动画样式 */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      
      {/* 详情弹窗 */}
      <Modal isOpen={isDetailOpen} onClose={onDetailClose} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            <div style={{ fontSize: 15, paddingRight: 30 }}>{selectedItem?.title}</div>
          </ModalHeader>
          <ModalBody>
            {selectedItem && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>作者</p>
                  <p style={{ fontSize: 13 }}>{selectedItem.authors.length > 0 ? selectedItem.authors.join(', ') : '未知'}</p>
                </div>
                
                {selectedItem.journal && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>期刊/会议</p>
                    <p style={{ fontSize: 13 }}>{selectedItem.journal}</p>
                  </div>
                )}
                
                {selectedItem.year && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>年份</p>
                    <p style={{ fontSize: 13 }}>{selectedItem.year}</p>
                  </div>
                )}

                {selectedItem.doi && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>DOI</p>
                    <a href={`https://doi.org/${selectedItem.doi}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent-color)' }}>
                      {selectedItem.doi}
                    </a>
                  </div>
                )}

                {selectedItem.url && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>链接</p>
                    <a href={selectedItem.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent-color)', wordBreak: 'break-all' }}>
                      {selectedItem.url}
                    </a>
                  </div>
                )}

                {/* PDF 附件 */}
                {(selectedItem.sourceType === 'upload' || Boolean(selectedItem.attachmentUrl) || (selectedItem.sourceType === 'url' && Boolean(selectedItem.url))) && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>PDF 附件</p>
                    {selectedItem.sourceType === 'upload' ? (
                      <button
                        type="button"
                        onClick={() => handleDownloadPdf(selectedItem)}
                        style={{
                          fontSize: 13,
                          color: 'var(--accent-color)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                        }}
                      >
                        <PdfIcon /> {selectedItem.fileName || '下载 PDF'}
                      </button>
                    ) : (
                      <a
                        href={getProxiedPdfUrl(selectedItem) || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 13, color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <PdfIcon /> {selectedItem.attachmentFileName || selectedItem.fileName || '查看 PDF'}
                      </a>
                    )}
                  </div>
                )}

                {selectedItem.tags && selectedItem.tags.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>标签</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {selectedItem.tags.map((tag, i) => (
                        <span key={i} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--bg-tertiary)', borderRadius: 4 }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <Divider />

                <div>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>精读与检索</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>
                      沉浸式缓存：{selectedItem.hasImmersiveCache ? '已完成' : '未生成'}
                    </span>
                    <span>
                      RAG 状态：
                      {selectedItem.ragStatus === 'indexed'
                        ? `已建库${selectedItem.ragStoredLocally ? '（本地）' : '（数据库）'}`
                        : selectedItem.ragStatus === 'indexing'
                          ? '建库中'
                          : selectedItem.ragStatus === 'failed'
                            ? `失败${selectedItem.ragError ? `：${selectedItem.ragError}` : ''}`
                            : '未建库'}
                    </span>
                    {typeof selectedItem.ragChunks === 'number' && selectedItem.ragChunks > 0 && (
                      <span>索引块数：{selectedItem.ragChunks}</span>
                    )}
                  </div>
                </div>

                <Divider />

                {/* 引用格式 */}
                {selectedItem.bib && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>引用</p>
                      <Button 
                        size="sm" 
                        variant="flat" 
                        color="primary"
                        onPress={() => {
                          // 将 HTML 引用转为纯文本
                          const tempDiv = document.createElement('div')
                          tempDiv.innerHTML = selectedItem.bib || ''
                          const plainText = tempDiv.textContent || tempDiv.innerText || ''
                          navigator.clipboard.writeText(plainText)
                          addToast({ title: '引用已复制', color: 'success' })
                        }}
                        style={{ fontSize: 11, padding: '2px 8px', minWidth: 'auto', height: 24 }}
                      >
                        复制引用
                      </Button>
                    </div>
                    <div 
                      style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)', padding: 8, background: 'var(--bg-secondary)', borderRadius: 4 }}
                      dangerouslySetInnerHTML={{ __html: selectedItem.bib }}
                    />
                  </div>
                )}

                {/* 摘要 */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', margin: 0 }}>摘要</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {/* 如果有翻译缓存，显示中英切换 */}
                      {selectedItem.cachedSummary && (
                        <>
                          <Button 
                            size="sm" 
                            variant={showTranslated ? 'solid' : 'flat'}
                            color={showTranslated ? 'primary' : 'default'}
                            onPress={() => setShowTranslated(true)}
                            style={{ fontSize: 11, padding: '2px 8px', minWidth: 'auto', height: 24 }}
                          >
                            中文
                          </Button>
                          <Button 
                            size="sm" 
                            variant={!showTranslated ? 'solid' : 'flat'}
                            color={!showTranslated ? 'primary' : 'default'}
                            onPress={() => setShowTranslated(false)}
                            style={{ fontSize: 11, padding: '2px 8px', minWidth: 'auto', height: 24 }}
                          >
                            英文
                          </Button>
                        </>
                      )}
                      {/* 英文状态下显示翻译按钮 */}
                      {!selectedItem.cachedSummary && selectedItem.abstract && needsTranslation(selectedItem.abstract) && (
                        <Button size="sm" variant="flat" color="primary" onPress={handleTranslate} isLoading={translating}>
                          翻译
                        </Button>
                      )}
                    </div>
                  </div>
                  {summaryLoading || translating ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                      <Spinner size="sm" />
                    </div>
                  ) : (
                    <div style={{ position: 'relative' }}>
                      <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                        {(selectedItem.cachedSummary && showTranslated ? selectedItem.cachedSummary : selectedItem.abstract) || '暂无摘要'}
                      </p>
                      {/* 中文状态下悬停显示重新翻译按钮 */}
                      {selectedItem.cachedSummary && showTranslated && (
                        <button
                          onClick={handleTranslate}
                          onMouseEnter={(e) => {
                            const target = e.currentTarget
                            target.style.opacity = '1'
                          }}
                          onMouseLeave={(e) => {
                            const target = e.currentTarget
                            target.style.opacity = '0'
                          }}
                          disabled={translating}
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 4,
                            cursor: 'pointer',
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            opacity: 0,
                            transition: 'opacity 0.2s',
                          }}
                          title="重新翻译"
                        >
                          <RefreshIcon spinning={translating} />
                          重新翻译
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" color="danger" onPress={() => selectedItem && handleDeleteClick(selectedItem)}>
              删除
            </Button>
            {/* 沉浸式阅读按钮 - 只有有 PDF 时才显示 */}
            {selectedItem && (selectedItem.hasAttachment || selectedItem.sourceType === 'upload') && (
              <Button 
                color="secondary" 
                variant="flat"
                onPress={() => {
                  onDetailClose()
                  router.push(`/immersive/${selectedItem.id}`)
                }}
              >
                <BookOpenIcon /> 沉浸式阅读
              </Button>
            )}
            <Button color="primary" variant="flat" onPress={() => selectedItem && handleInsert(selectedItem)}>
              插入到文档
            </Button>
            <Button variant="light" onPress={onDetailClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal isOpen={isDeleteConfirmOpen} onClose={onDeleteConfirmClose}>
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            <p style={{ color: 'var(--text-secondary)' }}>
              确定要删除文献 <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{itemToDelete?.title}</span> 吗？
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              此操作将删除文档本身、所有翻译缓存、批注和 RAG 索引数据，且无法恢复。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onDeleteConfirmClose}>取消</Button>
            <Button color="danger" onPress={handleConfirmDelete} isLoading={deleting}>
              确认删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Zotero 配置弹窗 */}
      <Modal isOpen={isZoteroOpen} onClose={onZoteroClose}>
        <ModalContent>
          <ModalHeader>配置 Zotero</ModalHeader>
          <ModalBody>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              请输入您的 Zotero 用户 ID 和 API Key。您可以在{' '}
              <a href="https://www.zotero.org/settings/keys/new" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-color)' }}>
                Zotero 设置
              </a>{' '}
              创建新的 API Key。
            </p>
            <Input
              label="用户 ID"
              placeholder="例如: 123456"
              value={zoteroUserId}
              onValueChange={setZoteroUserId}
              size="sm"
              variant="bordered"
            />
            <Input
              label="API Key"
              placeholder="例如: abc123..."
              value={zoteroApiKey}
              onValueChange={setZoteroApiKey}
              size="sm"
              variant="bordered"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onZoteroClose}>取消</Button>
            <Button color="primary" onPress={handleSaveZoteroConfig}>保存</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 导入弹窗 */}
      <Modal isOpen={isImportOpen} onClose={() => { onImportClose(); resetImportForm(); }} size="lg">
        <ModalContent>
          <ModalHeader>导入文献</ModalHeader>
          <ModalBody>
            {/* Tab 切换 */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
              <Button
                size="sm"
                variant={importTab === 'upload' ? 'solid' : 'flat'}
                color={importTab === 'upload' ? 'primary' : 'default'}
                onPress={() => setImportTab('upload')}
              >
                <UploadIcon /> 上传文件
              </Button>
              <Button
                size="sm"
                variant={importTab === 'url' ? 'solid' : 'flat'}
                color={importTab === 'url' ? 'primary' : 'default'}
                onPress={() => setImportTab('url')}
              >
                <LinkIcon /> URL 导入
              </Button>
            </div>

            {/* 上传区域 */}
            {importTab === 'upload' && (
              <div style={{ marginBottom: 16 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--border-color)',
                    borderRadius: 8,
                    padding: '24px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  {pendingFile ? (
                    <div>
                      <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                        {pendingFile.name}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {(pendingFile.size / 1024).toFixed(1)} KB
                        {pendingFile.name.toLowerCase().match(/\.(docx?|dotx?)$/) && (
                          <span style={{ marginLeft: 8, color: 'var(--accent-color)' }}>
                            (将自动转换为 PDF)
                          </span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>
                        点击选择文件
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        支持 PDF、DOC、DOCX 格式（Word 文件将自动转换为 PDF）
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* URL 输入 */}
            {importTab === 'url' && (
              <div style={{ marginBottom: 16 }}>
                <Input
                  label="PDF 链接"
                  placeholder="https://example.com/paper.pdf"
                  value={importUrl}
                  onValueChange={setImportUrl}
                  size="sm"
                  variant="bordered"
                />
              </div>
            )}

            <Divider style={{ margin: '16px 0' }} />

            {/* 元数据表单 */}
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>
              文献信息（可选）
            </p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                label="标题"
                placeholder={importTab === 'upload' ? '默认使用文件名' : '请输入标题'}
                value={importTitle}
                onValueChange={setImportTitle}
                size="sm"
                variant="bordered"
              />
              
              <Input
                label="作者"
                placeholder="多个作者用逗号分隔"
                value={importAuthors}
                onValueChange={setImportAuthors}
                size="sm"
                variant="bordered"
              />

              <div style={{ display: 'flex', gap: 12 }}>
                <Input
                  label="年份"
                  placeholder="如 2024"
                  value={importYear}
                  onValueChange={setImportYear}
                  size="sm"
                  variant="bordered"
                  style={{ flex: 1 }}
                />
                <Input
                  label="期刊/会议"
                  placeholder="如 Nature"
                  value={importJournal}
                  onValueChange={setImportJournal}
                  size="sm"
                  variant="bordered"
                  style={{ flex: 2 }}
                />
              </div>

              <Input
                label="摘要"
                placeholder="文献摘要（可选）"
                value={importAbstract}
                onValueChange={setImportAbstract}
                size="sm"
                variant="bordered"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => { onImportClose(); resetImportForm(); }}>取消</Button>
            <Button color="primary" onPress={handleImportSubmit} isLoading={loading}>
              导入
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

// 图标组件
function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function ZoteroIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="7" y1="8" x2="17" y2="8" />
      <line x1="7" y1="12" x2="13" y2="12" />
      <line x1="7" y1="16" x2="15" y2="16" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function FileIcon({ type, hasAttachment }: { type: string; hasAttachment?: boolean }) {
  const color = hasAttachment
    ? 'var(--accent-color)'
    : (type === 'zotero' || type === 'literature-search' ? 'var(--accent-color)' : 'var(--text-muted)')
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      {hasAttachment && <line x1="8" y1="13" x2="16" y2="13" />}
      {hasAttachment && <line x1="8" y1="17" x2="16" y2="17" />}
    </svg>
  )
}

function PlusIconSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function TrashIconSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function PdfIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  )
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg 
      width="12" 
      height="12" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2"
      style={{ animation: spinning ? 'spin 1s linear infinite' : 'none' }}
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function BookOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  )
}

function GraphIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
