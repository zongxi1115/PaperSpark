import { NextRequest, NextResponse } from 'next/server'
import { savePDFDocument, savePDFPages, getPDFDocumentByKnowledgeId } from '@/lib/pdfCache'
import type { PDFDocumentCache, PDFPageCache } from '@/lib/types'

// PDF 解析在客户端进行，此 API 只负责保存缓存
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, pages, metadata, fileName } = body

    if (!documentId || !pages) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 })
    }

    // 检查是否已有缓存
    const existingDoc = await getPDFDocumentByKnowledgeId(documentId)
    if (existingDoc) {
      return NextResponse.json({ 
        cached: true, 
        documentId: existingDoc.id,
        pageCount: existingDoc.pageCount 
      })
    }

    // 保存文档缓存
    const docCache: PDFDocumentCache = {
      id: documentId,
      knowledgeItemId: documentId,
      fileName: fileName || 'unknown.pdf',
      pageCount: pages.length,
      metadata: {
        title: metadata?.title || '',
        authors: metadata?.authors || [],
        abstract: metadata?.abstract || '',
        year: metadata?.year || '',
        journal: metadata?.journal || '',
        keywords: metadata?.keywords || [],
        references: metadata?.references || [],
      },
      parsedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await savePDFDocument(docCache)

    // 保存页面缓存
    await savePDFPages(pages)

    return NextResponse.json({
      cached: false,
      documentId,
      pageCount: pages.length,
      metadata: docCache.metadata,
    })
  } catch (error) {
    console.error('PDF cache save error:', error)
    const message = error instanceof Error ? error.message : '保存缓存失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
