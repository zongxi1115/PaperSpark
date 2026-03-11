'use client'
import setting from './setting-block.module.css'
import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Input,
  Switch,
  Select,
  SelectItem,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  addToast,
  Chip,
} from '@heroui/react'
import { getSettings, saveSettings, generateId } from '@/lib/storage'
import type { AppSettings, FeatureSelectItem, AIProvider, AIModel } from '@/lib/types'
import { defaultSettings, selectFeatures } from '@/lib/types'
import { EDITOR_THEMES, injectGoogleFont } from '@/lib/editorThemes'
import { Icon } from '@iconify/react'

// 获取所有可用模型（用于下拉选择）
function getAllModels(providers: AIProvider[]): { model: AIModel; provider: AIProvider }[] {
  const models: { model: AIModel; provider: AIProvider }[] = []
  for (const provider of providers) {
    for (const model of provider.models) {
      models.push({ model, provider })
    }
  }
  return models
}

// Provider 编辑模态框
function ProviderModal({
  isOpen,
  onClose,
  provider,
  onSave,
}: {
  isOpen: boolean
  onClose: () => void
  provider: AIProvider | null
  onSave: (provider: AIProvider) => void
}) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<AIModel[]>([])

  useEffect(() => {
    if (provider) {
      setName(provider.name)
      setBaseUrl(provider.baseUrl)
      setApiKey(provider.apiKey)
      setModels([...provider.models])
    } else {
      setName('')
      setBaseUrl('')
      setApiKey('')
      setModels([])
    }
  }, [provider, isOpen])

  const handleAddModel = () => {
    const newModel: AIModel = {
      id: `model-${generateId()}`,
      name: '新模型',
      modelId: '',
      providerId: provider?.id || `provider-${generateId()}`,
      type: 'both',
    }
    setModels([...models, newModel])
  }

  const handleUpdateModel = (index: number, updates: Partial<AIModel>) => {
    const newModels = [...models]
    newModels[index] = { ...newModels[index], ...updates }
    setModels(newModels)
  }

  const handleRemoveModel = (index: number) => {
    setModels(models.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    if (!name.trim()) {
      addToast({ title: '请输入接口名称', color: 'warning' })
      return
    }
    if (!baseUrl.trim()) {
      addToast({ title: '请输入 Base URL', color: 'warning' })
      return
    }
    const providerId = provider?.id || `provider-${generateId()}`
    const updatedModels = models.map(m => ({ ...m, providerId }))
    
    const newProvider: AIProvider = {
      id: providerId,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      models: updatedModels,
      createdAt: provider?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    onSave(newProvider)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{provider ? '编辑 AI 接口' : '添加 AI 接口'}</ModalHeader>
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Input
              label="接口名称"
              placeholder="如：OpenAI、Claude、本地模型"
              value={name}
              onValueChange={setName}
              variant="bordered"
              description="自定义名称便于识别"
            />
            <Input
              label="Base URL"
              placeholder="https://api.openai.com/v1"
              value={baseUrl}
              onValueChange={setBaseUrl}
              variant="bordered"
              description="API 端点地址，兼容 OpenAI 格式"
            />
            <Input
              label="API Key"
              placeholder="sk-..."
              type="password"
              value={apiKey}
              onValueChange={setApiKey}
              variant="bordered"
              description="密钥仅存储在本地，不会上传服务器"
            />
            
            <Divider />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 600, fontSize: 14 }}>模型列表</p>
              <Button size="sm" variant="flat" color="primary" onPress={handleAddModel}>
                + 添加模型
              </Button>
            </div>
            
            {models.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                暂无模型，点击上方按钮添加
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {models.map((model, index) => (
                  <Card key={model.id} shadow="sm" style={{ background: 'var(--bg-tertiary)' }}>
                    <CardBody style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Input
                          placeholder="模型显示名称"
                          value={model.name}
                          onValueChange={v => handleUpdateModel(index, { name: v })}
                          size="sm"
                          variant="flat"
                          style={{ flex: 1, marginRight: 8 }}
                        />
                        <Button
                          size="sm"
                          variant="light"
                          color="danger"
                          isIconOnly
                          onPress={() => handleRemoveModel(index)}
                        >
                          <Icon icon="solar:trash-bin-trash-bold" width={18} />
                        </Button>
                      </div>
                      <Input
                        placeholder="模型标识符 (如 gpt-4o)"
                        value={model.modelId}
                        onValueChange={v => handleUpdateModel(index, { modelId: v })}
                        size="sm"
                        variant="flat"
                        description="API 调用使用的模型 ID"
                      />
                      <Select
                        label="模型类型"
                        selectedKeys={[model.type]}
                        onSelectionChange={keys => handleUpdateModel(index, { type: [...keys][0] as 'small' | 'large' | 'both' })}
                        size="sm"
                        variant="flat"
                      >
                        <SelectItem key="small">小参数模型</SelectItem>
                        <SelectItem key="large">大参数模型</SelectItem>
                        <SelectItem key="both">通用模型</SelectItem>
                      </Select>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            取消
          </Button>
          <Button color="primary" onPress={handleSave}>
            保存
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// Provider 卡片组件
function ProviderCard({
  provider,
  onEdit,
  onDelete,
}: {
  provider: AIProvider
  onEdit: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  
  return (
    <Card shadow="sm">
      <CardHeader style={{ padding: '12px 16px', cursor: 'pointer' }} onClick={() => setExpanded(!expanded)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon 
              icon={expanded ? 'solar:alt-arrow-down-linear' : 'solar:alt-arrow-right-linear'} 
              width={20} 
              style={{ color: 'var(--text-muted)' }}
            />
            <div>
              <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>{provider.name}</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                {provider.models.length} 个模型
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            <Button size="sm" variant="light" isIconOnly onPress={onEdit}>
              <Icon icon="solar:pen-bold" width={18} />
            </Button>
            <Button size="sm" variant="light" color="danger" isIconOnly onPress={onDelete}>
              <Icon icon="solar:trash-bin-trash-bold" width={18} />
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <>
          <Divider />
          <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>Base URL：</span>
              <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>
                {provider.baseUrl}
              </code>
            </div>
            {provider.models.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>可用模型：</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {provider.models.map(model => (
                    <Chip key={model.id} size="sm" variant="flat">
                      {model.name}
                    </Chip>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </>
      )}
    </Card>
  )
}

export function SettingsForm() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [saved, setSaved] = useState(false)
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()

  useEffect(() => {
    setSettings(getSettings())
  }, [])

  const handleSave = () => {
    saveSettings(settings)
    setSaved(true)
    addToast({ title: '设置已保存', color: 'success' })
    setTimeout(() => setSaved(false), 2000)
  }

  const handleReset = () => {
    setSettings(defaultSettings)
    saveSettings(defaultSettings)
    addToast({ title: '已恢复默认设置', color: 'default' })
  }

  const handleAddProvider = () => {
    setEditingProvider(null)
    onOpen()
  }

  const handleEditProvider = (provider: AIProvider) => {
    setEditingProvider(provider)
    onOpen()
  }

  const handleDeleteProvider = (providerId: string) => {
    const newProviders = settings.providers.filter(p => p.id !== providerId)
    let newSmallId = settings.defaultSmallModelId
    let newLargeId = settings.defaultLargeModelId
    
    // 如果删除的 provider 包含选中的模型，清除选择
    const deletedProvider = settings.providers.find(p => p.id === providerId)
    if (deletedProvider) {
      if (deletedProvider.models.some(m => m.id === settings.defaultSmallModelId)) {
        newSmallId = null
      }
      if (deletedProvider.models.some(m => m.id === settings.defaultLargeModelId)) {
        newLargeId = null
      }
    }
    
    setSettings(s => ({
      ...s,
      providers: newProviders,
      defaultSmallModelId: newSmallId,
      defaultLargeModelId: newLargeId,
    }))
    addToast({ title: '接口已删除', color: 'default' })
  }

  const handleSaveProvider = (provider: AIProvider) => {
    const existingIndex = settings.providers.findIndex(p => p.id === provider.id)
    let newProviders: AIProvider[]
    
    if (existingIndex >= 0) {
      newProviders = [...settings.providers]
      newProviders[existingIndex] = provider
    } else {
      newProviders = [...settings.providers, provider]
    }
    
    setSettings(s => ({ ...s, providers: newProviders }))
    addToast({ title: existingIndex >= 0 ? '接口已更新' : '接口已添加', color: 'success' })
  }

  const allModels = getAllModels(settings.providers)
  const smallModels = allModels.filter(m => m.model.type === 'small' || m.model.type === 'both')
  const largeModels = allModels.filter(m => m.model.type === 'large' || m.model.type === 'both')

  const featureSelectItems: FeatureSelectItem[] = [
    { label: '自动纠错', description: '停止输入 2.5 秒后，使用小参数模型自动检测并修复当前段落的错别字', settingKey: 'autoCorrect' },
    { label: '自动补全小片段', description: '输入时自动补全当前段落的小片段内容，提升输入效率', settingKey: 'autoComplete' },
    { label: '三线表', description: '用于创建符合学术规范的三线表', settingKey: 'threeLineTable' },
  ]

  return (
    <div style={{ padding: '32px', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>设置</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          配置 AI 模型与功能偏好，数据仅保存在本地
        </p>
      </div>

      <Divider style={{ marginBottom: 24 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* AI 接口管理 */}
        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>AI 接口配置</p>
              <Button size="sm" variant="flat" color="primary" onPress={handleAddProvider}>
                + 添加接口
              </Button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              管理多个 AI 接口，支持 OpenAI 兼容格式
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {settings.providers.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                暂无 AI 接口，点击上方按钮添加
              </p>
            ) : (
              settings.providers.map(provider => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onEdit={() => handleEditProvider(provider)}
                  onDelete={() => handleDeleteProvider(provider.id)}
                />
              ))
            )}
          </CardBody>
        </Card>

        {/* 默认模型选择 */}
        {settings.providers.length > 0 && (
          <Card shadow="sm">
            <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>默认模型选择</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                为不同任务类型选择合适的模型
              </p>
            </CardHeader>
            <Divider />
            <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Select
                label="小参数模型"
                placeholder="选择小参数模型"
                items={smallModels}
                selectedKeys={settings.defaultSmallModelId ? new Set([settings.defaultSmallModelId]) : new Set()}
                onSelectionChange={keys => setSettings(s => ({ ...s, defaultSmallModelId: keys instanceof Set && keys.size > 0 ? [...keys][0] as string : null }))}
                variant="bordered"
                description="用于自动纠错、快速补全等轻量任务"
              >
                {(item) => <SelectItem key={item.model.id} textValue={`${item.model.name} (${item.provider.name})`}>{item.model.name} ({item.provider.name})</SelectItem>}
              </Select>
              <Select
                label="大参数模型"
                placeholder="选择大参数模型"
                items={largeModels}
                selectedKeys={settings.defaultLargeModelId ? new Set([settings.defaultLargeModelId]) : new Set()}
                onSelectionChange={keys => setSettings(s => ({ ...s, defaultLargeModelId: keys instanceof Set && keys.size > 0 ? [...keys][0] as string : null }))}
                variant="bordered"
                description="用于深度分析、长文改写等复杂任务"
              >
                {(item) => <SelectItem key={item.model.id} textValue={`${item.model.name} (${item.provider.name})`}>{item.model.name} ({item.provider.name})</SelectItem>}
              </Select>
            </CardBody>
          </Card>
        )}

        {/* Feature toggles */}
        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>功能设置</p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16 }}>
            {featureSelectItems.map(item => (
              <div key={item.settingKey} className={setting.block}>
                <div>
                  <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>{item.label}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                    {item.description}
                  </p>
                </div>
                <Switch
                  isSelected={settings[item.settingKey]}
                  onValueChange={v => setSettings(s => ({ ...s, [item.settingKey]: v }))}
                  size="sm"
                  color="primary"
                />
              </div>
            ))}
          </CardBody>
        </Card>

        {/* 编辑器主题 */}
        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>编辑器主题</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              选择字体与配色风格，支持 Google Fonts 动态加载
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              {EDITOR_THEMES.map(theme => {
                const isSelected = (settings.editorThemeId ?? 'default') === theme.id
                return (
                  <div
                    key={theme.id}
                    onClick={() => {
                      if (theme.googleFontUrl) injectGoogleFont(theme.googleFontUrl)
                      setSettings(s => ({ ...s, editorThemeId: theme.id }))
                    }}
                    style={{
                      border: `2px solid ${isSelected ? 'var(--accent-color, #006fee)' : 'var(--border-color, #e4e4e7)'}`,
                      borderRadius: 10,
                      padding: '12px 14px',
                      cursor: 'pointer',
                      background: isSelected ? 'color-mix(in srgb, var(--accent-color, #006fee) 8%, transparent)' : 'var(--bg-secondary)',
                      transition: 'border-color 0.15s, background 0.15s',
                      userSelect: 'none',
                    }}
                  >
                    <p style={{
                      fontFamily: theme.fontFamily,
                      fontSize: 15,
                      fontWeight: 600,
                      margin: '0 0 2px',
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {theme.name}
                    </p>
                    <p style={{
                      fontFamily: theme.fontFamily,
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      margin: '0 0 6px',
                      lineHeight: 1.4,
                    }}>
                      {theme.description}
                    </p>
                    <p style={{
                      fontFamily: theme.fontFamily,
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      margin: 0,
                      fontStyle: 'italic',
                    }}>
                      The quick brown fox…
                    </p>
                    {isSelected && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Icon icon="solar:check-circle-bold" width={14} style={{ color: 'var(--accent-color, #006fee)' }} />
                        <span style={{ fontSize: 11, color: 'var(--accent-color, #006fee)', fontWeight: 500 }}>已选择</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </CardBody>
        </Card>

        {/* Zotero 设置 */}
        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>Zotero 设置</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              配置 Zotero 同步和引用格式
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16 }}>
            <Select
              label="引用格式"
              placeholder="选择引用格式"
              selectedKeys={settings.citationStyle ? new Set([settings.citationStyle]) : new Set(['apa'])}
              onSelectionChange={keys => setSettings(s => ({ ...s, citationStyle: keys instanceof Set && keys.size > 0 ? [...keys][0] as string : 'apa' }))}
              variant="bordered"
              description="从 Zotero 同步文献时使用的引用格式"
            >
              <SelectItem key="apa">APA 7th Edition</SelectItem>
              <SelectItem key="mla">MLA 9th Edition</SelectItem>
              <SelectItem key="ieee">IEEE</SelectItem>
              <SelectItem key="chicago-author-date">Chicago Author-Date</SelectItem>
              <SelectItem key="gb-t-7714-2015-numeric">GB/T 7714-2015 (中文)</SelectItem>
            </Select>
          </CardBody>
        </Card>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
          <Button color="primary" onPress={handleSave} isDisabled={saved}>
            {saved ? '已保存 ✓' : '保存设置'}
          </Button>
          <Button variant="light" color="default" onPress={handleReset}>
            恢复默认
          </Button>
        </div>
      </div>

      <ProviderModal
        isOpen={isOpen}
        onClose={onClose}
        provider={editingProvider}
        onSave={handleSaveProvider}
      />
    </div>
  )
}