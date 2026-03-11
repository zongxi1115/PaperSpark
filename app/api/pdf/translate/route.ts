import { NextRequest } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { saveTranslation, getPDFPagesByDocumentId, updatePageBlocks } from '@/lib/pdfCache'
import type { ModelConfig, TranslationCache, TranslationStreamEvent } from '@/lib/types'

// 智能分块：将小块合并为语义完整的段落
function smartMergeBlocks(
  blocks: { id: string; text: string; type?: string }[]
): { id: string; text: string; blockIds: string[] }[] {
  if (!blocks.length) return []

  const chunks: { id: string; text: string; blockIds: string[] }[] = []
  let currentChunk: { text: string; blockIds: string[] } | null = null
  const TARGET_SIZE = 600 // 目标每块字数
  const MAX_SIZE = 1000 // 最大字数

  for (const block of blocks) {
    const text = block.text.trim()
    if (!text) continue

    // 标题类单独成块
    if (block.type === 'title' || block.type === 'subtitle') {
      if (currentChunk) {
        chunks.push({
          id: `chunk_${chunks.length}`,
          text: currentChunk.text.trim(),
          blockIds: currentChunk.blockIds,
        })
        currentChunk = null
      }
      chunks.push({
        id: `chunk_${chunks.length}`,
        text,
        blockIds: [block.id],
      })
      continue
    }

    // 初始化当前块
    if (!currentChunk) {
      currentChunk = { text: '', blockIds: [] }
    }

    // 检查是否需要新开一块
    const potentialSize = currentChunk.text.length + text.length + 1
    const shouldBreak = 
      potentialSize > MAX_SIZE ||
      (currentChunk.text.length >= TARGET_SIZE && text.endsWith('.'))

    if (shouldBreak && currentChunk.text) {
      chunks.push({
        id: `chunk_${chunks.length}`,
        text: currentChunk.text.trim(),
        blockIds: currentChunk.blockIds,
      })
      currentChunk = { text, blockIds: [block.id] }
    } else {
      currentChunk.text += (currentChunk.text ? '\n' : '') + text
      currentChunk.blockIds.push(block.id)
    }
  }

  // 保存最后一块
  if (currentChunk?.text) {
    chunks.push({
      id: `chunk_${chunks.length}`,
      text: currentChunk.text.trim(),
      blockIds: currentChunk.blockIds,
    })
  }

  return chunks
}

// 带上下文的翻译
async function translateWithContext(
  chunks: { id: string; text: string }[],
  targetIndex: number,
  modelConfig: ModelConfig
): Promise<{ success: boolean; translated?: string; error?: string }> {
  const targetChunk = chunks[targetIndex]
  if (!targetChunk) {
    return { success: false, error: '无效的块索引' }
  }

  // 获取上下文（前后各5块）
  const CONTEXT_SIZE = 5
  const startIndex = Math.max(0, targetIndex - CONTEXT_SIZE)
  const endIndex = Math.min(chunks.length - 1, targetIndex + CONTEXT_SIZE)

  const contextChunks = chunks.slice(startIndex, endIndex + 1)
  const targetLocalIndex = targetIndex - startIndex

  // 构建上下文提示
  let contextBefore = ''
  let contextAfter = ''

  for (let i = 0; i < contextChunks.length; i++) {
    const chunk = contextChunks[i]
    if (i < targetLocalIndex) {
      contextBefore += `[上文${targetLocalIndex - i}] ${chunk.text.slice(0, 200)}...\n`
    } else if (i > targetLocalIndex) {
      contextAfter += `[下文${i - targetLocalIndex}] ${chunk.text.slice(0, 200)}...\n`
    }
  }

  const systemPrompt = `你是一个专业的学术翻译助手，请将标记为【待翻译】的文本翻译成中文。

规则：
1. 只翻译【待翻译】标记的内容，不要翻译上下文
2. 准确传达原文含义，使用规范的学术术语
3. 保持专业、严谨的语言风格
4. 参考上下文理解专业术语和指代关系
5. 只返回翻译后的文本，不要添加任何解释或标记`

  const userPrompt = `${contextBefore ? `【上文参考】\n${contextBefore}\n` : ''}【待翻译】\n${targetChunk.text}\n${contextAfter ? `\n【下文参考】\n${contextAfter}` : ''}`

  try {
    const provider = createOpenAI({
      baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
      apiKey: modelConfig.apiKey,
    })

    const { text: translated } = await generateText({
      model: provider.chat(modelConfig.modelName),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

    return { success: true, translated }
  } catch (err) {
    const message = err instanceof Error ? err.message : '翻译失败'
    return { success: false, error: message }
  }
}

// SSE 编码器
function encodeSSE(event: TranslationStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, blocks, modelConfig } = body as {
      documentId: string
      blocks: { id: string; text: string; type?: string }[]
      modelConfig: ModelConfig
    }

    if (!documentId) {
      return new Response(JSON.stringify({ error: '缺少 documentId' }), { status: 400 })
    }

    if (!blocks || !Array.isArray(blocks)) {
      return new Response(JSON.stringify({ error: '缺少 blocks 参数' }), { status: 400 })
    }

    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      return new Response(JSON.stringify({ error: '模型配置不完整' }), { status: 400 })
    }

    // 智能合并分块
    const chunks = smartMergeBlocks(blocks)
    const total = chunks.length

    const encoder = new TextEncoder()
    const translations: { id: string; translated: string; blockIds: string[] }[] = []

    // 创建可读流
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 发送开始事件
          controller.enqueue(encoder.encode(encodeSSE({
            type: 'start',
            data: { total },
          })))

          // 逐个翻译（带上下文）
          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i]

            // 发送进度事件
            controller.enqueue(encoder.encode(encodeSSE({
              type: 'progress',
              data: { progress: i + 1, total },
            })))

            // 翻译（带上下文）
            const result = await translateWithContext(chunks, i, modelConfig)

            if (result.success && result.translated) {
              translations.push({
                id: chunk.id,
                translated: result.translated,
                blockIds: chunk.blockIds,
              })

              // 发送单块翻译完成事件
              controller.enqueue(encoder.encode(encodeSSE({
                type: 'chunk',
                data: {
                  chunkId: chunk.id,
                  original: chunk.text,
                  translated: result.translated,
                  progress: i + 1,
                  total,
                },
              })))
            } else {
              // 翻译失败，保留原文
              translations.push({
                id: chunk.id,
                translated: chunk.text,
                blockIds: chunk.blockIds,
              })

              controller.enqueue(encoder.encode(encodeSSE({
                type: 'error',
                data: {
                  chunkId: chunk.id,
                  error: result.error || '翻译失败',
                },
              })))
            }

            // 添加延迟避免 API 限流
            if (i < chunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500))
            }
          }

          // 构建 blockId -> translated 映射
          const blockTranslationMap = new Map<string, string>()
          for (const t of translations) {
            for (const blockId of t.blockIds) {
              // 按比例分配翻译结果（简化处理）
              const chunk = chunks.find(c => c.id === t.id)
              if (chunk && chunk.blockIds.length > 1) {
                // 多 block 合并的情况，需要分割
                const texts = chunk.blockIds.map(bid => {
                  const block = blocks.find(b => b.id === bid)
                  return block?.text || ''
                })
                const totalLen = texts.reduce((sum, t) => sum + t.length, 0)

                let translatedRemaining = t.translated
                for (let j = 0; j < texts.length; j++) {
                  const ratio = texts[j].length / totalLen
                  const estimatedLen = Math.floor(t.translated.length * ratio)

                  if (j === texts.length - 1) {
                    blockTranslationMap.set(chunk.blockIds[j], translatedRemaining)
                  } else {
                    // 尝试在句号处分割
                    const splitPoint = findSplitPoint(translatedRemaining, estimatedLen)
                    blockTranslationMap.set(chunk.blockIds[j], translatedRemaining.slice(0, splitPoint))
                    translatedRemaining = translatedRemaining.slice(splitPoint).trim()
                  }
                }
              } else {
                blockTranslationMap.set(t.blockIds[0], t.translated)
              }
            }
          }

          // 保存翻译缓存
          const translationCache: TranslationCache = {
            id: `${documentId}_translation`,
            documentId,
            modelUsed: modelConfig.modelName,
            translatedAt: new Date().toISOString(),
            blocks: Array.from(blockTranslationMap.entries()).map(([blockId, translated]) => ({
              blockId,
              original: blocks.find(b => b.id === blockId)?.text || '',
              translated,
            })),
          }
          await saveTranslation(translationCache)

          // 更新页面中的文本块翻译
          const pages = await getPDFPagesByDocumentId(documentId)

          for (const page of pages) {
            let updated = false
            const updatedBlocks = page.blocks.map(block => {
              const translated = blockTranslationMap.get(block.id)
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

          // 发送完成事件
          controller.enqueue(encoder.encode(encodeSSE({
            type: 'complete',
            data: { total: translations.length },
          })))

          controller.close()
        } catch (error) {
          console.error('Stream error:', error)
          controller.enqueue(encoder.encode(encodeSSE({
            type: 'error',
            data: { error: error instanceof Error ? error.message : '处理失败' },
          })))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Translate error:', error)
    const message = error instanceof Error ? error.message : '翻译处理失败'
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }
}

// 辅助函数：在合适的位置分割翻译文本
function findSplitPoint(text: string, estimatedLen: number): number {
  if (text.length <= estimatedLen) return text.length

  // 在句号、问号、感叹号后分割
  const searchStart = Math.max(0, estimatedLen - 50)
  const searchEnd = Math.min(text.length, estimatedLen + 50)
  const segment = text.slice(searchStart, searchEnd)

  const match = segment.match(/[。！？.!?][\s]*/)
  if (match && match.index !== undefined) {
    return searchStart + match.index + match[0].length
  }

  // 没有句号，在空格处分割
  const spaceMatch = segment.match(/\s+/)
  if (spaceMatch && spaceMatch.index !== undefined) {
    return searchStart + spaceMatch.index + spaceMatch[0].length
  }

  return estimatedLen
}
