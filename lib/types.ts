export interface AppDocument {
  id: string
  title: string
  content: unknown[]
  createdAt: string
  updatedAt: string
}

export interface ModelConfig {
  baseUrl: string
  apiKey: string
  modelName: string
}

// AI 接口提供者配置
export interface AIProvider {
  id: string
  name: string // 用户自定义名称，如 "OpenAI", "Claude", "本地模型"
  baseUrl: string
  apiKey: string
  models: AIModel[] // 该接口下可用的模型列表
  createdAt: string
  updatedAt: string
}

// 单个模型配置
export interface AIModel {
  id: string
  name: string // 模型显示名称
  modelId: string // API 调用使用的模型标识符
  providerId: string // 所属 provider 的 id
  type: 'small' | 'large' | 'both' // 模型类型：小参数、大参数或两者皆可
}

/**
 * 功能选择项列表，后续增加功能只需在此处添加对应项，并在 AppSettings 中添加对应字段即可
 * autoCorrect: 自动纠错，停止输入 2.5 秒后，使用小参数模型自动检测并修复当前段落的错别字
 * autoComplete: 自动补全小片段，输入时自动补全当前段落的小片段内容，提升输入效率
 * threeLineTable: 三线表，用于创建符合学术规范的三线表
 */
export const selectFeatures = ['autoCorrect', 'autoComplete', 'threeLineTable'] as const
export type FeatureSelectItem = {
  label: string
  description: string
  settingKey: typeof selectFeatures[number]
}


export type AppSettings = {
  // 新的多接口配置
  providers: AIProvider[]
  defaultSmallModelId: string | null // 选中的小参数模型 id
  defaultLargeModelId: string | null // 选中的大参数模型 id
  // 保留旧配置用于兼容迁移
  smallModel?: ModelConfig
  largeModel?: ModelConfig
} & { [key in typeof selectFeatures[number]]: boolean
}

function getDefaultSettings(): AppSettings {
  const defaultProviders: AIProvider[] = [
    {
      id: 'provider-openrouter',
      name: 'OpenRouter',
      baseUrl: process.env.NEXT_PUBLIC_SMALL_MODEL_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.NEXT_PUBLIC_SMALL_MODEL_API_KEY || '',
      models: [
        {
          id: 'model-step-3.5-flash',
          name: 'Step 3.5 Flash (免费)',
          modelId: process.env.NEXT_PUBLIC_SMALL_MODEL_NAME || 'stepfun/step-3.5-flash:free',
          providerId: 'provider-openrouter',
          type: 'small',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'provider-openai',
      name: 'OpenAI',
      baseUrl: process.env.NEXT_PUBLIC_LARGE_MODEL_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.NEXT_PUBLIC_LARGE_MODEL_API_KEY || '',
      models: [
        {
          id: 'model-gpt-4o',
          name: 'GPT-4o',
          modelId: process.env.NEXT_PUBLIC_LARGE_MODEL_NAME || 'gpt-4o',
          providerId: 'provider-openai',
          type: 'large',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]

  return {
    providers: defaultProviders,
    defaultSmallModelId: 'model-step-3.5-flash',
    defaultLargeModelId: 'model-gpt-4o',
    smallModel: {
      baseUrl: process.env.NEXT_PUBLIC_SMALL_MODEL_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.NEXT_PUBLIC_SMALL_MODEL_API_KEY || '',
      modelName: process.env.NEXT_PUBLIC_SMALL_MODEL_NAME || 'stepfun/step-3.5-flash:free',
    },
    largeModel: {
      baseUrl: process.env.NEXT_PUBLIC_LARGE_MODEL_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.NEXT_PUBLIC_LARGE_MODEL_API_KEY || '',
      modelName: process.env.NEXT_PUBLIC_LARGE_MODEL_NAME || 'gpt-4o',
    },
    ...selectFeatures.reduce((acc, key) => ({ ...acc, [key]: false }), {} as Record<typeof selectFeatures[number], boolean>),
  }
}

export const defaultSettings: AppSettings = getDefaultSettings()

// 知识库条目类型
export type KnowledgeSourceType = 'zotero' | 'upload' | 'url'

export interface KnowledgeItem {
  id: string
  title: string
  authors: string[]
  abstract?: string
  year?: string
  journal?: string
  doi?: string
  url?: string
  tags?: string[]
  sourceType: KnowledgeSourceType
  sourceId?: string // Zotero item key or file path
  fileName?: string // for uploaded files
  fileType?: 'pdf' | 'docx' | 'doc'
  fileSize?: number
  cachedSummary?: string // AI 生成的摘要缓存
  // Zotero 附件相关
  hasAttachment?: boolean
  attachmentUrl?: string
  attachmentFileName?: string
  // 引用格式
  bib?: string
  itemType?: string
  createdAt: string
  updatedAt: string
}

// Zotero 配置
export interface ZoteroConfig {
  userId: string
  apiKey: string
  lastSync?: string
}

// 知识库状态
export interface KnowledgeState {
  items: KnowledgeItem[]
  zoteroConfig: ZoteroConfig | null
}

// 随记想法类型
export interface Thought {
  id: string
  title: string // AI 生成的标题或用户自定义标题
  summary: string // AI 生成的概述
  content: unknown[] // BlockNote 内容
  createdAt: string
  updatedAt: string
  aiProcessedAt?: string // AI 处理时间
}

// 智能体类型
export interface Agent {
  id: string
  title: string // 智能体名称
  prompt: string // 系统 prompt
  isPreset: boolean // 是否为预设
  isDefault?: boolean // 是否为默认选中
}
