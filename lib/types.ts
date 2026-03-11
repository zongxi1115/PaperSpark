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
  // Zotero 引用格式
  citationStyle?: string
  // 编辑器主题
  editorThemeId?: string
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
    citationStyle: 'apa',
    editorThemeId: 'default',
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
export type KnowledgeSourceType = 'zotero' | 'upload' | 'url' | 'literature-search'

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
  // 沉浸式阅读相关
  hasImmersiveCache?: boolean // 是否有沉浸式翻译缓存
  immersiveCacheAt?: string // 缓存时间
  extractedMetadata?: PDFMetadata // 提取的元数据缓存
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

// 助手对话消息类型
export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

// 助手对话会话类型
export interface AssistantConversation {
  id: string
  title: string // 对话标题（自动生成或用户编辑）
  messages: AssistantMessage[]
  agentId?: string // 使用的智能体 ID
  modelName?: string // 使用的模型名称
  createdAt: string
  updatedAt: string
}

// 助手临时便签类型
export interface AssistantNote {
  id: string
  content: string // 便签内容
  messageId?: string // 关联的消息 ID（可选）
  conversationId?: string // 关联的对话 ID（可选）
  createdAt: string
  updatedAt: string
}

// ============ 沉浸式阅读相关类型 ============

// 文本块类型
export type TextBlockType = 'paragraph' | 'title' | 'subtitle' | 'formula' | 'caption' | 'reference' | 'table' | 'list' | 'header' | 'footer'

// 文本块边界框
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

// 文本块样式
export interface TextStyle {
  fontSize: number
  fontFamily: string
  isBold: boolean
  isItalic: boolean
}

// 单个文本项（PDF 原始提取的最小单位）
export interface TextItem {
  id: string
  text: string
  bbox: BoundingBox
  style: TextStyle
  pageNum: number
}

// 文本块（合并后的语义单元）
export interface TextBlock {
  id: string
  type: TextBlockType
  text: string // 原文
  translated?: string // 翻译
  bbox: BoundingBox
  style: TextStyle
  pageNum: number
  itemIds: string[] // 包含的原始 TextItem id
}

// PDF 页面缓存
export interface PDFPageCache {
  id: string // `${documentId}_page_${pageNum}`
  documentId: string
  pageNum: number
  width: number
  height: number
  blocks: TextBlock[]
  createdAt: string
  updatedAt: string
}

// PDF 文档元数据
export interface PDFMetadata {
  title: string
  authors: string[]
  abstract: string
  year: string
  journal: string
  keywords: string[]
  references: string[]
}

// PDF 文档缓存
export interface PDFDocumentCache {
  id: string // 对应知识库条目的 id
  knowledgeItemId: string
  fileName: string
  pageCount: number
  metadata: PDFMetadata
  parsedAt: string
  updatedAt: string
}

// 翻译缓存
export interface TranslationCache {
  id: string // `${documentId}_translation`
  documentId: string
  modelUsed: string
  translatedAt: string
  blocks: {
    blockId: string
    original: string
    translated: string
  }[]
}

// 智能分块结果
export interface SmartChunk {
  id: string
  type: TextBlockType
  blockIds: string[] // 包含的原始 block id
  text: string // 合并后的文本
  translated?: string
}

export interface TranslationBlockPayload {
  id: string
  type: TextBlockType
  text: string
  pageNum: number
  bbox: BoundingBox
  style: TextStyle
}

// ============ 批注相关类型 ============

// 高亮颜色
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

// 高亮颜色映射
export const HIGHLIGHT_COLORS: Record<HighlightColor, { bg: string; border: string }> = {
  yellow: { bg: 'rgba(255, 235, 59, 0.4)', border: 'rgba(255, 193, 7, 0.8)' },
  green: { bg: 'rgba(76, 175, 80, 0.3)', border: 'rgba(76, 175, 80, 0.8)' },
  blue: { bg: 'rgba(33, 150, 243, 0.3)', border: 'rgba(33, 150, 243, 0.8)' },
  pink: { bg: 'rgba(233, 30, 99, 0.25)', border: 'rgba(233, 30, 99, 0.8)' },
  purple: { bg: 'rgba(156, 39, 176, 0.3)', border: 'rgba(156, 39, 176, 0.8)' },
}

// 批注类型
export type AnnotationType = 'highlight' | 'note' | 'underline'

// 批注数据
export interface PDFAnnotation {
  id: string
  documentId: string
  type: AnnotationType
  pageNum: number
  // 文本选择信息
  selectedText: string
  startOffset: number // 在页面文本中的起始位置
  endOffset: number // 在页面文本中的结束位置
  // 位置信息（相对于页面）
  rects: BoundingBox[] // 可能跨多行
  // 样式
  color: HighlightColor
  // 批注内容（note类型）
  content?: string
  // 元数据
  createdAt: string
  updatedAt: string
}

// 流式翻译事件
export interface TranslationStreamEvent {
  type: 'start' | 'progress' | 'chunk' | 'complete' | 'error'
  data?: {
    chunkId?: string
    blockId?: string
    original?: string
    translated?: string
    progress?: number
    total?: number
    error?: string
    done?: boolean
  }
}
