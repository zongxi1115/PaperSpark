'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button, Tooltip, Spinner, addToast } from '@heroui/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '@iconify/react'
import {
  getSettings,
  getSelectedLargeModel,
  getSelectedSmallModel,
  generateId,
} from '@/lib/storage'
import { getVectorDocumentsByDocumentId } from '@/lib/pdfCache'
import type { TextBlock, ModelConfig, RAGSearchResult, GuideFocusTarget } from '@/lib/types'

interface ImmersiveChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations?: ChatCitation[]
  followUpQuestions?: string[]
  createdAt: string
}

interface ChatCitation {
  id: string
  blockId: string
  pageNum: number
  text: string
  score: number
}

interface SelectionContext {
  id: string
  text: string
  pageNum: number
  blockId?: string
}

interface ImmersiveChatPanelProps {
  knowledgeItemId: string
  title: string
  blocks: TextBlock[]
  selectionContext?: SelectionContext | null
  onCitationClick: (target: GuideFocusTarget) => void
}

function splitIntoSentences(text: string) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const sentences: string[] = []
  let buffer = ''
  const chars = Array.from(normalized)
  for (let i = 0; i < chars.length; i++) {
    buffer += chars[i]
    const isCnEnd = /[。！？]/.test(chars[i])
    const isEnEnd = /[.!?]/.test(chars[i]) && (
      i === chars.length - 1 || /\s/.test(chars[i + 1] || '')
    )
    if (isCnEnd || isEnEnd) {
      const trimmed = buffer.trim()
      if (trimmed.length > 3) {
        sentences.push(trimmed)
        buffer = ''
      }
    }
  }
  const rest = buffer.trim()
  if (rest.length > 0) sentences.push(rest)
  return sentences.length ? sentences : [normalized]
}

function pickBestSentence(blockText: string, preferredText?: string) {
  const sentences = splitIntoSentences(blockText)
  if (!sentences.length) return { sentence: '', sentenceIndex: -1 }

  const preferred = (preferredText || '').replace(/\s+/g, ' ').trim()
  if (!preferred) return { sentence: sentences[0], sentenceIndex: 0 }

  let bestIdx = 0
  let bestScore = -1

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]
    // Direct containment
    if (s === preferred || preferred.includes(s) || s.includes(preferred)) {
      return { sentence: s, sentenceIndex: i }
    }
    // 4-gram overlap scoring
    const n = 4
    const sGrams = new Set<string>()
    for (let j = 0; j <= s.length - n; j++) sGrams.add(s.slice(j, j + n))
    let overlap = 0
    for (let j = 0; j <= preferred.length - n; j++) {
      if (sGrams.has(preferred.slice(j, j + n))) overlap++
    }
    const score = overlap / Math.max(1, preferred.length - n + 1)
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  return { sentence: sentences[bestIdx], sentenceIndex: bestIdx }
}

function injectCitationLinks(markdown: string, maxIndex: number) {
  if (!markdown || maxIndex <= 0) return markdown
  return markdown.replace(/\[(\d{1,3})\]/g, (match, num, offset, full) => {
    const index = Number(num)
    if (!Number.isFinite(index) || index < 1 || index > maxIndex) return match
    // Skip if it's already a markdown link like [1](...)
    if (full[offset + match.length] === '(') return match
    return `[${num}](cite:${num})`
  })
}

function buildCitationTarget(
  citation: ChatCitation,
  blockMap: Map<string, TextBlock>,
): GuideFocusTarget {
  const block = blockMap.get(citation.blockId)
  const pageNum = citation.pageNum || block?.pageNum || 0
  const { sentence, sentenceIndex } = pickBestSentence(
    block?.text || citation.text,
    citation.text,
  )
  const sentenceNo = Math.max(sentenceIndex + 1, 1)
  return {
    blockId: citation.blockId,
    pageNum: pageNum || 1,
    title: pageNum
      ? `第${pageNum}页 · 第${sentenceNo}句`
      : `第${sentenceNo}句`,
    note: (sentence || citation.text).slice(0, 140),
  }
}

export default function ImmersiveChatPanel({
  knowledgeItemId,
  title,
  blocks,
  selectionContext,
  onCitationClick,
}: ImmersiveChatPanelProps) {
  const [messages, setMessages] = useState<ImmersiveChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isGeneratingFollowUp, setIsGeneratingFollowUp] = useState(false)
  const [quoteContext, setQuoteContext] = useState<{ text: string; source: 'chat' | 'pdf'; meta?: string; messageId: string } | null>(null)

  const messageListRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const blockById = useRef<Map<string, TextBlock>>(new Map())
  useEffect(() => {
    blockById.current = new Map(blocks.map(block => [block.id, block]))
  }, [blocks])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 处理选中文字提问
  useEffect(() => {
    if (selectionContext && selectionContext.text) {
      setQuoteContext({
        text: selectionContext.text.length > 420 ? `${selectionContext.text.slice(0, 420)}…` : selectionContext.text,
        source: 'pdf',
        meta: selectionContext.pageNum ? `第${selectionContext.pageNum}页` : undefined,
        messageId: selectionContext.id,
      })
      inputRef.current?.focus()
    }
  }, [selectionContext])

  const handleMessageSelection = useCallback(() => {
    if (!messageListRef.current) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const anchorNode = selection.anchorNode
    const focusNode = selection.focusNode
    const anchorEl = (anchorNode instanceof HTMLElement) ? anchorNode : anchorNode?.parentElement
    const focusEl = (focusNode instanceof HTMLElement) ? focusNode : focusNode?.parentElement
    if (!anchorEl || !focusEl) return
    if (!messageListRef.current.contains(anchorEl) || !messageListRef.current.contains(focusEl)) return

    const text = selection.toString().trim().replace(/\s+/g, ' ')
    if (!text) return

    // Try to attach to nearest message container.
    const msgEl = anchorEl.closest('[data-chat-message-id]') as HTMLElement | null
    const messageId = msgEl?.dataset.chatMessageId || 'unknown'
    setQuoteContext({
      text: text.length > 420 ? `${text.slice(0, 420)}…` : text,
      source: 'chat',
      messageId,
    })
    inputRef.current?.focus()
  }, [])

  // RAG 搜索
  const searchRelevantBlocks = useCallback(async (query: string): Promise<ChatCitation[]> => {
    try {
      const settings = getSettings()
      const smallModelConfig = getSelectedSmallModel(settings)

      // 获取本地向量
      const localVectors = await getVectorDocumentsByDocumentId(knowledgeItemId)

      const response = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: knowledgeItemId,
          query,
          topK: 5,
          modelConfig: smallModelConfig,
          localVectors,
        }),
      })

      if (!response.ok) {
        return []
      }

      const result = await response.json()
      if (!result.success || !Array.isArray(result.results)) {
        return []
      }

      return result.results.map((r: RAGSearchResult) => ({
        id: r.blockId,
        blockId: r.blockId,
        pageNum: r.pageNum || blockById.current.get(r.blockId)?.pageNum || 0,
        text: r.text || blockById.current.get(r.blockId)?.text || '',
        score: r.score,
      }))
    } catch (error) {
      console.error('RAG search error:', error)
      return []
    }
  }, [knowledgeItemId])

  // 生成推荐追问问题
  const generateFollowUpQuestions = useCallback(async (userQuery: string, assistantResponse: string): Promise<string[]> => {
    try {
      const settings = getSettings()
      const smallModelConfig = getSelectedSmallModel(settings)

      if (!smallModelConfig?.apiKey) {
        return []
      }

      setIsGeneratingFollowUp(true)

      const response = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `基于以下对话，生成3个用户可能想继续追问的问题。每个问题一行，不要编号，直接输出问题。

文档标题：${title}

用户问题：${userQuery}

AI回答：${assistantResponse.slice(0, 500)}

请生成3个相关的追问问题：`,
          modelConfig: smallModelConfig,
          maxTokens: 150,
        }),
      })

      if (!response.ok) {
        return []
      }

      const data = await response.json()
      if (!data.completion) {
        return []
      }

      const questions = data.completion
        .split('\n')
        .map((q: string) => q.trim())
        .filter((q: string) => q.length > 5 && q.length < 100)
        .slice(0, 3)

      return questions
    } catch (error) {
      console.error('Generate follow-up questions error:', error)
      return []
    } finally {
      setIsGeneratingFollowUp(false)
    }
  }, [title])

  // 发送消息
  const handleSend = useCallback(async () => {
    const content = inputValue.trim()
    if (!content || isLoading) return

    const userMessage: ImmersiveChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsLoading(true)

    const assistantMessage: ImmersiveChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    }

    try {
      const settings = getSettings()
      const largeModelConfig = getSelectedLargeModel(settings)

      if (!largeModelConfig?.apiKey) {
        addToast({ title: '请先配置大参数模型 API Key', color: 'warning' })
        setIsLoading(false)
        return
      }

      // 搜索相关内容
      const citations = await searchRelevantBlocks(content)

      // 构建上下文
      let contextText = ''
      if (citations.length > 0) {
        contextText = `\n\n以下是文档中与问题相关的段落，请参考这些内容回答：\n${citations.map((c, i) => `[${i + 1}] 第${c.pageNum}页：${c.text}`).join('\n\n')}`
      }

      // 如果有选中上下文
      let selectionText = ''
      if (selectionContext?.text) {
        selectionText = `\n\n用户选中的内容（第${selectionContext.pageNum}页）：\n"${selectionContext.text}"`
      }

      let quoteText = ''
      if (quoteContext?.text) {
        quoteText = `\n\n用户引用的内容：\n"${quoteContext.text}"`
      }

      abortControllerRef.current = new AbortController()

      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `你是一个学术文档阅读助手，帮助用户理解文档内容。

文档标题：${title}

${selectionText}${quoteText}${contextText}

用户问题：${content}

请用中文回答，简洁明了。回答中引用文档内容时，请在相关句末用方括号标注对应段落编号（如[1]、[2]），编号必须与上文参考段落编号一致。`,
            },
          ],
          modelConfig: largeModelConfig,
          systemPrompt: '你是一个学术文档阅读助手，帮助用户理解学术论文和研究文档。回答要简洁、专业、有依据。',
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error('请求失败')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          let lineBreakIndex = buffer.indexOf('\n')
          while (lineBreakIndex >= 0) {
            const line = buffer.slice(0, lineBreakIndex)
            buffer = buffer.slice(lineBreakIndex + 1)

            if (line.trim()) {
              try {
                const payload = JSON.parse(line)
                if (payload.type === 'text-delta' && payload.delta) {
                  fullContent += payload.delta
                  assistantMessage.content = fullContent
                  setMessages(prev => {
                    const newMessages = [...prev]
                    const lastIdx = newMessages.findIndex(m => m.id === assistantMessage.id)
                    if (lastIdx >= 0) {
                      newMessages[lastIdx] = { ...assistantMessage }
                    } else {
                      newMessages.push(assistantMessage)
                    }
                    return newMessages
                  })
                }
              } catch {
                // 忽略解析错误
              }
            }
            lineBreakIndex = buffer.indexOf('\n')
          }
        }
      }

      // 添加引用信息
      if (citations.length > 0) {
        assistantMessage.citations = citations
      }

      // 生成推荐追问问题
      const followUpQuestions = await generateFollowUpQuestions(content, fullContent)
      if (followUpQuestions.length > 0) {
        assistantMessage.followUpQuestions = followUpQuestions
      }

      setMessages(prev => {
        const newMessages = [...prev]
        const lastIdx = newMessages.findIndex(m => m.id === assistantMessage.id)
        if (lastIdx >= 0) {
          newMessages[lastIdx] = { ...assistantMessage }
        }
        return newMessages
      })

    } catch (error) {
      console.error('Chat error:', error)
      assistantMessage.content = '抱歉，回答时出现错误，请稍后重试。'
      setMessages(prev => [...prev, assistantMessage])
    } finally {
      setIsLoading(false)
      setQuoteContext(null)
    }
  }, [inputValue, isLoading, title, selectionContext, quoteContext, searchRelevantBlocks, generateFollowUpQuestions])

  // 停止生成
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsLoading(false)
  }, [])

  // 快捷问题
  const quickQuestions = [
    '这篇文章的主要贡献是什么？',
    '研究方法有哪些特点？',
    '结论有哪些局限性？',
  ]

  return (
    <div className="flex flex-col h-full">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-[#333]">
        <h3 className="text-sm font-medium text-gray-200">AI 问答</h3>
        <p className="text-xs text-gray-500 mt-0.5 truncate">{title}</p>
      </div>

      {/* 消息列表 */}
      <div
        ref={messageListRef}
        className="flex-1 overflow-auto p-4 space-y-4"
        onMouseUp={handleMessageSelection}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-500/10 flex items-center justify-center mb-3">
              <Icon icon="mdi:chat-question-outline" className="text-xl text-blue-400/60" />
            </div>
            <p className="text-sm text-center mb-4 text-gray-400">选择文本提问，或直接输入问题</p>
            <div className="space-y-2 w-full max-w-xs">
              {quickQuestions.map((q, i) => (
                <button
                  key={i}
                  className="w-full text-left px-3 py-2.5 text-xs text-gray-400 bg-[#1a1a1a] rounded-xl border border-white/[0.04] hover:bg-[#222] hover:text-gray-300 hover:border-white/[0.08] transition-all"
                  onClick={() => setInputValue(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end pl-10' : 'gap-2.5 pr-6'}`}
              >
                {message.role === 'assistant' && (
                  <div className="shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mt-1">
                    <Icon icon="mdi:robot-outline" className="text-[11px] text-blue-400" />
                  </div>
                )}
                <div
                  data-chat-message-id={message.id}
                  className={`rounded-2xl px-3.5 py-2.5 ${
                    message.role === 'user'
                      ? 'bg-blue-600/90 text-white max-w-[85%] rounded-tr-sm'
                      : 'flex-1 min-w-0 bg-[#1e1e1e] border border-white/[0.04] text-gray-200 rounded-tl-sm'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-invert prose-sm max-w-none [&_sup]:inline [&_sup]:align-baseline">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node, href, children, ...props }) => {
                            if (href?.startsWith('cite:')) {
                              const index = Number(href.slice('cite:'.length))
                              const citation = message.citations?.[index - 1]
                              if (!citation) {
                                console.warn('Citation not found:', index, 'in', message.citations)
                                return <span className="text-red-400">[{children}]</span>
                              }
                              return (
                                <button
                                  type="button"
                                  className="not-prose inline-flex items-center justify-center min-w-[1.5em] min-h-[1.5em] text-[10px] font-bold text-white bg-blue-500 rounded px-1 mx-0.5 hover:bg-blue-600 active:bg-blue-700 transition-colors cursor-pointer relative -top-[0.2em] leading-none shadow-sm"
                                  style={{ zIndex: 10 }}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    console.log('Citation clicked:', index, citation)
                                    onCitationClick(buildCitationTarget(citation, blockById.current))
                                  }}
                                  title={`点击查看引用 [${index}]`}
                                >
                                  {children}
                                </button>
                              )
                            }
                            return (
                              <a href={href} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                                {children}
                              </a>
                            )
                          },
                        }}
                      >
                        {injectCitationLinks(message.content || '...', message.citations?.length || 0)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}

                  {/* Citation sources */}
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-white/[0.06]">
                      <div className="flex flex-wrap gap-1">
                        {message.citations.map((citation, i) => {
                          const target = buildCitationTarget(citation, blockById.current)
                          return (
                            <button
                              key={citation.id}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400 bg-white/[0.04] rounded-lg hover:bg-white/[0.08] hover:text-gray-300 transition-colors"
                              onClick={() => onCitationClick(target)}
                            >
                              <span className="text-blue-400 font-semibold">[{i + 1}]</span>
                              <span>{target.title}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Follow-up questions */}
                  {message.followUpQuestions && message.followUpQuestions.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-white/[0.06]">
                      <div className="flex flex-wrap gap-1.5">
                        {message.followUpQuestions.map((q, i) => (
                          <button
                            key={i}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-gray-400 bg-white/[0.04] rounded-full hover:bg-white/[0.08] hover:text-gray-300 transition-colors text-left"
                            onClick={() => setInputValue(q)}
                          >
                            <Icon icon="mdi:lightbulb-outline" className="text-amber-500/70 text-[10px] shrink-0" />
                            <span className="line-clamp-1">{q}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-2.5 pr-6">
                <div className="shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center mt-1">
                  <Icon icon="mdi:robot-outline" className="text-[11px] text-blue-400" />
                </div>
                <div className="bg-[#1e1e1e] border border-white/[0.04] rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Spinner size="sm" color="primary" />
                    <span className="text-sm">思考中...</span>
                  </div>
                </div>
              </div>
            )}

            {isGeneratingFollowUp && (
              <div className="flex justify-center">
                <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                  <Spinner size="sm" />
                  <span>生成推荐问题...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-t border-[#333]">
        {quoteContext && (
          <div className="mb-2 rounded-lg border border-[#333] bg-[#121212] px-3 py-2">
            <div className="flex items-start gap-2">
              <Icon icon="mdi:format-quote-close" className="text-gray-500 text-sm mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-400 mb-0.5">
                  引用{quoteContext.meta ? ` · ${quoteContext.meta}` : ''}
                </p>
                <p className="text-xs text-gray-200 leading-relaxed line-clamp-3 wrap-break-word">{quoteContext.text}</p>
              </div>
              <button
                type="button"
                className="text-gray-500 hover:text-gray-300"
                onClick={() => setQuoteContext(null)}
                aria-label="clear-quote"
              >
                <Icon icon="mdi:close" className="text-base" />
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            className="flex-1 bg-[#1a1a1a] text-gray-200 text-sm rounded-lg px-3 py-2 resize-none focus:outline-none border border-[#333] focus:border-blue-500 placeholder-gray-500"
            rows={2}
            placeholder="输入问题..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          {isLoading ? (
            <Button
              isIconOnly
              color="danger"
              variant="light"
              className="self-end"
              onPress={handleStop}
            >
              <Icon icon="mdi:stop" className="text-lg" />
            </Button>
          ) : (
            <Tooltip content="发送">
              <Button
                isIconOnly
                color="primary"
                className="self-end"
                onPress={handleSend}
                isDisabled={!inputValue.trim()}
              >
                <Icon icon="mdi:send" className="text-lg" />
              </Button>
            </Tooltip>
          )}
        </div>
        <p className="text-[10px] text-gray-600 mt-1.5 text-center">
          Shift+Enter 换行 · Enter 发送
        </p>
      </div>
    </div>
  )
}
