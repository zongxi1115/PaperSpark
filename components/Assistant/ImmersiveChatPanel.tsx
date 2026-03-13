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

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 处理选中文字提问
  useEffect(() => {
    if (selectionContext && selectionContext.text) {
      setInputValue(`关于选中的内容："${selectionContext.text.slice(0, 100)}${selectionContext.text.length > 100 ? '...' : ''}"\n\n请解释一下这段内容的含义。`)
      inputRef.current?.focus()
    }
  }, [selectionContext])

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
        pageNum: r.pageNum,
        text: r.text,
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

${selectionText}${contextText}

用户问题：${content}

请用中文回答，简洁明了。如果引用了文档内容，请在句末标注引用编号如[1]。`,
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
    }
  }, [inputValue, isLoading, title, selectionContext, searchRelevantBlocks, generateFollowUpQuestions])

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
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Icon icon="mdi:chat-question-outline" className="text-4xl mb-3 text-gray-600" />
            <p className="text-sm text-center mb-4">选择文本提问，或直接输入问题</p>
            <div className="space-y-2 w-full max-w-xs">
              {quickQuestions.map((q, i) => (
                <button
                  key={i}
                  className="w-full text-left px-3 py-2 text-xs text-gray-400 bg-[#1a1a1a] rounded-lg hover:bg-[#252525] hover:text-gray-300 transition-colors"
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
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-xl px-3 py-2 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-[#252525] text-gray-200'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content || '...'}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}

                  {/* 引用来源（精简显示） */}
                  {message.citations && message.citations.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#333]">
                      <p className="text-[10px] text-gray-500 mb-1">引用来源：</p>
                      <div className="flex flex-wrap gap-1">
                        {message.citations.slice(0, 3).map((citation) => (
                          <button
                            key={citation.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-[#1a1a1a] text-blue-400 rounded hover:bg-blue-500/10 transition-colors"
                            onClick={() => onCitationClick({
                              blockId: citation.blockId,
                              pageNum: citation.pageNum,
                              title: `第${citation.pageNum}页`,
                              note: citation.text.slice(0, 100),
                            })}
                          >
                            <Icon icon="mdi:file-document-outline" className="text-[10px]" />
                            <span>第{citation.pageNum}页</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 推荐追问 */}
                  {message.followUpQuestions && message.followUpQuestions.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#333]">
                      <p className="text-[10px] text-gray-500 mb-1.5">推荐追问：</p>
                      <div className="space-y-1">
                        {message.followUpQuestions.map((q, i) => (
                          <button
                            key={i}
                            className="block w-full text-left px-2 py-1.5 text-[11px] text-gray-400 bg-[#1a1a1a] rounded hover:bg-[#2a2a2a] hover:text-gray-300 transition-colors"
                            onClick={() => setInputValue(q)}
                          >
                            <Icon icon="mdi:lightbulb-outline" className="text-amber-500 mr-1" />
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex justify-start">
                <div className="bg-[#252525] rounded-xl px-3 py-2">
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
