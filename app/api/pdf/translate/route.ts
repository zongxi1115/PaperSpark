import { NextRequest } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import { saveTranslation, getPDFPagesByDocumentId, updatePageBlocks } from '@/lib/pdfCache'
import type {
  ModelConfig,
  TranslationBlockPayload,
  TranslationCache,
  TranslationStreamEvent,
} from '@/lib/types'

export const maxDuration = 120

const MAX_CONCURRENT_REQUESTS = 8

type ParagraphBlock = TranslationBlockPayload & {
  order: number
}

function shouldTranslateBlock(block: TranslationBlockPayload): boolean {
  if (!block.text.trim()) return false
  if (block.type === 'header' || block.type === 'footer') return false
  return block.sourceLabel !== 'Picture'
}

function buildParagraphBlocks(blocks: TranslationBlockPayload[]): ParagraphBlock[] {
  return blocks
    .filter(shouldTranslateBlock)
    .map((block, index) => ({
      ...block,
      order: index,
    }))
    .sort((a, b) => {
      if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum
      return a.order - b.order
    })
}

function buildContextText(
  blocks: ParagraphBlock[],
  targetIndex: number,
  direction: 'before' | 'after',
  limit: number,
) {
  const snippets: string[] = []
  let cursor = direction === 'before' ? targetIndex - 1 : targetIndex + 1

  while (cursor >= 0 && cursor < blocks.length && snippets.length < limit) {
    const block = blocks[cursor]
    if (!block.text.trim()) {
      cursor += direction === 'before' ? -1 : 1
      continue
    }

    snippets.push(block.text.trim())
    cursor += direction === 'before' ? -1 : 1
  }

  const ordered = direction === 'before' ? snippets.reverse() : snippets
  return ordered
    .map((text, index) => `[${direction === 'before' ? '上文' : '下文'}${index + 1}] ${text.slice(0, 280)}`)
    .join('\n')
}

function buildTranslationMessages(blocks: ParagraphBlock[], targetIndex: number) {
  const block = blocks[targetIndex]
  const contextBefore = buildContextText(blocks, targetIndex, 'before', 2)
  const contextAfter = buildContextText(blocks, targetIndex, 'after', 1)

  const systemPrompt = `你是一个专业的学术翻译助手。请把给定英文段落翻译成自然、准确的中文。

规则：
1. 只输出中文译文，不要输出英文原文，不要解释，不要输出任何非中文内容。
2. 保留公式、变量、引用编号、专有名词。
3. 术语保持学术表达，避免口语化。
4. 如果原文是标题，就翻成简洁标题；如果原文是正文段落，就翻成正文段落。
5. 绝对不要把英文原文当作译文输出。如果原文已经是中文，直接原样输出。`

  const userPrompt = [
    `文本类型：${block.type}。页码：${block.pageNum}。`,
    contextBefore ? `【上文参考】\n${contextBefore}` : '',
    `【待翻译段落】\n${block.text.trim()}`,
    contextAfter ? `【下文参考】\n${contextAfter}` : '',
  ].filter(Boolean).join('\n\n')

  return { systemPrompt, userPrompt }
}

function encodeSSE(event: TranslationStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { documentId, blocks, modelConfig } = body as {
      documentId: string
      blocks: TranslationBlockPayload[]
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

    const paragraphBlocks = buildParagraphBlocks(blocks)
    const total = paragraphBlocks.length

    if (total === 0) {
      return new Response(JSON.stringify({ error: '没有可翻译的段落' }), { status: 400 })
    }

    const provider = createOpenAI({
      baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
      apiKey: modelConfig.apiKey,
    })

    const encoder = new TextEncoder()
    const translatedMap = new Map<string, string>()
    let completed = 0
    let nextIndex = 0
    let isClosed = false

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: TranslationStreamEvent) => {
          if (isClosed) return
          try {
            controller.enqueue(encoder.encode(encodeSSE(event)))
          } catch {
            // Controller already closed, ignore
          }
        }

        const translateOneBlock = async (index: number) => {
          const block = paragraphBlocks[index]
          const { systemPrompt, userPrompt } = buildTranslationMessages(paragraphBlocks, index)
          let translated = ''

          try {
            const result = streamText({
              model: provider.chat(modelConfig.modelName),
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }],
            })

            for await (const delta of result.textStream) {
              translated += delta
              send({
                type: 'chunk',
                data: {
                  chunkId: block.id,
                  blockId: block.id,
                  original: block.text,
                  translated,
                  progress: completed,
                  total,
                  done: false,
                },
              })
            }

            translated = translated.trim() || block.text
            translatedMap.set(block.id, translated)
          } catch (error) {
            translated = block.text
            translatedMap.set(block.id, translated)
            send({
              type: 'error',
              data: {
                chunkId: block.id,
                blockId: block.id,
                error: error instanceof Error ? error.message : '翻译失败',
                progress: completed,
                total,
              },
            })
          }

          completed += 1

          send({
            type: 'chunk',
            data: {
              chunkId: block.id,
              blockId: block.id,
              original: block.text,
              translated,
              progress: completed,
              total,
              done: true,
            },
          })

          send({
            type: 'progress',
            data: { progress: completed, total },
          })
        }

        const worker = async () => {
          while (true) {
            const currentIndex = nextIndex
            nextIndex += 1

            if (currentIndex >= paragraphBlocks.length) {
              return
            }

            await translateOneBlock(currentIndex)
          }
        }

        try {
          send({
            type: 'start',
            data: { total, progress: 0 },
          })

          const concurrency = Math.min(MAX_CONCURRENT_REQUESTS, paragraphBlocks.length)
          await Promise.all(Array.from({ length: concurrency }, () => worker()))

          const translationCache: TranslationCache = {
            id: `${documentId}_translation`,
            documentId,
            modelUsed: modelConfig.modelName,
            translatedAt: new Date().toISOString(),
            blocks: blocks
              .filter(block => translatedMap.has(block.id))
              .map(block => ({
                blockId: block.id,
                original: block.text,
                translated: translatedMap.get(block.id) || block.text,
              })),
          }
          await saveTranslation(translationCache)

          const pages = await getPDFPagesByDocumentId(documentId)
          for (const page of pages) {
            let updated = false
            const updatedBlocks = page.blocks.map(block => {
              const translated = translatedMap.get(block.id)
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

          send({
            type: 'complete',
            data: { total, progress: total },
          })
          isClosed = true
          controller.close()
        } catch (error) {
          console.error('Translate stream error:', error)
          send({
            type: 'error',
            data: {
              error: error instanceof Error ? error.message : '处理失败',
            },
          })
          isClosed = true
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Translate error:', error)
    const message = error instanceof Error ? error.message : '翻译处理失败'
    return new Response(JSON.stringify({ error: message }), { status: 500 })
  }
}
