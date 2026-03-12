'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, Textarea, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getSettings, getSelectedLargeModel, generateId } from '@/lib/storage'
import type { AssistantCitation, AssistantMessage, GuideFocusTarget, TextBlock } from '@/lib/types'

interface SelectionQuestionContext {
  id: string
  text: string
  pageNum: number
  blockId?: string
}

interface ImmersiveChatPanelProps {
  knowledgeItemId: string
  title: string
  blocks: TextBlock[]
  selectionContext: SelectionQuestionContext | null
  onCitationClick?: (target: GuideFocusTarget) => void
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[\s，。；：、“”‘’（）()【】\[\],.;:!?！？]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}

function buildImmersiveCandidates(params: {
  knowledgeItemId: string
  title: string
  blocks: TextBlock[]
  query: string
  selectionContext: SelectionQuestionContext | null
}): AssistantCitation[] {
  const { knowledgeItemId, title, blocks, query, selectionContext } = params
  const tokens = tokenize(query)
  const candidateBlocks = blocks.filter(block => ['paragraph', 'title', 'subtitle', 'reference', 'list'].includes(block.type) && block.text.trim().length > 20)

  const scored = candidateBlocks.map(block => {
    const haystack = block.text.toLowerCase()
    const tokenScore = tokens.length === 0
      ? 0
      : tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0) / tokens.length
    const exactSelectionBoost = selectionContext?.blockId === block.id ? 2 : 0
    const quoteBoost = selectionContext?.text && haystack.includes(selectionContext.text.trim().toLowerCase()) ? 1.2 : 0
    const structureBoost = block.type === 'title' || block.type === 'subtitle' ? 0.2 : 0
    const score = tokenScore + exactSelectionBoost + quoteBoost + structureBoost

    return { block, score }
  })

  const prioritized = [...scored]
    .sort((left, right) => right.score - left.score)
    .filter(item => item.score > 0 || item.block.id === selectionContext?.blockId)
    .slice(0, 8)

  if (selectionContext?.blockId) {
    const selected = candidateBlocks.find(block => block.id === selectionContext.blockId)
    if (selected && !prioritized.some(item => item.block.id === selected.id)) {
      prioritized.unshift({ block: selected, score: 999 })
    }
  }

  return prioritized
    .slice(0, 8)
    .map((item, index) => ({
      id: `K${index + 1}`,
      knowledgeItemId,
      title,
      excerpt: item.block.text.slice(0, 420),
      sourceKind: 'fulltext' as const,
      score: item.score,
      blockId: item.block.id,
      pageNum: item.block.pageNum,
    }))
}

export default function ImmersiveChatPanel({
  knowledgeItemId,
  title,
  blocks,
  selectionContext,
  onCitationClick,
}: ImmersiveChatPanelProps) {
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeSelection, setActiveSelection] = useState<SelectionQuestionContext | null>(selectionContext)
  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!selectionContext) return
    setActiveSelection(selectionContext)
    setInputValue(current => {
      if (current.trim()) return current
      return '请解释我刚选中的这段内容，并结合上下文说明它在文中的作用。'
    })
  }, [selectionContext])

  const settings = useMemo(() => getSettings(), [])

  const handleSend = useCallback(async () => {
    if (isLoading) return

    const trimmed = inputValue.trim()
    if (!trimmed && !activeSelection) {
      return
    }

    const modelConfig = getSelectedLargeModel(settings)
    if (!modelConfig?.apiKey || !modelConfig?.modelName) {
      addToast({ title: '请先在设置中配置大模型', color: 'warning' })
      return
    }

    const fallbackPrompt = activeSelection
      ? '请解释我选中的这段内容，并结合全文上下文回答。'
      : ''
    const prompt = trimmed || fallbackPrompt
    const knowledgeCandidates = buildImmersiveCandidates({
      knowledgeItemId,
      title,
      blocks,
      query: `${prompt}\n${activeSelection?.text || ''}`,
      selectionContext: activeSelection,
    })

    if (knowledgeCandidates.length === 0) {
      addToast({ title: '当前文档里没有检索到可用段落证据', color: 'warning' })
      return
    }

    const userMessage: AssistantMessage = {
      id: generateId(),
      role: 'user',
      content: prompt,
      citations: knowledgeCandidates,
      createdAt: new Date().toISOString(),
    }

    const assistantMessage: AssistantMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      citations: knowledgeCandidates,
      createdAt: new Date().toISOString(),
    }

    const nextMessages = [...messages, userMessage, assistantMessage]
    setMessages(nextMessages)
    setInputValue('')
    setIsLoading(true)

    const systemPrompt = [
      `你是当前论文《${title}》的沉浸式阅读问答助手。`,
      '你只能基于给定证据回答，绝对不能编造段落或页码。',
      '你的每一段回答都必须带有 [K1] 这类引用标记，且整条回答至少引用 2 条证据。',
      '如果证据不足，直接说明“证据不足”，并说明缺少什么。',
      '回答末尾必须有“参考段落”小节，每行一个引用，格式为 [K1] 第X页｜摘录要点。',
      activeSelection?.text ? `用户当前选中的原文是：${activeSelection.text}` : '',
    ].filter(Boolean).join('\n')

    try {
      abortControllerRef.current = new AbortController()
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map(message => ({ role: message.role, content: message.content })),
          modelConfig,
          systemPrompt,
          useKnowledge: true,
          knowledgeCandidates,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error('AI 问答请求失败')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''

      const updateAssistant = (updater: (draft: AssistantMessage) => void) => {
        setMessages(prev => {
          const draft = [...prev]
          const target = draft.find(message => message.id === assistantMessage.id)
          if (!target) return prev
          updater(target)
          return draft
        })
      }

      const processLine = (line: string) => {
        if (!line.trim()) return

        const payload = JSON.parse(line) as {
          type: 'tool-status' | 'text-delta' | 'citations' | 'error' | 'done'
          delta?: string
          citations?: AssistantCitation[]
          error?: string
        }

        if (payload.type === 'citations' && Array.isArray(payload.citations)) {
          updateAssistant(draft => {
            draft.citations = payload.citations
          })
          return
        }

        if (payload.type === 'text-delta' && payload.delta) {
          fullContent += payload.delta
          updateAssistant(draft => {
            draft.content = fullContent
          })
          return
        }

        if (payload.type === 'error') {
          throw new Error(payload.error || 'AI 回答失败')
        }
      }

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          let lineBreakIndex = buffer.indexOf('\n')

          while (lineBreakIndex >= 0) {
            const line = buffer.slice(0, lineBreakIndex)
            buffer = buffer.slice(lineBreakIndex + 1)
            processLine(line)
            lineBreakIndex = buffer.indexOf('\n')
          }
        }

        if (buffer.trim()) {
          processLine(buffer)
        }
      }

      setActiveSelection(null)
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        addToast({ title: (error as Error).message || 'AI 问答失败', color: 'danger' })
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [activeSelection, blocks, inputValue, isLoading, knowledgeItemId, messages, settings, title])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsLoading(false)
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#333] px-3 py-3">
        <div>
          <h3 className="text-sm font-medium text-gray-200">AI 问答</h3>
          <p className="text-[11px] text-gray-500">仅基于当前论文段落作答，回答必须带可跳转引用。</p>
        </div>
        <Button
          isIconOnly
          size="sm"
          variant="light"
          className="text-gray-400"
          onPress={() => setMessages([])}
          isDisabled={messages.length === 0 || isLoading}
        >
          <Icon icon="mdi:delete-sweep-outline" className="text-base" />
        </Button>
      </div>

      {activeSelection && (
        <div className="mx-3 mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <Chip size="sm" variant="flat" className="text-[10px] h-5">P.{activeSelection.pageNum}</Chip>
            <button
              type="button"
              className="text-[11px] text-gray-400 transition-colors hover:text-white"
              onClick={() => setActiveSelection(null)}
            >
              清除
            </button>
          </div>
          <p className="text-xs leading-relaxed text-gray-300 line-clamp-4">{activeSelection.text}</p>
        </div>
      )}

      <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#333] px-4 py-6 text-center text-gray-500">
            <Icon icon="mdi:robot-outline" className="mx-auto mb-2 text-2xl text-gray-600" />
            <p className="text-sm">可以直接提问，也可以先框选一段文字再问 AI。</p>
          </div>
        ) : messages.map(message => (
          <div
            key={message.id}
            className={`rounded-2xl border px-3 py-3 ${message.role === 'assistant' ? 'border-[#333] bg-[#171717]' : 'border-[#294560] bg-[#122233]'}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className={`text-[11px] font-medium ${message.role === 'assistant' ? 'text-sky-300' : 'text-emerald-300'}`}>
                {message.role === 'assistant' ? 'AI 回答' : '我的问题'}
              </span>
              <span className="text-[10px] text-gray-500">{new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <div className="prose prose-invert prose-p:my-1 prose-ul:my-1 prose-li:my-0 max-w-none text-sm leading-6">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || (message.role === 'assistant' && isLoading ? '思考中…' : '')}</ReactMarkdown>
            </div>

            {message.citations && message.citations.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-gray-500">引用段落</p>
                {message.citations.map(citation => (
                  <button
                    key={`${message.id}-${citation.id}`}
                    type="button"
                    className="block w-full rounded-xl border border-[#333] bg-[#111] px-3 py-2 text-left transition-colors hover:border-sky-500/50 hover:bg-[#151b24]"
                    onClick={() => {
                      if (citation.blockId && citation.pageNum) {
                        onCitationClick?.({
                          blockId: citation.blockId,
                          pageNum: citation.pageNum,
                          title: citation.id,
                          note: citation.excerpt,
                        })
                      }
                    }}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-sky-300">{citation.id}</span>
                      {citation.pageNum && (
                        <Chip size="sm" variant="flat" className="text-[10px] h-5">P.{citation.pageNum}</Chip>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-gray-300 line-clamp-3">{citation.excerpt}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-[#333] p-3">
        <Textarea
          minRows={3}
          maxRows={8}
          value={inputValue}
          onValueChange={setInputValue}
          placeholder={activeSelection ? '围绕选中文本继续提问…' : '问一个关于当前论文的问题…'}
          classNames={{
            inputWrapper: 'bg-[#171717] border border-[#333] shadow-none',
            input: 'text-sm text-gray-200',
          }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void handleSend()
            }
          }}
        />

        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-gray-500">回答只会基于当前文档候选段落生成。</p>
          <div className="flex gap-2">
            {isLoading && (
              <Button size="sm" variant="light" className="text-gray-400" onPress={handleStop}>
                停止
              </Button>
            )}
            <Button size="sm" color="primary" onPress={() => void handleSend()} isLoading={isLoading}>
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}