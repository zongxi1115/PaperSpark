'use client'

import { db } from './pdfCache'
import { getKnowledgeGraph } from './knowledgeGraph'
import { getStoredFile } from './localFiles'
import {
  getAllVersions,
  getAssistantNotes,
  getAssetTypes,
  getAssets,
  getConversations,
  getDocuments,
  getKnowledgeItems,
  getLastDocId,
  getSettings,
  getThoughts,
  getZoteroConfig,
  getAgents,
} from './storage'
import { getString } from './storage/StorageUtils'
import type { GuideCache, PDFAnnotation, PDFDocumentCache, PDFPageCache, TranslationCache } from './types'
import {
  buildKnowledgeOverviewText,
  createAssetSnapshot,
  createDocumentSnapshot,
  createDocumentVersionSnapshot,
  createSnapshotStats,
  createThoughtSnapshot,
  DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME,
  sanitizeSettings,
  sanitizeZoteroConfig,
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  type SnapshotBlock,
  type SnapshotImmersiveContent,
  type SnapshotKnowledgeItem,
  type WorkspaceSnapshot,
} from './workspaceSnapshot'

type SaveFilePickerOptionsLike = {
  suggestedName?: string
  types?: Array<{
    description?: string
    accept: Record<string, string[]>
  }>
}

type FileSystemWritableFileStreamLike = {
  write: (data: Blob | BufferSource | string) => Promise<void>
  close: () => Promise<void>
}

type FileSystemFileHandleLike = {
  createWritable: () => Promise<FileSystemWritableFileStreamLike>
}

type WindowWithFilePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptionsLike) => Promise<FileSystemFileHandleLike>
}

export async function buildWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  const [
    documents,
    documentVersions,
    knowledgeItems,
    assets,
    assetTypes,
    thoughts,
    agents,
    conversations,
    assistantNotes,
    pdfDocuments,
    pdfPages,
    translations,
    annotations,
    guides,
  ] = await Promise.all([
    Promise.resolve(getDocuments()),
    Promise.resolve(getAllVersions()),
    Promise.resolve(getKnowledgeItems()),
    Promise.resolve(getAssets()),
    Promise.resolve(getAssetTypes()),
    Promise.resolve(getThoughts()),
    Promise.resolve(getAgents()),
    Promise.resolve(getConversations()),
    Promise.resolve(getAssistantNotes()),
    db.documents.toArray(),
    db.pages.toArray(),
    db.translations.toArray(),
    db.annotations.toArray(),
    db.guides.toArray(),
  ])

  const documentSnapshots = documents.map(createDocumentSnapshot)
  const versionSnapshots = documentVersions.map(createDocumentVersionSnapshot)
  const assetSnapshots = assets.map(createAssetSnapshot)
  const thoughtSnapshots = thoughts.map(createThoughtSnapshot)

  const pdfDocumentMap = new Map<string, PDFDocumentCache>(pdfDocuments.map(doc => [doc.knowledgeItemId, doc]))
  const pagesByDocumentId = groupByDocumentId(pdfPages)
  const translationByDocumentId = new Map<string, TranslationCache>(translations.map(item => [item.documentId, item]))
  const annotationsByDocumentId = groupByDocumentId(annotations)
  const guideByKnowledgeId = new Map<string, GuideCache>(guides.map(item => [item.knowledgeItemId, item]))

  const knowledgeSnapshots: SnapshotKnowledgeItem[] = []

  for (const item of knowledgeItems) {
    const localFile = item.sourceType === 'upload' && item.sourceId
      ? await getStoredFile(item.sourceId).then(record => record
        ? {
            id: record.id,
            name: record.name,
            type: record.type,
            size: record.size,
            lastModified: record.lastModified,
          }
        : null)
      : null

    const immersive = buildImmersiveContent(
      item.id,
      pdfDocumentMap.get(item.id) || null,
      pagesByDocumentId.get(item.id) || [],
      translationByDocumentId.get(item.id) || null,
      annotationsByDocumentId.get(item.id) || [],
      guideByKnowledgeId.get(item.id) || null,
    )

    knowledgeSnapshots.push({
      ...item,
      overviewText: buildKnowledgeOverviewText(item),
      localFile,
      immersive,
    })
  }

  const knowledgeGraph = getKnowledgeGraph()

  const data = {
    settings: sanitizeSettings(getSettings()),
    zotero: sanitizeZoteroConfig(getZoteroConfig()),
    theme: getString('theme', 'system'),
    lastDocId: getLastDocId(),
    documents: documentSnapshots,
    documentVersions: versionSnapshots,
    knowledge: knowledgeSnapshots,
    assets: assetSnapshots,
    assetTypes,
    thoughts: thoughtSnapshots,
    agents,
    conversations,
    assistantNotes,
    knowledgeGraph,
  }

  return {
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    origin: window.location.origin,
    app: {
      name: 'PaperSpark',
    },
    stats: createSnapshotStats({
      documents: documentSnapshots,
      documentVersions: versionSnapshots,
      knowledge: knowledgeSnapshots,
      assets: assetSnapshots,
      assetTypes,
      thoughts: thoughtSnapshots,
      agents,
      conversations,
      assistantNotes,
      knowledgeGraph,
    }),
    data,
  }
}

export async function saveWorkspaceSnapshotToDisk(snapshot?: WorkspaceSnapshot): Promise<{
  fileName: string
  method: 'file-picker' | 'download'
}> {
  const resolvedSnapshot = snapshot || await buildWorkspaceSnapshot()
  const fileName = DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME
  const json = JSON.stringify(resolvedSnapshot, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })

  const pickerWindow = window as WindowWithFilePicker

  if (typeof pickerWindow.showSaveFilePicker === 'function') {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: 'PaperSpark workspace snapshot',
          accept: {
            'application/json': ['.json'],
          },
        },
      ],
    })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return { fileName, method: 'file-picker' }
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)

  return { fileName, method: 'download' }
}

export async function syncWorkspaceSnapshotToServer(snapshot?: WorkspaceSnapshot): Promise<{
  filePath: string
  exportedAt: string
  syncedAt?: string
  stats: WorkspaceSnapshot['stats'] | null
}> {
  const resolvedSnapshot = snapshot || await buildWorkspaceSnapshot()
  const response = await fetch('/api/workspace-cli/snapshot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resolvedSnapshot),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || '同步到服务失败')
  }

  return {
    filePath: typeof payload?.filePath === 'string' ? payload.filePath : '',
    exportedAt: typeof payload?.exportedAt === 'string' ? payload.exportedAt : resolvedSnapshot.exportedAt,
    syncedAt: typeof payload?.syncedAt === 'string' ? payload.syncedAt : undefined,
    stats: payload?.stats ?? null,
  }
}

export async function getWorkspaceBridgeStatus(): Promise<{
  available: boolean
  filePath?: string | null
  syncedAt?: string | null
  exportedAt?: string | null
  ageMs?: number | null
  origin?: string | null
  schemaVersion?: number | null
  stats?: WorkspaceSnapshot['stats'] | null
  sections?: string[]
  message?: string
  error?: string
}> {
  const response = await fetch('/api/workspace-cli/status', {
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || '读取工作区桥接状态失败')
  }

  return payload as {
    available: boolean
    filePath?: string | null
    syncedAt?: string | null
    exportedAt?: string | null
    ageMs?: number | null
    origin?: string | null
    schemaVersion?: number | null
    stats?: WorkspaceSnapshot['stats'] | null
    sections?: string[]
    message?: string
    error?: string
  }
}

function buildImmersiveContent(
  documentId: string,
  document: PDFDocumentCache | null,
  pages: PDFPageCache[],
  translation: TranslationCache | null,
  annotations: PDFAnnotation[],
  guide: GuideCache | null,
): SnapshotImmersiveContent | null {
  if (!document && pages.length === 0 && !translation && annotations.length === 0 && !guide) {
    return null
  }

  const translatedMap = new Map<string, string>(
    (translation?.blocks || []).map(block => [block.blockId, block.translated]),
  )

  const sortedPages = [...pages].sort((left, right) => left.pageNum - right.pageNum)
  const blocks: SnapshotBlock[] = sortedPages.flatMap(page =>
    page.blocks.map(block => ({
      id: block.id,
      type: block.type,
      pageNum: block.pageNum,
      text: block.text,
      translated: translatedMap.get(block.id) || block.translated,
      sourceLabel: block.sourceLabel,
      confidence: block.confidence,
      order: block.order,
    })),
  )

  const fullText = document?.fullText?.trim()
    ? document.fullText
    : sortedPages
        .map(page => {
          const pageText = page.fullText?.trim()
          if (pageText) return pageText
          return page.blocks.map(block => block.text).join('\n')
        })
        .filter(Boolean)
        .join('\n\n')

  return {
    document,
    fullText,
    blocks,
    pages: sortedPages.map(page => ({
      id: page.id,
      pageNum: page.pageNum,
      width: page.width,
      height: page.height,
      blockCount: page.blocks.length,
      fullText: page.fullText?.trim() || page.blocks.map(block => block.text).join('\n'),
    })),
    translation,
    annotations: [...annotations].sort((left, right) => left.pageNum - right.pageNum),
    guide,
  }
}

function groupByDocumentId<T extends { documentId: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  items.forEach(item => {
    const current = grouped.get(item.documentId) || []
    current.push(item)
    grouped.set(item.documentId, current)
  })
  return grouped
}
