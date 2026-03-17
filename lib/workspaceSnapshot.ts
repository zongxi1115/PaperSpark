import type {
  Agent,
  AppDocument,
  AppSettings,
  AssistantConversation,
  AssistantNote,
  AssetItem,
  AssetType,
  DocumentVersion,
  GuideCache,
  KnowledgeGraph,
  KnowledgeItem,
  PDFAnnotation,
  PDFDocumentCache,
  PDFPageCache,
  Thought,
  TranslationCache,
} from './types'

export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = 1
export const DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME = 'paperspark-workspace-snapshot.json'

export interface SnapshotLocalFile {
  id: string
  name: string
  type: string
  size: number
  lastModified: number
}

export interface SnapshotBlock {
  id: string
  type: string
  pageNum?: number
  text: string
  translated?: string
  sourceLabel?: string
  confidence?: number
  order?: number
}

export interface SnapshotPage {
  id: string
  pageNum: number
  width: number
  height: number
  blockCount: number
  fullText: string
}

export interface SnapshotImmersiveContent {
  document: PDFDocumentCache | null
  fullText: string
  blocks: SnapshotBlock[]
  pages: SnapshotPage[]
  translation: TranslationCache | null
  annotations: PDFAnnotation[]
  guide: GuideCache | null
}

export interface SnapshotDocument extends AppDocument {
  plainText: string
  previewText: string
}

export interface SnapshotDocumentVersion extends DocumentVersion {
  plainText: string
  previewText: string
}

export interface SnapshotAsset extends AssetItem {
  plainText: string
  previewText: string
}

export interface SnapshotThought extends Thought {
  plainText: string
  previewText: string
}

export interface SnapshotKnowledgeItem extends KnowledgeItem {
  overviewText: string
  localFile: SnapshotLocalFile | null
  immersive: SnapshotImmersiveContent | null
}

export interface SanitizedModelConfig {
  baseUrl: string
  modelName: string
  hasApiKey: boolean
}

export interface SanitizedProvider {
  id: string
  name: string
  baseUrl: string
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
  models: Array<{
    id: string
    name: string
    modelId: string
    providerId: string
    type: 'small' | 'large' | 'both'
    enabled?: boolean
  }>
}

export interface SanitizedSettings extends Omit<AppSettings, 'providers' | 'smallModel' | 'largeModel' | 'embeddingModel' | 'rerankModel'> {
  providers: SanitizedProvider[]
  smallModel?: SanitizedModelConfig
  largeModel?: SanitizedModelConfig
  embeddingModel?: SanitizedModelConfig
  rerankModel?: SanitizedModelConfig
}

export interface SanitizedZoteroConfig {
  userId: string
  hasApiKey: boolean
  lastSync?: string
}

export interface WorkspaceSnapshotStats {
  documents: number
  documentVersions: number
  knowledgeItems: number
  knowledgeWithImmersiveCache: number
  knowledgeWithFullText: number
  assets: number
  assetTypes: number
  thoughts: number
  agents: number
  conversations: number
  assistantNotes: number
  uploadedLocalFiles: number
  graphNodes: number
  graphEdges: number
}

export interface WorkspaceSnapshot {
  schemaVersion: number
  exportedAt: string
  origin: string
  app: {
    name: string
  }
  stats: WorkspaceSnapshotStats
  data: {
    settings: SanitizedSettings
    zotero: SanitizedZoteroConfig | null
    theme: string | null
    lastDocId: string | null
    documents: SnapshotDocument[]
    documentVersions: SnapshotDocumentVersion[]
    knowledge: SnapshotKnowledgeItem[]
    assets: SnapshotAsset[]
    assetTypes: AssetType[]
    thoughts: SnapshotThought[]
    agents: Agent[]
    conversations: AssistantConversation[]
    assistantNotes: AssistantNote[]
    knowledgeGraph: KnowledgeGraph | null
  }
}

export function sanitizeSettings(settings: AppSettings): SanitizedSettings {
  return {
    ...settings,
    providers: settings.providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      hasApiKey: Boolean(provider.apiKey),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
      models: provider.models.map(model => ({
        id: model.id,
        name: model.name,
        modelId: model.modelId,
        providerId: model.providerId,
        type: model.type,
        enabled: model.enabled,
      })),
    })),
    smallModel: settings.smallModel
      ? {
          baseUrl: settings.smallModel.baseUrl,
          modelName: settings.smallModel.modelName,
          hasApiKey: Boolean(settings.smallModel.apiKey),
        }
      : undefined,
    largeModel: settings.largeModel
      ? {
          baseUrl: settings.largeModel.baseUrl,
          modelName: settings.largeModel.modelName,
          hasApiKey: Boolean(settings.largeModel.apiKey),
        }
      : undefined,
    embeddingModel: settings.embeddingModel
      ? {
          baseUrl: settings.embeddingModel.baseUrl,
          modelName: settings.embeddingModel.modelName,
          hasApiKey: Boolean(settings.embeddingModel.apiKey),
        }
      : undefined,
    rerankModel: settings.rerankModel
      ? {
          baseUrl: settings.rerankModel.baseUrl,
          modelName: settings.rerankModel.modelName,
          hasApiKey: Boolean(settings.rerankModel.apiKey),
        }
      : undefined,
  }
}

export function sanitizeZoteroConfig(config: { userId: string; apiKey: string; lastSync?: string } | null): SanitizedZoteroConfig | null {
  if (!config) return null
  return {
    userId: config.userId,
    hasApiKey: Boolean(config.apiKey),
    lastSync: config.lastSync,
  }
}

export function buildKnowledgeOverviewText(item: KnowledgeItem): string {
  return [
    item.title ? `标题：${item.title}` : '',
    item.authors?.length ? `作者：${item.authors.join('、')}` : '',
    item.year ? `年份：${item.year}` : '',
    item.journal ? `期刊：${item.journal}` : '',
    item.doi ? `DOI：${item.doi}` : '',
    item.url ? `链接：${item.url}` : '',
    item.abstract ? `摘要：${item.abstract}` : '',
    item.cachedSummary ? `概要：${item.cachedSummary}` : '',
    item.tags?.length ? `标签：${item.tags.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function getPlainTextFromBlocks(blocks: unknown[]): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return ''
  return blocks
    .map(block => getNodeText(block))
    .map(text => text.trim())
    .filter(Boolean)
    .join('\n')
}

export function createPreviewText(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

export function createDocumentSnapshot(document: AppDocument): SnapshotDocument {
  const plainText = getPlainTextFromBlocks(document.content as unknown[])
  return {
    ...document,
    plainText,
    previewText: createPreviewText(plainText),
  }
}

export function createDocumentVersionSnapshot(version: DocumentVersion): SnapshotDocumentVersion {
  const plainText = getPlainTextFromBlocks(version.content as unknown[])
  return {
    ...version,
    plainText,
    previewText: createPreviewText(plainText),
  }
}

export function createAssetSnapshot(asset: AssetItem): SnapshotAsset {
  const plainText = getPlainTextFromBlocks(asset.content as unknown[])
  return {
    ...asset,
    plainText,
    previewText: createPreviewText(asset.summary || plainText),
  }
}

export function createThoughtSnapshot(thought: Thought): SnapshotThought {
  const plainText = getPlainTextFromBlocks(thought.content as unknown[])
  return {
    ...thought,
    plainText,
    previewText: createPreviewText(thought.summary || plainText),
  }
}

export function createSnapshotStats(input: {
  documents: SnapshotDocument[]
  documentVersions: SnapshotDocumentVersion[]
  knowledge: SnapshotKnowledgeItem[]
  assets: SnapshotAsset[]
  assetTypes: AssetType[]
  thoughts: SnapshotThought[]
  agents: Agent[]
  conversations: AssistantConversation[]
  assistantNotes: AssistantNote[]
  knowledgeGraph: KnowledgeGraph | null
}): WorkspaceSnapshotStats {
  const uploadedLocalFiles = input.knowledge.filter(item => item.localFile).length
  const knowledgeWithImmersiveCache = input.knowledge.filter(item => item.immersive).length
  const knowledgeWithFullText = input.knowledge.filter(item => item.immersive?.fullText?.trim()).length

  return {
    documents: input.documents.length,
    documentVersions: input.documentVersions.length,
    knowledgeItems: input.knowledge.length,
    knowledgeWithImmersiveCache,
    knowledgeWithFullText,
    assets: input.assets.length,
    assetTypes: input.assetTypes.length,
    thoughts: input.thoughts.length,
    agents: input.agents.length,
    conversations: input.conversations.length,
    assistantNotes: input.assistantNotes.length,
    uploadedLocalFiles,
    graphNodes: input.knowledgeGraph?.nodes.length || 0,
    graphEdges: input.knowledgeGraph?.edges.length || 0,
  }
}

function getNodeText(node: unknown, depth = 0): string {
  if (depth > 12 || node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) {
    return node
      .map(item => getNodeText(item, depth + 1))
      .map(text => text.trim())
      .filter(Boolean)
      .join(' ')
  }
  if (!isRecord(node)) return ''

  const parts: string[] = []

  if (typeof node.text === 'string') {
    parts.push(node.text)
  }

  if (Array.isArray(node.content)) {
    parts.push(
      node.content
        .map(item => getNodeText(item, depth + 1))
        .map(text => text.trim())
        .filter(Boolean)
        .join(' '),
    )
  } else if (isRecord(node.content) && node.content.type === 'tableContent') {
    const rows = Array.isArray(node.content.rows) ? node.content.rows : []
    rows.forEach(row => {
      if (!isRecord(row) || !Array.isArray(row.cells)) return
      const rowText = row.cells
        .map(cell => getNodeText(cell, depth + 1))
        .map(text => text.trim())
        .filter(Boolean)
        .join(' | ')
      if (rowText) parts.push(rowText)
    })
  }

  if (Array.isArray(node.children)) {
    parts.push(
      node.children
        .map(child => getNodeText(child, depth + 1))
        .map(text => text.trim())
        .filter(Boolean)
        .join(' '),
    )
  }

  if (Array.isArray(node.cells)) {
    parts.push(
      node.cells
        .map(cell => getNodeText(cell, depth + 1))
        .map(text => text.trim())
        .filter(Boolean)
        .join(' | '),
    )
  }

  return parts
    .map(text => text.trim())
    .filter(Boolean)
    .join(' ')
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null
}
