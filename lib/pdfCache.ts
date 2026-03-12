'use client'

import Dexie, { type EntityTable } from 'dexie'
import type { PDFDocumentCache, PDFPageCache, TranslationCache, TextBlock, PDFAnnotation, GuideCache, VectorDocument } from './types'

// PDF 文件缓存（存储原始 PDF blob）
interface PDFFileCache {
  id: string // 对应 knowledgeItemId
  blob: Blob
  fileName: string
  size: number
  cachedAt: string
}

// 数据库表结构定义
const db = new Dexie('PaperReaderPDF') as Dexie & {
  files: EntityTable<PDFFileCache, 'id'>
  documents: EntityTable<PDFDocumentCache, 'id'>
  pages: EntityTable<PDFPageCache, 'id'>
  translations: EntityTable<TranslationCache, 'id'>
  annotations: EntityTable<PDFAnnotation, 'id'>
  guides: EntityTable<GuideCache, 'id'>
  vectors: EntityTable<VectorDocument, 'id'>
}

// 初始化数据库
db.version(5).stores({
  files: 'id, cachedAt',
  documents: 'id, knowledgeItemId, parsedAt',
  pages: 'id, documentId, pageNum',
  translations: 'id, documentId, translatedAt',
  annotations: 'id, documentId, pageNum, createdAt',
  guides: 'id, documentId, knowledgeItemId, generatedAt',
  vectors: 'id, documentId, blockId',
})

// ============ PDF 文件缓存操作 ============

/**
 * 保存 PDF 文件到缓存
 */
export async function savePDFFile(id: string, blob: Blob, fileName: string): Promise<void> {
  await db.files.put({
    id,
    blob,
    fileName,
    size: blob.size,
    cachedAt: new Date().toISOString(),
  })
}

/**
 * 获取缓存的 PDF 文件
 */
export async function getPDFFile(id: string): Promise<PDFFileCache | undefined> {
  return await db.files.get(id)
}

/**
 * 检查是否有 PDF 文件缓存
 */
export async function hasPDFFileCache(id: string): Promise<boolean> {
  const file = await db.files.get(id)
  return !!file
}

/**
 * 删除 PDF 文件缓存
 */
export async function deletePDFFile(id: string): Promise<void> {
  await db.files.delete(id)
}

// ============ 文档缓存操作 ============

/**
 * 保存 PDF 文档缓存
 */
export async function savePDFDocument(doc: PDFDocumentCache): Promise<void> {
  await db.documents.put(doc)
}

export async function updatePDFDocument(id: string, updates: Partial<PDFDocumentCache>): Promise<void> {
  await db.documents.update(id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * 获取 PDF 文档缓存
 */
export async function getPDFDocument(id: string): Promise<PDFDocumentCache | undefined> {
  return await db.documents.get(id)
}

/**
 * 根据知识库条目 ID 获取文档缓存
 */
export async function getPDFDocumentByKnowledgeId(knowledgeItemId: string): Promise<PDFDocumentCache | undefined> {
  return await db.documents.where('knowledgeItemId').equals(knowledgeItemId).first()
}

/**
 * 删除 PDF 文档缓存
 */
export async function deletePDFDocument(id: string): Promise<void> {
  await db.transaction('rw', [db.documents, db.pages, db.translations], async () => {
    // 删除相关页面
    await db.pages.where('documentId').equals(id).delete()
    // 删除相关翻译
    await db.translations.where('documentId').equals(id).delete()
    // 删除文档
    await db.documents.delete(id)
  })
}

// ============ 页面缓存操作 ============

/**
 * 保存页面缓存（批量）
 */
export async function savePDFPages(pages: PDFPageCache[]): Promise<void> {
  await db.pages.bulkPut(pages)
}

/**
 * 获取单个页面缓存
 */
export async function getPDFPage(id: string): Promise<PDFPageCache | undefined> {
  return await db.pages.get(id)
}

/**
 * 获取文档的所有页面缓存
 */
export async function getPDFPagesByDocumentId(documentId: string): Promise<PDFPageCache[]> {
  return await db.pages.where('documentId').equals(documentId).sortBy('pageNum')
}

/**
 * 更新页面中的文本块翻译
 */
export async function updatePageBlocks(pageId: string, blocks: TextBlock[]): Promise<void> {
  const page = await db.pages.get(pageId)
  if (page) {
    await db.pages.update(pageId, { 
      blocks, 
      updatedAt: new Date().toISOString() 
    })
  }
}

// ============ 翻译缓存操作 ============

/**
 * 保存翻译缓存
 */
export async function saveTranslation(translation: TranslationCache): Promise<void> {
  await db.translations.put(translation)
}

/**
 * 获取翻译缓存
 */
export async function getTranslation(documentId: string): Promise<TranslationCache | undefined> {
  return await db.translations.where('documentId').equals(documentId).first()
}

/**
 * 删除翻译缓存
 */
export async function deleteTranslation(documentId: string): Promise<void> {
  await db.translations.where('documentId').equals(documentId).delete()
}

// ============ 工具函数 ============

/**
 * 检查是否有完整的沉浸式阅读缓存
 */
export async function hasImmersiveCache(knowledgeItemId: string): Promise<boolean> {
  const doc = await getPDFDocumentByKnowledgeId(knowledgeItemId)
  if (!doc) return false
  
  const pages = await getPDFPagesByDocumentId(doc.id)
  if (pages.length === 0) return false
  
  const translation = await getTranslation(doc.id)
  if (!translation) return false
  
  return true
}

/**
 * 清除所有缓存
 */
export async function clearAllCache(): Promise<void> {
  await db.files.clear()
  await db.documents.clear()
  await db.pages.clear()
  await db.translations.clear()
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{
  fileCount: number
  fileSize: number
  documentCount: number
  pageCount: number
  translationCount: number
  annotationCount: number
}> {
  const files = await db.files.toArray()
  return {
    fileCount: files.length,
    fileSize: files.reduce((sum, f) => sum + f.size, 0),
    documentCount: await db.documents.count(),
    pageCount: await db.pages.count(),
    translationCount: await db.translations.count(),
    annotationCount: await db.annotations.count(),
  }
}

// ============ 批注操作 ============

/**
 * 保存批注
 */
export async function saveAnnotation(annotation: PDFAnnotation): Promise<void> {
  await db.annotations.put(annotation)
}

/**
 * 获取单个批注
 */
export async function getAnnotation(id: string): Promise<PDFAnnotation | undefined> {
  return await db.annotations.get(id)
}

/**
 * 获取文档的所有批注
 */
export async function getAnnotationsByDocumentId(documentId: string): Promise<PDFAnnotation[]> {
  return await db.annotations.where('documentId').equals(documentId).sortBy('createdAt')
}

/**
 * 获取特定页面的批注
 */
export async function getAnnotationsByPage(documentId: string, pageNum: number): Promise<PDFAnnotation[]> {
  return await db.annotations
    .where('[documentId+pageNum]')
    .equals([documentId, pageNum])
    .sortBy('createdAt')
}

/**
 * 更新批注
 */
export async function updateAnnotation(id: string, updates: Partial<PDFAnnotation>): Promise<void> {
  await db.annotations.update(id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * 删除批注
 */
export async function deleteAnnotation(id: string): Promise<void> {
  await db.annotations.delete(id)
}

/**
 * 删除文档的所有批注
 */
export async function deleteAnnotationsByDocumentId(documentId: string): Promise<void> {
  await db.annotations.where('documentId').equals(documentId).delete()
}

// ============ 全文内容输出 ============

/**
 * 获取文档的全文内容
 * 优先从文档缓存的 fullText 字段获取，否则拼接所有页面的 fullText
 */
export async function getFullTextByKnowledgeId(knowledgeItemId: string): Promise<string | null> {
  const doc = await getPDFDocumentByKnowledgeId(knowledgeItemId)
  if (!doc) return null

  // 优先使用文档级别的 fullText
  if (doc.fullText && doc.fullText.trim()) {
    return doc.fullText
  }

  // 否则拼接所有页面的 fullText
  const pages = await getPDFPagesByDocumentId(doc.id)
  if (pages.length === 0) return null

  return pages
    .sort((a, b) => a.pageNum - b.pageNum)
    .map(p => p.fullText || p.blocks.map(b => b.text).join('\n'))
    .join('\n\n')
}

/**
 * 获取文档的所有文本块（按页码排序）
 */
export async function getAllBlocksByKnowledgeId(knowledgeItemId: string): Promise<TextBlock[]> {
  const doc = await getPDFDocumentByKnowledgeId(knowledgeItemId)
  if (!doc) return []

  const pages = await getPDFPagesByDocumentId(doc.id)
  if (pages.length === 0) return []

  return pages
    .sort((a, b) => a.pageNum - b.pageNum)
    .flatMap(p => p.blocks)
}

/**
 * 获取文档的结构化内容（按段落分组）
 */
export async function getStructuredContentByKnowledgeId(knowledgeItemId: string): Promise<{
  fullText: string
  blocks: TextBlock[]
  structure: {
    title: string
    sections: { id: string; title: string; blockIds: string[] }[]
  }
} | null> {
  const doc = await getPDFDocumentByKnowledgeId(knowledgeItemId)
  if (!doc) return null

  const pages = await getPDFPagesByDocumentId(doc.id)
  if (pages.length === 0) return null

  const sortedPages = pages.sort((a, b) => a.pageNum - b.pageNum)
  const allBlocks = sortedPages.flatMap(p => p.blocks)
  const fullText = doc.fullText || sortedPages
    .map(p => p.fullText || p.blocks.map(b => b.text).join('\n'))
    .join('\n\n')

  // 简单的结构提取：基于标题类型的块
  const sections: { id: string; title: string; blockIds: string[] }[] = []
  let currentSection: { id: string; title: string; blockIds: string[] } | null = null

  for (const block of allBlocks) {
    if (block.type === 'title' || block.type === 'subtitle') {
      if (currentSection) {
        sections.push(currentSection)
      }
      currentSection = {
        id: block.id,
        title: block.text.slice(0, 100),
        blockIds: [block.id]
      }
    } else if (currentSection) {
      currentSection.blockIds.push(block.id)
    }
  }

  if (currentSection) {
    sections.push(currentSection)
  }

  return {
    fullText,
    blocks: allBlocks,
    structure: {
      title: doc.metadata.title || '未知标题',
      sections
    }
  }
}

// ============ AI导读缓存操作 ============

/**
 * 保存 AI导读 缓存
 */
export async function saveGuide(guide: GuideCache): Promise<void> {
  await db.guides.put(guide)
}

/**
 * 获取 AI导读 缓存
 */
export async function getGuide(documentId: string): Promise<GuideCache | undefined> {
  return await db.guides.where('documentId').equals(documentId).first()
}

/**
 * 根据知识库条目 ID 获取 AI导读 缓存
 */
export async function getGuideByKnowledgeId(knowledgeItemId: string): Promise<GuideCache | undefined> {
  return await db.guides.where('knowledgeItemId').equals(knowledgeItemId).first()
}

/**
 * 更新 AI导读 缓存
 */
export async function updateGuide(id: string, updates: Partial<GuideCache>): Promise<void> {
  const guideTable = db.guides as unknown as {
    update: (key: string, changes: Record<string, unknown>) => Promise<number>
  }

  await guideTable.update(id, {
    ...updates,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * 删除 AI导读 缓存
 */
export async function deleteGuide(documentId: string): Promise<void> {
  await db.guides.where('documentId').equals(documentId).delete()
}

// ============ RAG 向量缓存操作 ============

export async function saveVectorDocuments(documentId: string, vectors: VectorDocument[]): Promise<void> {
  await db.transaction('rw', [db.vectors], async () => {
    await db.vectors.where('documentId').equals(documentId).delete()
    await db.vectors.bulkPut(
      vectors.map(vector => ({
        ...vector,
        id: `${documentId}:${vector.blockId}`,
        documentId,
      })),
    )
  })
}

export async function getVectorDocumentsByDocumentId(documentId: string): Promise<VectorDocument[]> {
  return await db.vectors.where('documentId').equals(documentId).toArray()
}

export async function deleteVectorDocumentsByDocumentId(documentId: string): Promise<void> {
  await db.vectors.where('documentId').equals(documentId).delete()
}

export async function hasVectorDocuments(documentId: string): Promise<boolean> {
  return (await db.vectors.where('documentId').equals(documentId).count()) > 0
}

/**
 * 删除知识条目的所有缓存数据
 * 包括：PDF 文件、文档缓存、页面、翻译、批注、导读、向量
 */
export async function deleteKnowledgeItemCache(knowledgeItemId: string): Promise<void> {
  await db.transaction('rw', [db.files, db.documents, db.pages, db.translations, db.annotations, db.guides, db.vectors], async () => {
    // 删除 PDF 文件缓存
    await db.files.delete(knowledgeItemId)

    // 获取文档缓存
    const doc = await db.documents.where('knowledgeItemId').equals(knowledgeItemId).first()
    if (doc) {
      // 删除相关页面
      await db.pages.where('documentId').equals(doc.id).delete()
      // 删除相关翻译
      await db.translations.where('documentId').equals(doc.id).delete()
      // 删除相关批注
      await db.annotations.where('documentId').equals(doc.id).delete()
      // 删除相关导读
      await db.guides.where('documentId').equals(doc.id).delete()
      // 删除相关向量
      await db.vectors.where('documentId').equals(doc.id).delete()
      // 删除文档记录
      await db.documents.delete(doc.id)
    }
  })
}

export { db }
