'use client'

import Dexie, { type EntityTable } from 'dexie'
import type { PDFDocumentCache, PDFPageCache, TranslationCache, TextBlock } from './types'

// 数据库表结构定义
const db = new Dexie('PaperReaderPDF') as Dexie & {
  documents: EntityTable<PDFDocumentCache, 'id'>
  pages: EntityTable<PDFPageCache, 'id'>
  translations: EntityTable<TranslationCache, 'id'>
}

// 初始化数据库
db.version(1).stores({
  documents: 'id, knowledgeItemId, parsedAt',
  pages: 'id, documentId, pageNum',
  translations: 'id, documentId, translatedAt',
})

// ============ 文档缓存操作 ============

/**
 * 保存 PDF 文档缓存
 */
export async function savePDFDocument(doc: PDFDocumentCache): Promise<void> {
  await db.documents.put(doc)
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
  await db.documents.clear()
  await db.pages.clear()
  await db.translations.clear()
}

/**
 * 获取缓存统计信息
 */
export async function getCacheStats(): Promise<{
  documentCount: number
  pageCount: number
  translationCount: number
}> {
  return {
    documentCount: await db.documents.count(),
    pageCount: await db.pages.count(),
    translationCount: await db.translations.count(),
  }
}

export { db }
