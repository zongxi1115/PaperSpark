import { NextRequest, NextResponse } from 'next/server'
import { batchTranslate } from '@/lib/ai'
import { saveTranslation, getPDFPagesByDocumentId, updatePageBlocks } from '@/lib/pdfCache'
import type { ModelConfig, TranslationCache } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, chunks, modelConfig } = body as {
      documentId: string
      chunks: { id: string; text: string }[]
      modelConfig: ModelConfig
    }

    if (!documentId) {
      return NextResponse.json({ error: '缺少 documentId' }, { status: 400 })
    }

    if (!chunks || !Array.isArray(chunks)) {
      return NextResponse.json({ error: '缺少 chunks 参数' }, { status: 400 })
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return NextResponse.json({ error: '模型配置不完整' }, { status: 400 })
    }

    // 执行批量翻译
    const result = await batchTranslate(chunks, modelConfig)

    if (!result.success) {
      return NextResponse.json({ error: result.error || '翻译失败' }, { status: 500 })
    }

    // 保存翻译缓存
    const translationCache: TranslationCache = {
      id: `${documentId}_translation`,
      documentId,
      modelUsed: modelConfig.modelName,
      translatedAt: new Date().toISOString(),
      blocks: result.translations!.map(t => ({
        blockId: t.id,
        original: chunks.find(c => c.id === t.id)?.text || '',
        translated: t.translated,
      })),
    }
    await saveTranslation(translationCache)

    // 更新页面中的文本块翻译
    const pages = await getPDFPagesByDocumentId(documentId)
    const translationMap = new Map(result.translations!.map(t => [t.id, t.translated]))

    for (const page of pages) {
      let updated = false
      const updatedBlocks = page.blocks.map(block => {
        const translated = translationMap.get(block.id)
        if (translated && translated !== block.translated) {
          updated = true
          return { ...block, translated }
        }
        return block
      })

      if (updated) {
        await updatePageBlocks(page.id, updatedBlocks)
      }
    }

    return NextResponse.json({ 
      translations: result.translations,
      cached: true,
    })
  } catch (error) {
    console.error('Translate error:', error)
    const message = error instanceof Error ? error.message : '翻译处理失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
