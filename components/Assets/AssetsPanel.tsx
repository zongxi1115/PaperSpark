'use client'
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Input,
  Textarea,
  addToast,
  Tooltip,
  Divider,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Chip,
  ScrollShadow,
} from '@heroui/react'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { zh } from '@blocknote/core/locales'
import type { Block } from '@blocknote/core'
import { Icon } from '@iconify/react'
import {
  getAssets,
  saveAsset,
  deleteAsset,
  getAssetTypes,
  saveAssetType,
  deleteAssetType,
  generateId,
  getSettings,
  getSelectedSmallModel,
} from '@/lib/storage'
import type { AssetType, AssetItem, ModelConfig } from '@/lib/types'

// 可选图标列表
const ICON_OPTIONS = [
  { icon: 'solar:document-bold', name: '文档' },
  { icon: 'solar:pen-bold', name: '笔' },
  { icon: 'solar:lightbulb-bolt-bold', name: '想法' },
  { icon: 'solar:bookmark-bold', name: '书签' },
  { icon: 'solar:folder-bold', name: '文件夹' },
  { icon: 'solar:star-bold', name: '星标' },
  { icon: 'solar:heart-bold', name: '喜欢' },
  { icon: 'solar:code-bold', name: '代码' },
  { icon: 'solar:gallery-bold', name: '图片' },
  { icon: 'solar:link-bold', name: '链接' },
  { icon: 'solar:tag-bold', name: '标签' },
  { icon: 'solar:bookmark-square-bold', name: '收藏' },
]

export function AssetsPanel() {
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [assetTypes, setAssetTypes] = useState<AssetType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingAsset, setEditingAsset] = useState<AssetItem | null>(null)
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null)

  const { isOpen: isEditorOpen, onOpen: onEditorOpen, onClose: onEditorClose } = useDisclosure()
  const { isOpen: isTypeModalOpen, onOpen: onTypeModalOpen, onClose: onTypeModalClose } = useDisclosure()

  // 加载数据
  useEffect(() => {
    setAssetTypes(getAssetTypes())
    setAssets(getAssets())
    const settings = getSettings()
    setModelConfig(getSelectedSmallModel(settings))
  }, [])

  // 获取所有标签
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    assets.forEach(asset => {
      asset.tags?.forEach(tag => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [assets])

  // 筛选后的资产
  const filteredAssets = useMemo(() => {
    let result = assets

    // 类型筛选
    if (selectedTypeId) {
      result = result.filter(a => a.typeId === selectedTypeId)
    }

    // 标签筛选
    if (selectedTag) {
      result = result.filter(a => a.tags?.includes(selectedTag))
    }

    // 搜索筛选
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(a => 
        a.title.toLowerCase().includes(query) ||
        a.summary?.toLowerCase().includes(query) ||
        a.tags?.some(t => t.toLowerCase().includes(query))
      )
    }

    return result
  }, [assets, selectedTypeId, selectedTag, searchQuery])

  // 创建新资产
  const handleCreateAsset = useCallback((typeId: string) => {
    const newAsset: AssetItem = {
      id: generateId(),
      title: '新资产',
      typeId,
      content: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    saveAsset(newAsset)
    setAssets(getAssets())
    setEditingAsset(newAsset)
    onEditorOpen()
  }, [onEditorOpen])

  // 点击资产卡片
  const handleAssetClick = useCallback((asset: AssetItem) => {
    setEditingAsset(asset)
    onEditorOpen()
  }, [onEditorOpen])

  // 删除资产
  const handleDeleteAsset = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteAsset(id)
    setAssets(getAssets())
    addToast({ title: '已删除', color: 'success' })
  }, [])

  // 类型管理
  const [editingType, setEditingType] = useState<AssetType | null>(null)
  const [typeForm, setTypeForm] = useState({
    name: '',
    icon: 'solar:document-bold',
    color: '#6b7280',
    description: '',
  })

  const handleCreateType = useCallback(() => {
    setEditingType(null)
    setTypeForm({ name: '', icon: 'solar:document-bold', color: '#6b7280', description: '' })
    onTypeModalOpen()
  }, [onTypeModalOpen])

  const handleEditType = useCallback((type: AssetType) => {
    setEditingType(type)
    setTypeForm({
      name: type.name,
      icon: type.icon,
      color: type.color,
      description: type.description || '',
    })
    onTypeModalOpen()
  }, [onTypeModalOpen])

  const handleSaveType = useCallback(() => {
    if (!typeForm.name.trim()) {
      addToast({ title: '请输入类型名称', color: 'warning' })
      return
    }

    const now = new Date().toISOString()
    if (editingType) {
      const updated: AssetType = {
        ...editingType,
        name: typeForm.name,
        icon: typeForm.icon,
        color: typeForm.color,
        description: typeForm.description,
        updatedAt: now,
      }
      saveAssetType(updated)
    } else {
      const newType: AssetType = {
        id: `type-${generateId()}`,
        name: typeForm.name,
        icon: typeForm.icon,
        color: typeForm.color,
        description: typeForm.description,
        isPreset: false,
        createdAt: now,
        updatedAt: now,
      }
      saveAssetType(newType)
    }
    setAssetTypes(getAssetTypes())
    onTypeModalClose()
    addToast({ title: editingType ? '类型已更新' : '类型已创建', color: 'success' })
  }, [typeForm, editingType, onTypeModalClose])

  const handleDeleteType = useCallback((typeId: string) => {
    const type = assetTypes.find(t => t.id === typeId)
    if (type?.isPreset) {
      addToast({ title: '预设类型不可删除', color: 'warning' })
      return
    }
    deleteAssetType(typeId)
    setAssetTypes(getAssetTypes())
    if (selectedTypeId === typeId) {
      setSelectedTypeId(null)
    }
    addToast({ title: '类型已删除', color: 'success' })
  }, [assetTypes, selectedTypeId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 搜索框 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)' }}>
        <Input
          size="sm"
          placeholder="搜索资产..."
          value={searchQuery}
          onValueChange={setSearchQuery}
          startContent={<Icon icon="solar:magnifer-linear" width={16} style={{ color: 'var(--text-muted)' }} />}
          isClearable
          variant="bordered"
        />
      </div>

      {/* 类型选择器 */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Chip
            size="sm"
            variant={selectedTypeId === null ? 'solid' : 'flat'}
            color={selectedTypeId === null ? 'primary' : 'default'}
            onClick={() => setSelectedTypeId(null)}
            style={{ cursor: 'pointer' }}
          >
            全部
          </Chip>
          {assetTypes.map(type => (
            <Chip
              key={type.id}
              size="sm"
              variant={selectedTypeId === type.id ? 'solid' : 'flat'}
              style={{
                cursor: 'pointer',
                backgroundColor: selectedTypeId === type.id ? type.color : undefined,
                color: selectedTypeId === type.id ? 'white' : undefined,
              }}
              onClick={() => setSelectedTypeId(selectedTypeId === type.id ? null : type.id)}
              onClose={!type.isPreset ? () => handleDeleteType(type.id) : undefined}
              startContent={<Icon icon={type.icon} width={14} />}
            >
              {type.name}
            </Chip>
          ))}
          <Tooltip content="添加类型">
            <button
              onClick={handleCreateType}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                border: '1px dashed var(--border-color)',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon icon="solar:add-circle-linear" width={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* 标签筛选 */}
      {allTags.length > 0 && (
        <div style={{
          padding: '6px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
        }}>
          <ScrollShadow orientation="horizontal" style={{ width: '100%' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
              <Chip
                size="sm"
                variant={selectedTag === null ? 'solid' : 'flat'}
                color={selectedTag === null ? 'default' : undefined}
                onClick={() => setSelectedTag(null)}
                style={{ cursor: 'pointer', flexShrink: 0 }}
              >
                全部标签
              </Chip>
              {allTags.map(tag => (
                <Chip
                  key={tag}
                  size="sm"
                  variant={selectedTag === tag ? 'solid' : 'flat'}
                  color={selectedTag === tag ? 'secondary' : undefined}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  style={{ cursor: 'pointer', flexShrink: 0 }}
                >
                  {tag}
                </Chip>
              ))}
            </div>
          </ScrollShadow>
        </div>
      )}

      {/* 新增按钮和计数 */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filteredAssets.length} 条记录
        </span>
        <Dropdown>
          <DropdownTrigger>
            <Button size="sm" color="primary" variant="flat" startContent={<Icon icon="solar:add-circle-linear" width={14} />}>
              新增资产
            </Button>
          </DropdownTrigger>
          <DropdownMenu aria-label="选择资产类型">
            {assetTypes.map(type => (
              <DropdownItem
                key={type.id}
                startContent={<Icon icon={type.icon} width={16} />}
                onPress={() => handleCreateAsset(type.id)}
              >
                {type.name}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </Dropdown>
      </div>

      {/* 资产列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {filteredAssets.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: 24,
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            <Icon icon="solar:inbox-linear" width={32} style={{ marginBottom: 8, opacity: 0.5 }} />
            <p>{searchQuery ? '没有找到匹配的资产' : '点击「新增资产」添加内容'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredAssets.map(asset => {
              const type = assetTypes.find(t => t.id === asset.typeId)
              return (
                <div
                  key={asset.id}
                  onClick={() => handleAssetClick(asset)}
                  style={{
                    padding: '10px 12px',
                    background: 'var(--bg-secondary)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: '1px solid var(--border-color)',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = type?.color || 'var(--accent-color)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-color)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Icon icon={type?.icon || 'solar:document-bold'} width={16} style={{ color: type?.color }} />
                      <span style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}>
                        {asset.title || '无标题'}
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteAsset(asset.id, e)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '2px 4px',
                        fontSize: 11,
                      }}
                    >
                      删除
                    </button>
                  </div>
                  <p style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    margin: 0,
                    lineHeight: 1.4,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {asset.summary || getContentPreview(asset.content)}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatDate(asset.updatedAt)}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {asset.tags?.slice(0, 2).map((tag, i) => (
                        <Chip key={i} size="sm" variant="flat" style={{ fontSize: 10, height: 18 }}>
                          {tag}
                        </Chip>
                      ))}
                      {(asset.tags?.length || 0) > 2 && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          +{asset.tags!.length - 2}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 类型管理按钮 */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'center',
      }}>
        <Button size="sm" variant="light" onPress={onTypeModalOpen} startContent={<Icon icon="solar:settings-linear" width={14} />}>
          管理类型
        </Button>
      </div>

      {/* 资产编辑弹窗 */}
      <Modal isOpen={isEditorOpen} onClose={onEditorClose} size="4xl" scrollBehavior="inside">
        <ModalContent>
          {editingAsset && (
            <AssetEditorModal
              key={editingAsset.id}
              asset={editingAsset}
              assetTypes={assetTypes}
              allTags={allTags}
              modelConfig={modelConfig}
              onClose={onEditorClose}
              onSave={() => setAssets(getAssets())}
            />
          )}
        </ModalContent>
      </Modal>

      {/* 类型管理弹窗 */}
      <Modal isOpen={isTypeModalOpen} onClose={onTypeModalClose} size="sm">
        <ModalContent>
          <ModalHeader>
            {editingType ? '编辑类型' : '添加类型'}
          </ModalHeader>
          <ModalBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                label="类型名称"
                placeholder="如：想法、灵感..."
                value={typeForm.name}
                onValueChange={(v) => setTypeForm(prev => ({ ...prev, name: v }))}
                size="sm"
                variant="bordered"
              />
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
                  图标
                </label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ICON_OPTIONS.map(({ icon, name }) => (
                    <Tooltip key={icon} content={name} placement="top">
                      <button
                        onClick={() => setTypeForm(prev => ({ ...prev, icon }))}
                        style={{
                          width: 32,
                          height: 32,
                          border: typeForm.icon === icon ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                          borderRadius: 6,
                          background: typeForm.icon === icon ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Icon icon={icon} width={18} />
                      </button>
                    </Tooltip>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
                  主题色
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6'].map(color => (
                    <button
                      key={color}
                      onClick={() => setTypeForm(prev => ({ ...prev, color }))}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        background: color,
                        border: typeForm.color === color ? '2px solid white' : 'none',
                        boxShadow: typeForm.color === color ? '0 0 0 2px ' + color : 'none',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
              <Textarea
                label="描述"
                placeholder="类型描述（可选）"
                value={typeForm.description}
                onValueChange={(v) => setTypeForm(prev => ({ ...prev, description: v }))}
                size="sm"
                variant="bordered"
                minRows={2}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            {editingType && !editingType.isPreset && (
              <Button
                color="danger"
                variant="light"
                onPress={() => {
                  handleDeleteType(editingType.id)
                  onTypeModalClose()
                }}
              >
                删除类型
              </Button>
            )}
            <div style={{ flex: 1 }} />
            <Button variant="light" onPress={onTypeModalClose}>取消</Button>
            <Button color="primary" onPress={handleSaveType}>保存</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

// 资产编辑器组件
function AssetEditorModal({
  asset,
  assetTypes,
  allTags,
  modelConfig,
  onClose,
  onSave,
}: {
  asset: AssetItem
  assetTypes: AssetType[]
  allTags: string[]
  modelConfig: ModelConfig | null
  onClose: () => void
  onSave: () => void
}) {
  const [title, setTitle] = useState(asset.title)
  const [summary, setSummary] = useState(asset.summary || '')
  const [tags, setTags] = useState<string[]>(asset.tags || [])

  const editor = useCreateBlockNote({
    dictionary: {
      ...zh,
      placeholders: {
        ...zh.placeholders,
        emptyDocument: '记录内容...',
      },
    },
    initialContent: Array.isArray(asset.content) && asset.content.length > 0
      ? (asset.content as Block[])
      : undefined,
  })

  const currentType = assetTypes.find(t => t.id === asset.typeId)

  // 保存
  const handleSave = useCallback(() => {
    const updated: AssetItem = {
      ...asset,
      title,
      summary,
      tags,
      content: editor.document as Block[],
      updatedAt: new Date().toISOString(),
    }
    saveAsset(updated)
    onSave()
  }, [asset, title, summary, tags, editor, onSave])

  // AI 生成概述
  const handleGenerateSummary = useCallback(async () => {
    if (!modelConfig?.apiKey) {
      addToast({ title: '请先配置 API Key', color: 'warning' })
      return
    }
    const text = getPlainText(editor.document)
    if (!text.trim()) {
      addToast({ title: '内容为空', color: 'warning' })
      return
    }
    try {
      const res = await fetch('/api/ai/thought', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, action: 'summarize', modelConfig }),
      })
      if (res.ok) {
        const { title: newTitle, summary: newSummary } = await res.json() as {
          title?: string
          summary?: string
        }
        if (newTitle) setTitle(newTitle)
        if (newSummary) setSummary(newSummary)
        addToast({ title: '概述已生成', color: 'success' })
      }
    } catch (err) {
      addToast({ title: err instanceof Error ? err.message : '请求失败', color: 'danger' })
    }
  }, [modelConfig, editor])

  return (
    <>
      <ModalHeader style={{ paddingBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon icon={currentType?.icon || 'solar:document-bold'} width={20} style={{ color: currentType?.color }} />
          <Input
            value={title}
            onValueChange={setTitle}
            size="lg"
            variant="underlined"
            placeholder="资产标题..."
            style={{ fontWeight: 600, flex: 1 }}
          />
        </div>
      </ModalHeader>
      <ModalBody style={{ paddingTop: 0 }}>
        {/* AI 工具栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 12,
          padding: '6px 10px',
          background: 'var(--bg-secondary)',
          borderRadius: 8,
        }}>
          <Tooltip content="AI 生成标题和概述" placement="bottom">
            <Button
              size="sm"
              color="primary"
              variant="flat"
              onPress={handleGenerateSummary}
              startContent={<Icon icon="solar:magic-stick-3-linear" width={14} />}
            >
              生成概述
            </Button>
          </Tooltip>
        </div>

        {/* 概述 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
            概述
          </label>
          <Textarea
            value={summary}
            onValueChange={setSummary}
            placeholder="AI 生成的概述..."
            minRows={2}
            maxRows={3}
            style={{ fontSize: 13 }}
          />
        </div>

        {/* 标签 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
            标签
          </label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
            {tags.map((tag, i) => (
              <Chip
                key={i}
                size="sm"
                onClose={() => setTags(tags.filter((_, idx) => idx !== i))}
                variant="solid"
                color="primary"
              >
                {tag}
              </Chip>
            ))}
          </div>
          {/* 已有标签选择 */}
          {allTags.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>选择已有标签：</p>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {allTags.map(tag => (
                  <Chip
                    key={tag}
                    size="sm"
                    variant={tags.includes(tag) ? 'solid' : 'flat'}
                    color={tags.includes(tag) ? 'secondary' : 'default'}
                    onClick={() => {
                      if (tags.includes(tag)) {
                        setTags(tags.filter(t => t !== tag))
                      } else {
                        setTags([...tags, tag])
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {tag}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          <Input
            size="sm"
            placeholder="输入新标签后回车"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = (e.target as HTMLInputElement).value.trim()
                if (value && !tags.includes(value)) {
                  setTags([...tags, value])
                  ;(e.target as HTMLInputElement).value = ''
                }
              }
            }}
          />
        </div>

        {/* 编辑器 */}
        <div style={{
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          minHeight: 200,
          background: 'var(--bg-primary)',
          padding: '12px 16px',
        }}>
          <BlockNoteView editor={editor} onChange={handleSave} theme="light" />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="light" onPress={() => { handleSave(); onClose(); }}>
          保存并关闭
        </Button>
      </ModalFooter>
    </>
  )
}

// 辅助函数
function getPlainText(blocks: Block[]): string {
  return blocks
    .filter(b => b.type === 'paragraph' || b.type === 'heading')
    .map(b => getBlockText(b).trim())
    .filter(Boolean)
    .join('\n')
}

function getContentPreview(content: unknown[]): string {
  if (!content || !Array.isArray(content)) return '点击编辑...'
  const texts = content
    .map(block => getBlockText(block))
    .filter(t => t.trim())
    .join(' ')
    .trim()
  if (!texts) return '点击编辑...'
  return texts.slice(0, 80) + (texts.length > 80 ? '...' : '')
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getInlineText(inline: unknown): string {
  if (!inline) return ''
  if (typeof inline === 'string') return inline
  if (Array.isArray(inline)) return inline.map(getInlineText).join('')
  if (!isRecord(inline)) return ''
  const text = inline.text
  if (typeof text === 'string') return text
  const content = inline.content
  if (Array.isArray(content)) return content.map(getInlineText).join('')
  return ''
}

function getBlockText(block: unknown, depth = 0): string {
  if (!block || depth > 10 || !isRecord(block)) return ''
  const selfText = getInlineText(block.content)
  const children = block.children
  if (!Array.isArray(children)) return selfText
  const childrenText = children
    .map(child => getBlockText(child, depth + 1))
    .filter(t => t.trim())
    .join(' ')
  return [selfText, childrenText].filter(Boolean).join(' ')
}