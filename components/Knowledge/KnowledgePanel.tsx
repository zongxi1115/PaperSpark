'use client'
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

  // 上传文件
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Upload failed')
      
      const data = await res.json()
      const settings = getSettings()
      const largeModelConfig = getSelectedLargeModel(settings)
      
      // 提取元数据
      const metaRes = await fetch('/api/knowledge/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: data.content,
          fileName: data.fileName,
          fileType: data.fileType,
          modelConfig: largeModelConfig,
          itemType: 'metadata',
        }),
      })

      let metadata = { title: file.name, authors: [] as string[], abstract: '', year: '', journal: '' }
      if (metaRes.ok) {
        metadata = await metaRes.json()
      }

      const now = new Date().toISOString()
      const newItem: KnowledgeItem = {
        id: generateId(),
        title: metadata.title || file.name,
        authors: metadata.authors,
        abstract: metadata.abstract || '',
        year: metadata.year || '',
        journal: metadata.journal || '',
        sourceType: 'upload',
        fileName: file.name,
        fileType: data.fileType,
        fileSize: data.fileSize,
        createdAt: now,
        updatedAt: now,
      }

      addKnowledgeItem(newItem)
      setItems(getKnowledgeItems())
      addToast({ title: '文件上传成功', color: 'success' })
    } catch (error) {
      console.error('Upload error:', error)
      addToast({ title: '上传失败', color: 'danger' })
    } finally {
      setLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [])

  // URL 导入
  const handleUrlImport = useCallback(async () => {
    if (!importUrl.trim()) return

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('url', importUrl)

      const res = await fetch('/api/knowledge/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error('Import failed')
      
      const data = await res.json()
      const settings = getSettings()
      const largeModelConfig = getSelectedLargeModel(settings)
      
      const metaRes = await fetch('/api/knowledge/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: data.content,
          fileName: data.fileName,
          fileType: data.fileType,
          modelConfig: largeModelConfig,
          itemType: 'metadata',
        }),
      })

      let metadata = { title: data.fileName, authors: [] as string[], abstract: '', year: '', journal: '' }
      if (metaRes.ok) {
        metadata = await metaRes.json()
      }

      const now = new Date().toISOString()
      const newItem: KnowledgeItem = {
        id: generateId(),
        title: metadata.title || data.fileName,
        authors: metadata.authors,
        abstract: metadata.abstract || '',
        year: metadata.year || '',
        journal: metadata.journal || '',
        url: importUrl,
        sourceType: 'url',
        fileName: data.fileName,
        fileType: 'pdf',
        createdAt: now,
        updatedAt: now,
      }

      addKnowledgeItem(newItem)
      setItems(getKnowledgeItems())
      onImportClose()
      setImportUrl('')
      addToast({ title: 'URL 导入成功', color: 'success' })
    } catch (error) {
      console.error('URL import error:', error)
      addToast({ title: 'URL 导入失败', color: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [importUrl, onImportClose])

  // 点击条目显示详情
  const handleItemClick = useCallback((item: KnowledgeItem) => {
    setSelectedItem(item)
    setShowTranslated(true) // 默认显示中文翻译
    onDetailOpen()
  }, [onDetailOpen])

  // 删除条目
  const handleDelete = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    deleteKnowledgeItem(id)
    setItems(getKnowledgeItems())
    if (selectedItem?.id === id) {
      setSelectedItem(null)
      onDetailClose()
    }
    addToast({ title: '已删除', color: 'default' })
  }, [selectedItem, onDetailClose])

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
            onChange={handleFileUpload}
          />
          <Tooltip content="上传 PDF/Word 文件">
            <Button size="sm" variant="flat" color="primary" onPress={() => fileInputRef.current?.click()}>
              <UploadIcon /> 上传
            </Button>
          </Tooltip>
          <Tooltip content="从 URL 导入 PDF">
            <Button size="sm" variant="flat" onPress={onImportOpen}>
              <LinkIcon /> URL
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
                  {(item.hasAttachment || item.sourceType === 'upload') && (
                    <>
                      <DropdownItem
                        key="download"
                        startContent={<DownloadIcon />}
                        href={item.attachmentUrl || '#'}
                        target="_blank"
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
                {selectedItem.hasAttachment && selectedItem.attachmentUrl && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>PDF 附件</p>
                    <a href={selectedItem.attachmentUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent-color)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <PdfIcon /> {selectedItem.attachmentFileName || '查看 PDF'}
                    </a>
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
            <Button variant="light" color="danger" onPress={() => selectedItem && handleDelete(selectedItem.id)}>
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

      {/* URL 导入弹窗 */}
      <Modal isOpen={isImportOpen} onClose={onImportClose}>
        <ModalContent>
          <ModalHeader>从 URL 导入</ModalHeader>
          <ModalBody>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              输入 PDF 文件的直接下载链接
            </p>
            <Input
              placeholder="https://example.com/paper.pdf"
              value={importUrl}
              onValueChange={setImportUrl}
              size="sm"
              variant="bordered"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onImportClose}>取消</Button>
            <Button color="primary" onPress={handleUrlImport} isLoading={loading}>
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

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
