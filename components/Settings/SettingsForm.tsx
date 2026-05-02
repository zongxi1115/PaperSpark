'use client'
import setting from './setting-block.module.css'
import { useEffect, useState, useRef } from 'react'
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
  Tooltip,
  RadioGroup,
  Radio,
} from '@heroui/react'
import { getSettings, saveSettings, generateId } from '@/lib/storage'
import type { AppSettings, FeatureSelectItem, AIProvider, AIModel } from '@/lib/types'
import { defaultSettings, selectFeatures } from '@/lib/types'
import { ADVANCED_PARSE_PROVIDERS } from '@/lib/documentParseProviders'
import { EDITOR_THEMES, injectGoogleFont } from '@/lib/editorThemes'
import { Icon } from '@iconify/react'
import { useThemeContext } from '@/components/Providers'
import { WorkspaceSnapshotCard } from '@/components/Settings/WorkspaceSnapshotCard'
import type { ThemeMode } from '@/lib/theme'

// 获取所有可用模型（用于下拉选择，排除禁用的模型）
function getAllModels(providers: AIProvider[]): { model: AIModel; provider: AIProvider }[] {
  const models: { model: AIModel; provider: AIProvider }[] = []
  for (const provider of providers) {
    for (const model of provider.models) {
      // 只返回启用的模型（enabled 为 undefined 或 true 时都算启用）
      if (model.enabled !== false) {
        models.push({ model, provider })
      }
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
  const [isTesting, setIsTesting] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (provider) {
      setName(provider.name)
      setBaseUrl(provider.baseUrl)
      setApiKey(provider.apiKey)
      // 确保 enabled 字段存在，默认为 true
      setModels(provider.models.map(m => ({ ...m, enabled: m.enabled ?? true })))
    } else {
      setName('')
      setBaseUrl('')
      setApiKey('')
      setModels([])
    }
    setSearchQuery('')
  }, [provider, isOpen])

  // 过滤模型列表
  const filteredModels = models.filter(m => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return m.name.toLowerCase().includes(query) || m.modelId.toLowerCase().includes(query)
  })

  const enabledCount = models.filter(m => m.enabled !== false).length
  const disabledCount = models.length - enabledCount

  const handleAddModel = () => {
    const newModel: AIModel = {
      id: `model-${generateId()}`,
      name: '新模型',
      modelId: '',
      providerId: provider?.id || `provider-${generateId()}`,
      type: 'both',
      enabled: true,
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

  // 切换单个模型启用状态
  const handleToggleModel = (index: number) => {
    const newModels = [...models]
    newModels[index] = { ...newModels[index], enabled: !newModels[index].enabled }
    setModels(newModels)
  }

  // 一键启用所有
  const handleEnableAll = () => {
    setModels(models.map(m => ({ ...m, enabled: true })))
  }

  // 一键禁用所有
  const handleDisableAll = () => {
    setModels(models.map(m => ({ ...m, enabled: false })))
  }

  // 测试连接
  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      addToast({ title: '请先输入 API Key', color: 'warning' })
      return
    }
    if (!baseUrl.trim()) {
      addToast({ title: '请先输入 Base URL', color: 'warning' })
      return
    }
    
    setIsTesting(true)
    try {
      const url = baseUrl.replace(/\/$/, '')
      const response = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: models.find(m => m.enabled !== false)?.modelId || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
        }),
      })
      
      if (response.ok) {
        addToast({ title: '连接成功！', color: 'success' })
      } else {
        const error = await response.json().catch(() => ({}))
        addToast({ 
          title: '连接失败', 
          description: error.error?.message || `HTTP ${response.status}`,
          color: 'danger' 
        })
      }
    } catch (error) {
      addToast({ 
        title: '连接失败', 
        description: error instanceof Error ? error.message : '网络错误',
        color: 'danger' 
      })
    } finally {
      setIsTesting(false)
    }
  }

  // 获取模型列表
  const handleFetchModels = async () => {
    if (!apiKey.trim()) {
      addToast({ title: '请先输入 API Key', color: 'warning' })
      return
    }
    if (!baseUrl.trim()) {
      addToast({ title: '请先输入 Base URL', color: 'warning' })
      return
    }
    
    setIsFetching(true)
    try {
      const url = baseUrl.replace(/\/$/, '')
      const response = await fetch(`${url}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      })
      
      if (response.ok) {
        const data = await response.json()
        const modelList = data.data || []
        
        if (modelList.length === 0) {
          addToast({ title: '未找到可用模型', color: 'warning' })
          return
        }
        
        // 去重：已存在的 modelId
        const existingIds = new Set(models.map(m => m.modelId))
        const providerId = provider?.id || `provider-${generateId()}`
        
        const newModels: AIModel[] = modelList
          .filter((m: { id: string }) => !existingIds.has(m.id))
          .map((m: { id: string }) => ({
            id: `model-${generateId()}`,
            name: m.id,
            modelId: m.id,
            providerId,
            type: 'both' as const,
            enabled: true,
          }))
        
        if (newModels.length === 0) {
          addToast({ title: '所有模型已存在', color: 'default' })
        } else {
          setModels(prev => [...prev, ...newModels])
          addToast({ title: `已获取 ${newModels.length} 个模型`, color: 'success' })
        }
      } else {
        const error = await response.json().catch(() => ({}))
        addToast({ 
          title: '获取模型列表失败', 
          description: error.error?.message || `HTTP ${response.status}`,
          color: 'danger' 
        })
      }
    } catch (error) {
      addToast({ 
        title: '获取模型列表失败', 
        description: error instanceof Error ? error.message : '网络错误',
        color: 'danger' 
      })
    } finally {
      setIsFetching(false)
    }
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
            
            {/* 测试和获取模型按钮 */}
            <div style={{ display: 'flex', gap: 8 }}>
              <Button 
                size="sm" 
                variant="flat" 
                color="success" 
                onPress={handleTestConnection}
                isLoading={isTesting}
              >
                {isTesting ? '测试中...' : '测试连接'}
              </Button>
              <Button 
                size="sm" 
                variant="flat" 
                color="primary" 
                onPress={handleFetchModels}
                isLoading={isFetching}
              >
                {isFetching ? '获取中...' : '获取模型列表'}
              </Button>
            </div>
            
            <Divider />
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ fontWeight: 600, fontSize: 14 }}>模型列表</p>
                <Chip size="sm" variant="flat" color="success">{enabledCount} 启用</Chip>
                {disabledCount > 0 && (
                  <Chip size="sm" variant="flat" color="default">{disabledCount} 禁用</Chip>
                )}
              </div>
              <Button size="sm" variant="flat" color="primary" onPress={handleAddModel}>
                + 添加模型
              </Button>
            </div>
            
            {/* 搜索和批量操作 */}
            {models.length > 0 && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  placeholder="搜索模型名称或 ID..."
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  size="sm"
                  variant="flat"
                  startContent={<Icon icon="solar:magnifer-linear" width={16} style={{ color: 'var(--text-muted)' }} />}
                  style={{ flex: 1 }}
                  isClearable
                />
                <Button size="sm" variant="flat" color="success" onPress={handleEnableAll}>
                  全部启用
                </Button>
                <Button size="sm" variant="flat" color="default" onPress={handleDisableAll}>
                  全部禁用
                </Button>
              </div>
            )}
            
            {models.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                暂无模型，点击上方按钮添加
              </p>
            ) : filteredModels.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                未找到匹配的模型
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filteredModels.map((model) => {
                  const index = models.findIndex(m => m.id === model.id)
                  const isEnabled = model.enabled !== false
                  return (
                    <Card 
                      key={model.id} 
                      shadow="sm" 
                      style={{ 
                        background: isEnabled ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                        opacity: isEnabled ? 1 : 0.6,
                      }}
                    >
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
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Tooltip content={isEnabled ? '点击禁用' : '点击启用'}>
                              <Button
                                size="sm"
                                variant="light"
                                color={isEnabled ? 'success' : 'default'}
                                isIconOnly
                                onPress={() => handleToggleModel(index)}
                              >
                                <Icon icon={isEnabled ? 'solar:check-circle-bold' : 'solar:close-circle-bold'} width={18} />
                              </Button>
                            </Tooltip>
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
                  )
                })}
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
  const [modelsExpanded, setModelsExpanded] = useState(false)
  
  // 过滤启用的模型
  const enabledModels = provider.models.filter(m => m.enabled !== false)
  // 最多显示 9 个（约 3 行）
  const displayModels = modelsExpanded ? enabledModels : enabledModels.slice(0, 9)
  const hasMoreModels = enabledModels.length > 9
  
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
                {enabledModels.length} 个模型
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
            {enabledModels.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>可用模型：</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {displayModels.map(model => (
                    <Chip 
                      key={model.id} 
                      size="sm" 
                      variant="flat"
                      color={model.enabled === false ? 'default' : 'primary'}
                    >
                      {model.name}
                    </Chip>
                  ))}
                  {hasMoreModels && !modelsExpanded && (
                    <Chip
                      size="sm"
                      variant="flat"
                      color="secondary"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setModelsExpanded(true)
                      }}
                    >
                      +{enabledModels.length - 9} 更多
                    </Chip>
                  )}
                  {modelsExpanded && hasMoreModels && (
                    <Chip
                      size="sm"
                      variant="flat"
                      color="secondary"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setModelsExpanded(false)
                      }}
                    >
                      收起
                    </Chip>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </>
      )}
    </Card>
  )
}

// 主题选择器组件
function ThemeSelector() {
  const { theme, setTheme, resolvedTheme, mounted } = useThemeContext()

  // SSR 安全：等待客户端挂载
  if (!mounted) {
    return (
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, height: 80, background: 'var(--bg-tertiary)', borderRadius: 8 }} />
        <div style={{ flex: 1, height: 80, background: 'var(--bg-tertiary)', borderRadius: 8 }} />
        <div style={{ flex: 1, height: 80, background: 'var(--bg-tertiary)', borderRadius: 8 }} />
      </div>
    )
  }

  const options: { value: ThemeMode; label: string; icon: string; description: string }[] = [
    { value: 'light', label: '浅色', icon: 'solar:sun-bold', description: '始终使用浅色模式' },
    { value: 'dark', label: '深色', icon: 'solar:moon-bold', description: '始终使用深色模式' },
    { value: 'system', label: '跟随系统', icon: 'solar:monitor-bold', description: '自动跟随系统设置' },
  ]

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {options.map((option) => {
        const isSelected = theme === option.value
        return (
          <div
            key={option.value}
            onClick={() => setTheme(option.value)}
            style={{
              flex: 1,
              padding: '16px 12px',
              border: `2px solid ${isSelected ? 'var(--accent-color)' : 'var(--border-color)'}`,
              borderRadius: 10,
              cursor: 'pointer',
              background: isSelected ? 'color-mix(in srgb, var(--accent-color) 10%, transparent)' : 'var(--bg-secondary)',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              textAlign: 'center',
            }}
          >
            <Icon 
              icon={option.icon} 
              width={24} 
              style={{ color: isSelected ? 'var(--accent-color)' : 'var(--text-muted)' }} 
            />
            <p style={{ 
              fontWeight: 600, 
              fontSize: 14, 
              margin: 0,
              color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
            }}>
              {option.label}
            </p>
            <p style={{ 
              fontSize: 11, 
              color: 'var(--text-muted)', 
              margin: 0,
              lineHeight: 1.3,
            }}>
              {option.description}
            </p>
          </div>
        )
      })}
    </div>
  )
}

export function SettingsForm() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  
  // 测试嵌入模型连接状态
  const [testingEmbedding, setTestingEmbedding] = useState(false)
  
  // 自动保存相关
  const isInitialized = useRef(false)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    setSettings(getSettings())
  }, [])
  
  // 自动保存：settings 变化后 800ms 自动保存
  useEffect(() => {
    // 首次加载时不触发保存
    if (!isInitialized.current) {
      isInitialized.current = true
      return
    }
    
    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    // 800ms 后自动保存
    saveTimeoutRef.current = setTimeout(() => {
      saveSettings(settings)
      addToast({ title: '设置已自动保存', color: 'success' })
    }, 800)
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [settings])
  
  // 测试嵌入模型连接
  const testEmbeddingConnection = async () => {
    const embedding = settings.embeddingModel
    if (!embedding?.apiKey) {
      addToast({ title: '请先配置嵌入模型 API Key', color: 'warning' })
      return
    }
    if (!embedding?.modelName) {
      addToast({ title: '请先配置模型名称', color: 'warning' })
      return
    }
    
    setTestingEmbedding(true)
    try {
      const baseUrl = embedding.baseUrl.replace(/\/embeddings$/, '').replace(/\/$/, '')
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${embedding.apiKey}`,
        },
        body: JSON.stringify({
          model: embedding.modelName,
          input: 'test',
        }),
      })
      
      if (response.ok) {
        addToast({ title: '嵌入模型连接成功！', color: 'success' })
      } else {
        const error = await response.json().catch(() => ({}))
        addToast({ 
          title: '连接失败', 
          description: error.error?.message || `HTTP ${response.status}`,
          color: 'danger' 
        })
      }
    } catch (error) {
      addToast({ 
        title: '连接失败', 
        description: error instanceof Error ? error.message : '网络错误',
        color: 'danger' 
      })
    } finally {
      setTestingEmbedding(false)
    }
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
    
    const newSettings = {
      ...settings,
      providers: newProviders,
      defaultSmallModelId: newSmallId,
      defaultLargeModelId: newLargeId,
    }
    
    // 立即保存，跳过自动保存的 toast
    saveSettings(newSettings)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    setSettings(newSettings)
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
    
    const newSettings = { ...settings, providers: newProviders }
    
    // 立即保存，跳过自动保存的 toast
    saveSettings(newSettings)
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    setSettings(newSettings)
    addToast({ title: existingIndex >= 0 ? '接口已更新' : '接口已添加', color: 'success' })
  }

  const allModels = getAllModels(settings.providers)
  const smallModels = allModels.filter(m => m.model.type === 'small' || m.model.type === 'both')
  const largeModels = allModels.filter(m => m.model.type === 'large' || m.model.type === 'both')

  const featureSelectItems: FeatureSelectItem[] = [
    { label: '自动纠错', description: '停止输入 2.5 秒后，使用小参数模型自动检测并修复当前段落的错别字', settingKey: 'autoCorrect' },
    { label: '自动补全小片段', description: '输入时自动补全当前段落的小片段内容，提升输入效率', settingKey: 'autoComplete' },
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

        {/* 外观设置 */}
        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>外观设置</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              切换应用主题，选择跟随系统或手动设置
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16 }}>
            <ThemeSelector />
          </CardBody>
        </Card>

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

        {/* 标题字体大小 */}
        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>标题字体大小</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              自定义编辑器中各级标题的字体大小
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 80, fontSize: 14, fontWeight: 500 }}>
                <span style={{ fontSize: (settings.headingFontSizes?.h1 ?? 28), fontWeight: 600 }}>H1</span>
              </div>
              <Input
                type="number"
                min={18}
                max={48}
                value={String(settings.headingFontSizes?.h1 ?? 28)}
                onValueChange={v => {
                  const num = parseInt(v, 10)
                  if (!isNaN(num) && num >= 18 && num <= 48) {
                    setSettings(s => ({
                      ...s,
                      headingFontSizes: { ...s.headingFontSizes, h1: num, h2: s.headingFontSizes?.h2 ?? 22, h3: s.headingFontSizes?.h3 ?? 18 },
                    }))
                  }
                }}
                variant="bordered"
                size="sm"
                style={{ width: 100 }}
                endContent={<span style={{ fontSize: 12, color: 'var(--text-muted)' }}>px</span>}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 80, fontSize: 14, fontWeight: 500 }}>
                <span style={{ fontSize: (settings.headingFontSizes?.h2 ?? 22), fontWeight: 600 }}>H2</span>
              </div>
              <Input
                type="number"
                min={14}
                max={36}
                value={String(settings.headingFontSizes?.h2 ?? 22)}
                onValueChange={v => {
                  const num = parseInt(v, 10)
                  if (!isNaN(num) && num >= 14 && num <= 36) {
                    setSettings(s => ({
                      ...s,
                      headingFontSizes: { ...s.headingFontSizes, h1: s.headingFontSizes?.h1 ?? 28, h2: num, h3: s.headingFontSizes?.h3 ?? 18 },
                    }))
                  }
                }}
                variant="bordered"
                size="sm"
                style={{ width: 100 }}
                endContent={<span style={{ fontSize: 12, color: 'var(--text-muted)' }}>px</span>}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 80, fontSize: 14, fontWeight: 500 }}>
                <span style={{ fontSize: (settings.headingFontSizes?.h3 ?? 18), fontWeight: 600 }}>H3</span>
              </div>
              <Input
                type="number"
                min={12}
                max={28}
                value={String(settings.headingFontSizes?.h3 ?? 18)}
                onValueChange={v => {
                  const num = parseInt(v, 10)
                  if (!isNaN(num) && num >= 12 && num <= 28) {
                    setSettings(s => ({
                      ...s,
                      headingFontSizes: { ...s.headingFontSizes, h1: s.headingFontSizes?.h1 ?? 28, h2: s.headingFontSizes?.h2 ?? 22, h3: num },
                    }))
                  }
                }}
                variant="bordered"
                size="sm"
                style={{ width: 100 }}
                endContent={<span style={{ fontSize: 12, color: 'var(--text-muted)' }}>px</span>}
              />
            </div>
            <Button
              size="sm"
              variant="flat"
              color="default"
              onPress={() => setSettings(s => ({
                ...s,
                headingFontSizes: { h1: 28, h2: 22, h3: 18 },
              }))}
              style={{ alignSelf: 'flex-start' }}
            >
              恢复默认
            </Button>
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

        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>高级解析</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              配置重型文档解析 provider。`pdfjs` 仍作为基础本地兼容解析，不在这里选择。
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Select
              label="默认高级解析方案"
              placeholder="选择高级解析 provider"
              selectedKeys={new Set([settings.documentParse?.defaultAdvancedProvider || defaultSettings.documentParse!.defaultAdvancedProvider])}
              onSelectionChange={keys => setSettings(s => ({
                ...s,
                documentParse: {
                  defaultAdvancedProvider: keys instanceof Set && keys.size > 0
                    ? [...keys][0] as 'surya-local' | 'surya-modal' | 'mineru'
                    : defaultSettings.documentParse!.defaultAdvancedProvider,
                  providers: s.documentParse?.providers || defaultSettings.documentParse!.providers,
                },
              }))}
              variant="bordered"
              description="沉浸式阅读、批量解析等高级解析入口默认使用的 provider"
            >
              {Object.values(ADVANCED_PARSE_PROVIDERS).map(provider => (
                <SelectItem key={provider.id}>{provider.label}</SelectItem>
              ))}
            </Select>

            <Input
              label="Surya 本地服务 URL"
              placeholder="http://127.0.0.1:8765"
              value={settings.documentParse?.providers?.['surya-local']?.baseUrl || ''}
              onValueChange={value => setSettings(s => ({
                ...s,
                documentParse: {
                  defaultAdvancedProvider: s.documentParse?.defaultAdvancedProvider || defaultSettings.documentParse!.defaultAdvancedProvider,
                  providers: {
                    ...(s.documentParse?.providers || defaultSettings.documentParse!.providers),
                    'surya-local': {
                      ...(s.documentParse?.providers?.['surya-local'] || defaultSettings.documentParse!.providers['surya-local']),
                      baseUrl: value,
                    },
                  },
                },
              }))}
              variant="bordered"
              size="sm"
              description="本机 Python、Docker 或局域网服务地址"
            />

            <Input
              label="Surya Modal 服务 URL"
              placeholder="https://your-modal-web-endpoint"
              value={settings.documentParse?.providers?.['surya-modal']?.baseUrl || ''}
              onValueChange={value => setSettings(s => ({
                ...s,
                documentParse: {
                  defaultAdvancedProvider: s.documentParse?.defaultAdvancedProvider || defaultSettings.documentParse!.defaultAdvancedProvider,
                  providers: {
                    ...(s.documentParse?.providers || defaultSettings.documentParse!.providers),
                    'surya-modal': {
                      ...(s.documentParse?.providers?.['surya-modal'] || defaultSettings.documentParse!.providers['surya-modal']),
                      baseUrl: value,
                    },
                  },
                },
              }))}
              variant="bordered"
              size="sm"
              description="部署在 Modal 上的同协议解析服务地址"
            />

            <Input
              label="MinerU 服务 URL"
              placeholder="https://mineru.net"
              value={settings.documentParse?.providers?.mineru?.baseUrl || ''}
              onValueChange={value => setSettings(s => ({
                ...s,
                documentParse: {
                  defaultAdvancedProvider: s.documentParse?.defaultAdvancedProvider || defaultSettings.documentParse!.defaultAdvancedProvider,
                  providers: {
                    ...(s.documentParse?.providers || defaultSettings.documentParse!.providers),
                    mineru: {
                      ...(s.documentParse?.providers?.mineru || defaultSettings.documentParse!.providers.mineru),
                      baseUrl: value,
                    },
                  },
                },
              }))}
              variant="bordered"
              size="sm"
              description="MinerU 精准 API 服务根地址"
            />

            <Input
              label="MinerU API Key"
              placeholder="token"
              type="password"
              value={settings.documentParse?.providers?.mineru?.apiKey || ''}
              onValueChange={value => setSettings(s => ({
                ...s,
                documentParse: {
                  defaultAdvancedProvider: s.documentParse?.defaultAdvancedProvider || defaultSettings.documentParse!.defaultAdvancedProvider,
                  providers: {
                    ...(s.documentParse?.providers || defaultSettings.documentParse!.providers),
                    mineru: {
                      ...(s.documentParse?.providers?.mineru || defaultSettings.documentParse!.providers.mineru),
                      apiKey: value,
                    },
                  },
                },
              }))}
              variant="bordered"
              size="sm"
              description="仅本地存储，用于调用 MinerU 云端精准解析"
            />

            <Select
              label="MinerU 模型版本"
              placeholder="选择模型版本"
              selectedKeys={new Set([settings.documentParse?.providers?.mineru?.modelVersion || defaultSettings.documentParse!.providers.mineru?.modelVersion || 'vlm'])}
              onSelectionChange={keys => setSettings(s => ({
                ...s,
                documentParse: {
                  defaultAdvancedProvider: s.documentParse?.defaultAdvancedProvider || defaultSettings.documentParse!.defaultAdvancedProvider,
                  providers: {
                    ...(s.documentParse?.providers || defaultSettings.documentParse!.providers),
                    mineru: {
                      ...(s.documentParse?.providers?.mineru || defaultSettings.documentParse!.providers.mineru),
                      modelVersion: keys instanceof Set && keys.size > 0
                        ? [...keys][0] as string
                        : (defaultSettings.documentParse!.providers.mineru?.modelVersion || 'vlm'),
                    },
                  },
                },
              }))}
              variant="bordered"
              description="MinerU 当前支持的解析模型版本"
            >
              <SelectItem key="vlm">vlm</SelectItem>
              <SelectItem key="pipeline">pipeline</SelectItem>
            </Select>
          </CardBody>
        </Card>

        {/* RAG 模型配置 */}
        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>RAG 模型配置</p>
              <Button
                size="sm"
                variant="flat"
                color="primary"
                onPress={() => setSettings(s => ({
                  ...s,
                  embeddingModel: {
                    baseUrl: 'https://api.openai.com/v1/embeddings',
                    apiKey: '',
                    modelName: 'text-embedding-3-small',
                  },
                }))}
              >
                + 配置嵌入模型
              </Button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              配置知识库检索用的嵌入模型和重排序模型
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 嵌入模型配置 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Icon icon="solar:database-bold" width={18} style={{ color: 'var(--text-muted)' }} />
                <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>嵌入模型</p>
                {settings.embeddingModel?.apiKey && (
                  <Chip size="sm" color="success" variant="flat">已配置</Chip>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Input
                  label="Base URL"
                  placeholder="https://api.openai.com/v1/embeddings"
                  value={settings.embeddingModel?.baseUrl || ''}
                  onValueChange={v => setSettings(s => ({
                    ...s,
                    embeddingModel: { ...s.embeddingModel, baseUrl: v, apiKey: s.embeddingModel?.apiKey || '', modelName: s.embeddingModel?.modelName || '' },
                  }))}
                  variant="bordered"
                  size="sm"
                  description="嵌入 API 端点地址"
                />
                <Input
                  label="模型名称"
                  placeholder="text-embedding-3-small"
                  value={settings.embeddingModel?.modelName || ''}
                  onValueChange={v => setSettings(s => ({
                    ...s,
                    embeddingModel: { ...s.embeddingModel, modelName: v, baseUrl: s.embeddingModel?.baseUrl || '', apiKey: s.embeddingModel?.apiKey || '' },
                  }))}
                  variant="bordered"
                  size="sm"
                  description="如 text-embedding-3-small、text-embedding-ada-002"
                />
                <Input
                  label="API Key"
                  placeholder="sk-..."
                  type="password"
                  value={settings.embeddingModel?.apiKey || ''}
                  onValueChange={v => setSettings(s => ({
                    ...s,
                    embeddingModel: { ...s.embeddingModel, apiKey: v, baseUrl: s.embeddingModel?.baseUrl || '', modelName: s.embeddingModel?.modelName || '' },
                  }))}
                  variant="bordered"
                  size="sm"
                  description="密钥仅存储在本地"
                />
                <Button 
                  size="sm" 
                  variant="flat" 
                  color="success" 
                  onPress={testEmbeddingConnection}
                  isLoading={testingEmbedding}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {testingEmbedding ? '测试中...' : '测试连接'}
                </Button>
              </div>
            </div>

            <Divider />

            {/* 重排序模型配置 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon icon="solar:sort-vertical-bold" width={18} style={{ color: 'var(--text-muted)' }} />
                  <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>重排序模型</p>
                  {settings.rerankModel?.apiKey && (
                    <Chip size="sm" color="success" variant="flat">已配置</Chip>
                  )}
                </div>
                {!settings.rerankModel && (
                  <Button
                    size="sm"
                    variant="flat"
                    color="default"
                    onPress={() => setSettings(s => ({
                      ...s,
                      rerankModel: {
                        baseUrl: '',
                        apiKey: '',
                        modelName: '',
                      },
                    }))}
                  >
                    + 配置
                  </Button>
                )}
              </div>
              {settings.rerankModel ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Input
                    label="Base URL"
                    placeholder="https://api.cohere.ai/v1/rerank"
                    value={settings.rerankModel.baseUrl || ''}
                    onValueChange={v => setSettings(s => ({
                      ...s,
                      rerankModel: { ...s.rerankModel!, baseUrl: v },
                    }))}
                    variant="bordered"
                    size="sm"
                    description="重排序 API 端点地址"
                  />
                  <Input
                    label="模型名称"
                    placeholder="rerank-v3.5"
                    value={settings.rerankModel.modelName || ''}
                    onValueChange={v => setSettings(s => ({
                      ...s,
                      rerankModel: { ...s.rerankModel!, modelName: v },
                    }))}
                    variant="bordered"
                    size="sm"
                    description="如 rerank-v3.5、BAAI/bge-reranker-v2-m3"
                  />
                  <Input
                    label="API Key"
                    placeholder="API Key"
                    type="password"
                    value={settings.rerankModel.apiKey || ''}
                    onValueChange={v => setSettings(s => ({
                      ...s,
                      rerankModel: { ...s.rerankModel!, apiKey: v },
                    }))}
                    variant="bordered"
                    size="sm"
                    description="密钥仅存储在本地"
                  />
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    onPress={() => setSettings(s => ({ ...s, rerankModel: undefined }))}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    移除重排序配置
                  </Button>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  重排序模型可选，配置后可提升检索结果的相关性排序
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>沉浸式 Canvas 提示词</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              配置 AI 生成 Canvas 网页时使用的默认提示词
            </p>
          </CardHeader>
          <Divider />
          <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              value={settings.immersiveCanvasPrompt || ''}
              onChange={(event) => setSettings(s => ({ ...s, immersiveCanvasPrompt: event.target.value }))}
              rows={5}
              placeholder="请输入 Canvas 网页生成提示词"
              style={{
                width: '100%',
                borderRadius: 10,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                padding: '10px 12px',
                resize: 'vertical',
                outline: 'none',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              该提示词会在沉浸式阅读的 Canvas 标签页中作为默认生成指令。
            </p>
          </CardBody>
        </Card>

        <WorkspaceSnapshotCard />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
          <Button variant="light" color="default" onPress={handleReset}>
            恢复默认设置
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
