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
  smallModel: ModelConfig
  largeModel: ModelConfig
} & { [key in typeof selectFeatures[number]]: boolean
}

function getDefaultSettings(): AppSettings {

  return {
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
  createdAt: string
  updatedAt: string
}
