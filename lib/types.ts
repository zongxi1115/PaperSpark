// 文章作者类型
export interface ArticleAuthor {
  id: string
  name: string
  affiliation: string // 单位
  email: string
}

export interface AppDocument {
  id: string
  title: string // 文档标题（列表显示用）
  content: unknown[]
  createdAt: string
  updatedAt: string
  // 文章元数据
  articleTitle?: string // 文章标题
  articleAuthors?: ArticleAuthor[] // 作者列表
  articleAbstract?: string // 摘要
  articleKeywords?: string[] // 关键词
  articleDate?: string // 文章日期
}

// 文档版本快照类型
export interface DocumentVersion {
  id: string
  documentId: string
  title: string // 版本名称（自动生成或用户自定义）
  content: unknown[] // BlockNote 文档内容快照
  articleTitle?: string
  articleAuthors?: ArticleAuthor[]
  articleAbstract?: string
  articleKeywords?: string[]
  articleDate?: string
  isAuto?: boolean // 是否为自动保存的版本
  wordCount?: number // 字数统计
  createdAt: string
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
  enabled?: boolean // 是否启用，默认为 true
}

/**
 * 功能选择项列表，后续增加功能只需在此处添加对应项，并在 AppSettings 中添加对应字段即可
 * autoCorrect: 自动纠错，停止输入 2.5 秒后，使用小参数模型自动检测并修复当前段落的错别字
 * autoComplete: 自动补全小片段，输入时自动补全当前段落的小片段内容，提升输入效率
 * threeLineTable: 三线表，用于创建符合学术规范的三线表
 */
export const selectFeatures = ['autoCorrect', 'autoComplete'] as const
export type FeatureSelectItem = {
  label: string
  description: string
  settingKey: typeof selectFeatures[number]
}


// 嵌入模型配置
export interface EmbeddingModelConfig {
  baseUrl: string
  apiKey: string
  modelName: string
}

// 重排序模型配置
export interface RerankModelConfig {
  baseUrl: string
  apiKey: string
  modelName: string
}

export type AdvancedParseProviderId = 'surya-local' | 'surya-modal' | 'mineru'
export type DocumentParseEngine = 'pdfjs' | 'surya' | 'mineru'
export type DocumentParseRuntime = 'browser' | 'local-python' | 'modal' | 'remote-http'

export interface AdvancedParseProviderSettings {
  baseUrl?: string
  apiKey?: string
  modelVersion?: string
  enabled?: boolean
}

export interface DocumentParseSettings {
  defaultAdvancedProvider: AdvancedParseProviderId
  providers: Partial<Record<AdvancedParseProviderId, AdvancedParseProviderSettings>>
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
  // 标题字体大小设置
  headingFontSizes?: {
    h1?: number // 1级标题字号
    h2?: number // 2级标题字号
    h3?: number // 3级标题字号
  }
  // 嵌入模型配置（RAG 用）
  embeddingModel?: EmbeddingModelConfig
  // 重排序模型配置（RAG 用）
  rerankModel?: RerankModelConfig
  // 文档解析配置
  documentParse?: DocumentParseSettings
  // 沉浸式 Canvas 生成提示词
  immersiveCanvasPrompt?: string
} & { [key in typeof selectFeatures[number]]: boolean
}

function getDefaultSettings(): AppSettings {
  const envDefaultProvider = process.env.NEXT_PUBLIC_DEFAULT_ADVANCED_PARSE_PROVIDER
  const defaultAdvancedProvider: AdvancedParseProviderId =
    envDefaultProvider === 'surya-modal' || envDefaultProvider === 'mineru' || envDefaultProvider === 'surya-local'
      ? envDefaultProvider
      : 'surya-local'
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
    // 嵌入模型默认配置
    embeddingModel: {
      baseUrl: process.env.NEXT_PUBLIC_EMBEDDING_BASE_URL || 'https://api.openai.com/v1/embeddings',
      apiKey: process.env.NEXT_PUBLIC_EMBEDDING_API_KEY || '',
      modelName: process.env.NEXT_PUBLIC_EMBEDDING_NAME || 'text-embedding-3-small',
    },
    // 重排序模型默认配置（可选）
    rerankModel: undefined,
    documentParse: {
      defaultAdvancedProvider,
      providers: {
        'surya-local': {
          baseUrl:
            process.env.NEXT_PUBLIC_SURYA_LOCAL_SERVICE_URL ||
            process.env.NEXT_PUBLIC_SURYA_SERVICE_URL ||
            process.env.NEXT_PUBLIC_SURYA_OCR_SERVICE_URL ||
            'http://127.0.0.1:8765',
          enabled: true,
        },
        'surya-modal': {
          baseUrl: process.env.NEXT_PUBLIC_SURYA_MODAL_SERVICE_URL || '',
          enabled: true,
        },
        mineru: {
          baseUrl: process.env.NEXT_PUBLIC_MINERU_SERVICE_URL || 'https://mineru.net',
          apiKey: process.env.NEXT_PUBLIC_MINERU_API_KEY || '',
          modelVersion: process.env.NEXT_PUBLIC_MINERU_MODEL_VERSION || 'vlm',
          enabled: true,
        },
      },
    },
    immersiveCanvasPrompt: `角色设定
你现在是一位顶尖的创意编程大师 (Creative Coder) 和数据可视化专家。
请将我的论文内核“翻译”成一个高度动态、充满视觉交互的网页（单文件 HTML，内联 CSS/JS）。不要给我传统的文本阅读界面！我要的是生动的视觉隐喻和探索感！ 输出语言为中文。

论文核心概念
[这里用一两句话说明论文最核心的机制或结论，例如：输入变量A如何影响结果B，或者某个系统的运转逻辑]

⚡ 核心可视化与交互要求（必须实现）
请使用纯原生 HTML5 Canvas、复杂的 SVG 动画或 CSS3D，实现以下高阶交互：

滚动叙事 (Scrollytelling)： 页面主体是一个全屏的可视化画布。随着用户向下滚动鼠标，画布上的图形、数据模型或节点网络会发生丝滑的形态演变，一步步推演论文的逻辑脉络。

核心概念“活体化” (Interactive Metaphors)： 将论文的抽象机制具象化。例如，使用可拖拽的动态节点（Force-directed graph）、随鼠标互动的粒子系统、或者动态生长的图表。用户鼠标移入或拖拽时，图形必须给出弹性的物理反馈。

沙盘式参数模拟 (Playground Simulation)： 页面中必须包含一个“控制台”面板（包含滑块 Input Range、开关 Toggle 等）。用户可以自己调节参数，主画布上的可视化模型必须实时响应这些变化，直观展示论文的结论或变量关系。

沉浸式视觉引导： 每次状态切换或数据更新时，必须有丝滑的缓动动画（Easing transitions），严禁画面的生硬闪烁。辅以极简的浮层提示（Tooltip）来解释当前视觉现象代表的论文观点。

代码要求

必须包含真实的绘图逻辑（如 Canvas requestAnimationFrame 循环 或 SVG stroke-dasharray 动画）。

界面极简、现代、充满科技感或艺术感（黑底或纯白底色，配合高亮强调色）。

代码需完整可运行，不要省略核心的可视化渲染逻辑。

直接输出完整的 HTML 代码。`,
    // 标题字体大小默认设置
    headingFontSizes: {
      h1: 28,
      h2: 22,
      h3: 18,
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
  // RAG 索引相关
  ragStatus?: 'idle' | 'indexing' | 'indexed' | 'failed'
  ragIndexedAt?: string
  ragChunks?: number
  ragStoredLocally?: boolean
  ragError?: string
  ragDocumentUpdatedAt?: string
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

// ============ 资产库相关类型 ============

// 预设资产类型
export const PRESET_ASSET_TYPES = [
  { id: 'material', name: '素材', icon: 'solar:document-bold', color: '#3b82f6', description: '收集的资料、素材' },
  { id: 'note', name: '随记', icon: 'solar:pen-bold', color: '#10b981', description: '随笔、想法记录' },
] as const

// 资产类型定义（用户可自定义扩展）
export interface AssetType {
  id: string
  name: string
  icon: string // emoji 或图标名
  color: string // 主题色
  description?: string
  customFields?: AssetField[] // 自定义字段
  isPreset?: boolean // 是否为预设类型
  createdAt: string
  updatedAt: string
}

// 自定义字段定义
export interface AssetField {
  id: string
  name: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'tags'
  required?: boolean
  options?: string[] // select 类型的选项
  placeholder?: string
}

// 资产项
export interface AssetItem {
  id: string
  title: string
  typeId: string // 关联的资产类型 ID
  summary?: string // AI 生成的概述
  content: unknown[] // BlockNote 内容
  // 自定义字段值
  fieldValues?: Record<string, string | string[] | number>
  // 标签
  tags?: string[]
  createdAt: string
  updatedAt: string
  aiProcessedAt?: string // AI 处理时间
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

export const AGENT_CAPABILITY_IDS = [
  'knowledge_search',
  'asset_reference',
  'literature_search',
  'document_read',
  'document_edit',
  'document_comment',
  'document_issue_mark',
  'document_review',
] as const

export type AgentCapabilityId = typeof AGENT_CAPABILITY_IDS[number]

// 智能体类型
export interface Agent {
  id: string
  title: string // 智能体名称
  description?: string // 智能体说明
  prompt: string // 系统 prompt
  capabilities?: AgentCapabilityId[] // 技能与权限
  isPreset: boolean // 是否为预设
  isDefault?: boolean // 是否为默认选中
}

// 助手对话消息类型
export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolEvents?: AssistantToolEvent[]
  toolInvocations?: AssistantToolInvocation[]
  citations?: AssistantCitation[]
  checkpointId?: string
  createdAt: string
}

export interface AssistantToolEvent {
  id: string
  toolName: string
  status: 'running' | 'success' | 'error'
  message: string
}

export type AssistantToolInvocationStatus =
  | 'input-streaming'
  | 'running'
  | 'completed'
  | 'applied'
  | 'reviewing'
  | 'accepted'
  | 'rejected'
  | 'error'

export interface AssistantToolInvocation {
  id: string
  toolCallId: string
  toolName: string
  status: AssistantToolInvocationStatus
  input?: unknown
  output?: unknown
  error?: string
}

export interface AssistantCitation {
  id: string
  knowledgeItemId: string
  title: string
  excerpt: string
  sourceKind: 'overview' | 'fulltext' | 'asset'
  score: number
  blockId?: string
  pageNum?: number
  year?: string
  journal?: string
  authors?: string[]
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
  sourceLabel?: string
  confidence?: number
  lineCount?: number
  order?: number
  sourcePageWidth?: number
  sourcePageHeight?: number
}

export type LegacyPDFParserSource = 'surya'
export type PDFParserSource = 'pdfjs' | AdvancedParseProviderId | LegacyPDFParserSource
export type PDFParseStatus = 'processing' | 'completed' | 'failed'

// PDF 页面缓存
export interface PDFPageCache {
  id: string // `${documentId}_page_${pageNum}`
  documentId: string
  pageNum: number
  width: number
  height: number
  blocks: TextBlock[]
  fullText?: string
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
  parser?: PDFParserSource
  parseStatus?: PDFParseStatus
  parseError?: string
  fullText?: string
  structureCounts?: Record<string, number>
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
  sourceLabel?: string
}

// ============ 批注相关类型 ============

// 高亮颜色
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

// 高亮颜色映射
export const HIGHLIGHT_COLORS: Record<HighlightColor, { bg: string; border: string }> = {
  yellow: { bg: 'rgba(255, 235, 59, 0.18)', border: 'rgba(245, 158, 11, 0.62)' },
  green: { bg: 'rgba(76, 175, 80, 0.16)', border: 'rgba(34, 197, 94, 0.58)' },
  blue: { bg: 'rgba(33, 150, 243, 0.14)', border: 'rgba(59, 130, 246, 0.6)' },
  pink: { bg: 'rgba(233, 30, 99, 0.12)', border: 'rgba(236, 72, 153, 0.58)' },
  purple: { bg: 'rgba(156, 39, 176, 0.14)', border: 'rgba(168, 85, 247, 0.58)' },
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

// ============ AI导读相关类型 ============

// 思维导图节点类型
export type MindMapNodeType = 'root' | 'section' | 'paragraph'

// 思维导图节点（树形结构）
export interface MindMapNode {
  id: string
  type: MindMapNodeType
  label: string
  blockId?: string // 关联的文本块ID（用于跳转）
  pageNum?: number // 页码
  children?: MindMapNode[]
}

// React Flow 节点数据
export interface FlowNodeData {
  [key: string]: unknown
  label: string
  blockId?: string
  pageNum?: number
  type: MindMapNodeType
}

// AI导读概要
export interface AIGuideSummary {
  background: string // 研究背景
  methods: string // 核心方法
  conclusions: string // 主要结论
  keyPoints: string[] // 关键要点列表
}

// 段落关键要点
export interface BlockKeyPoints {
  blockId: string
  text: string // 原文片段
  keyPoints: string[] // 3-5个关键要点
  pageNum: number
}

export interface AIGuideHighlight {
  id: string
  blockId: string
  pageNum: number
  title: string
  note: string
  quote?: string
}

export interface GuideFocusTarget {
  blockId: string
  pageNum: number
  title?: string
  note?: string
}

// AI导读完整数据
export interface AIGuideData {
  summary: AIGuideSummary
  structure: MindMapNode[]
  blockKeyPoints: BlockKeyPoints[]
  highlights: AIGuideHighlight[]
}

// AI导读缓存
export interface GuideCache {
  id: string // `${documentId}_guide`
  documentId: string
  knowledgeItemId: string
  summary?: AIGuideSummary | null
  structure?: MindMapNode[]
  blockKeyPoints?: BlockKeyPoints[]
  highlights?: AIGuideHighlight[]
  modelUsed: string
  generatedAt: string
  updatedAt: string
}

// AI导读请求类型
export type AIGuideAction = 'summary' | 'structure' | 'keypoints' | 'highlights' | 'all'

// AI导读请求体
export interface AIGuideRequest {
  documentId: string
  knowledgeItemId: string
  blocks: TextBlock[]
  fullText?: string
  modelConfig: ModelConfig
  action: AIGuideAction
}

// AI导读响应
export interface AIGuideResponse {
  success: boolean
  summary?: AIGuideSummary
  structure?: MindMapNode[]
  blockKeyPoints?: BlockKeyPoints[]
  highlights?: AIGuideHighlight[]
  error?: string
}

// ============ RAG 向量存储相关类型 ============

// 向量文档
export interface VectorDocument {
  id: string
  documentId: string
  blockId: string
  text: string
  embedding?: number[]
  metadata: {
    pageNum: number
    type: TextBlockType
    bbox: BoundingBox
  }
}

// RAG 搜索请求
export interface RAGSearchRequest {
  documentId: string
  query: string
  topK?: number
}

// RAG 搜索结果
export interface RAGSearchResult {
  blockId: string
  text: string
  score: number
  pageNum: number
  type: TextBlockType
}

// RAG 嵌入请求
export interface RAGEmbedRequest {
  documentId: string
  blocks: TextBlock[]
  modelConfig?: ModelConfig | null
  forceLocal?: boolean
}

// ============ 知识图谱相关类型 ============

// 知识图谱节点类型
export type KnowledgeNodeType = 'paper' | 'concept' | 'author' | 'method' | 'dataset' | 'keyword'

// 知识图谱关系类型
export type KnowledgeRelationType = 'cites' | 'extends' | 'uses' | 'similar_to' | 'authored_by' | 'contains_concept' | 'applies_method'

// 知识图谱节点
export interface KnowledgeGraphNode {
  id: string
  type: KnowledgeNodeType
  label: string
  description?: string
  // 关联的知识库条目ID（如果是论文节点）
  knowledgeItemId?: string
  // 节点属性
  properties: Record<string, unknown>
  // 可视化位置
  position?: { x: number; y: number }
  // 节点权重（影响大小）
  weight: number
  createdAt: string
  updatedAt: string
}

// 知识图谱边
export interface KnowledgeGraphEdge {
  id: string
  sourceId: string
  targetId: string
  type: KnowledgeRelationType
  label?: string
  // 关系强度 0-1
  strength: number
  // 关系属性
  properties: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// 知识图谱
export interface KnowledgeGraph {
  id: string
  name: string
  description?: string
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  createdAt: string
  updatedAt: string
}

// 自动图谱分析结果
export interface AutoGraphAnalysis {
  // 提取的概念
  concepts: Array<{
    name: string
    description: string
    confidence: number
  }>
  // 提取的方法
  methods: Array<{
    name: string
    description: string
    confidence: number
  }>
  // 建议的标签
  suggestedTags: string[]
  // 潜在关联的论文ID
  relatedPapers: Array<{
    knowledgeItemId: string
    relationshipType: KnowledgeRelationType
    confidence: number
    reason: string
  }>
}

// 图谱构建请求
export interface GraphBuildRequest {
  knowledgeItemId: string
  title: string
  abstract: string
  authors: string[]
  keywords?: string[]
  fullText?: string
  modelConfig: ModelConfig
}

// 图谱构建响应
export interface GraphBuildResponse {
  success: boolean
  analysis?: AutoGraphAnalysis
  nodesCreated: number
  edgesCreated: number
  error?: string
}

// ============ 编辑器评论相关类型 ============

export type EditorCommentSource = 'user' | 'agent'
export type EditorCommentSeverity = 'info' | 'warning' | 'critical'
export type EditorCommentTone = 'default' | 'red' | 'amber' | 'blue'

export interface DocumentReviewIssue {
  blockId: string
  quote: string
  reason: string
  suggestion?: string
  severity: EditorCommentSeverity
}

// 编辑器评论类型
export interface EditorComment {
  id: string
  documentId: string
  parentId?: string
  // 选中的文本信息
  selectedText: string
  blockId?: string // 关联的 BlockNote 块 ID
  startOffset?: number // 在块中的起始位置
  endOffset?: number // 在块中的结束位置
  // 评论内容
  content: string
  source?: EditorCommentSource
  agentId?: string
  agentTitle?: string
  capabilityId?: AgentCapabilityId
  severity?: EditorCommentSeverity
  tone?: EditorCommentTone
  resolvedAt?: string
  resolvedBy?: 'user' | 'agent'
  // 元数据
  createdAt: string
  updatedAt: string
}
