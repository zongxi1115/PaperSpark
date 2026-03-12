'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button, addToast } from '@heroui/react'
import {
  addKnowledgeItem,
  generateId,
  getModelById,
  getSelectedLargeModel,
  getSettings,
} from '@/lib/storage'
import type { AppSettings, KnowledgeItem } from '@/lib/types'
import type {
  ClarificationQuestion,
  LiteratureSearchEvent,
  LiteratureSearchResultPayload,
  LiteratureSearchStep,
  QueryExpansionGroup,
  SearchIntent,
  SearchPaper,
  StepStatus,
  ToolCallEvent,
  ThoughtBubble,
} from '@/lib/literatureSearchTypes'
import { LITERATURE_SEARCH_STEPS } from '@/lib/literatureSearchTypes'
import { ToolCallFeed } from './ToolCallFeed'

type AnswerState = Record<string, { value: string; customText: string }>

function upsertToolEvent(list: ToolCallEvent[], next: ToolCallEvent) {
  const index = list.findIndex(item => item.id === next.id)
  if (index < 0) return [next, ...list].slice(0, 24)

  const updated = [...list]
  updated[index] = next
  return updated
}

function updateStepState(steps: LiteratureSearchStep[], nextStep: LiteratureSearchStep): LiteratureSearchStep[] {
  return steps.map<LiteratureSearchStep>(step => {
    if (step.id === nextStep.id) {
      return nextStep
    }
    if (nextStep.status === 'in_progress' && step.status === 'in_progress') {
      return { ...step, status: 'completed' }
    }
    return step
  })
}

async function readSearchStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: LiteratureSearchEvent) => void,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    buffer = buffer.replace(/\r\n/g, '\n')

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      const data = rawEvent
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n')

      if (data) {
        onEvent(JSON.parse(data) as LiteratureSearchEvent)
      }

      boundary = buffer.indexOf('\n\n')
    }
  }
}

function createKnowledgeItemFromPaper(paper: SearchPaper): KnowledgeItem {
  const openAlexShortId = paper.openAlexId.split('/').pop()?.toLowerCase() || generateId()
  const safeFileBase = (paper.title || 'paper')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'paper'
  const pdfFileName = paper.pdfUrl ? `${safeFileBase}.pdf` : undefined

  return {
    id: `openalex-${openAlexShortId}`,
    title: paper.title,
    authors: paper.authors,
    abstract: paper.abstract || '',
    year: paper.year ? String(paper.year) : '',
    journal: paper.venue,
    doi: paper.doi,
    url: paper.url || `https://openalex.org/${openAlexShortId.toUpperCase()}`,
    sourceType: 'literature-search',
    sourceId: paper.openAlexId,
    fileName: pdfFileName,
    fileType: paper.pdfUrl ? 'pdf' : undefined,
    hasAttachment: Boolean(paper.pdfUrl),
    attachmentUrl: paper.pdfUrl,
    attachmentFileName: pdfFileName,
    itemType: '漫游搜索',
    tags: ['漫游搜索'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function dispatchCitationInsert(item: KnowledgeItem) {
  window.dispatchEvent(new CustomEvent('citation-insert', {
    detail: {
      citationId: item.id,
      title: item.title,
      authors: item.authors,
      year: item.year || '',
      journal: item.journal || '',
      doi: item.doi || '',
      url: item.url || '',
      bib: item.bib || '',
    },
  }))
}

export function LiteratureSearchPanel() {
  const reduceMotion = useReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const latestQueryRef = useRef('')
  const [settings, setSettings] = useState<AppSettings>(() => getSettings())
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [steps, setSteps] = useState<LiteratureSearchStep[]>(LITERATURE_SEARCH_STEPS)
  const [thinking, setThinking] = useState<ThoughtBubble[]>([])
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([])
  const [queryGroups, setQueryGroups] = useState<QueryExpansionGroup[]>([])
  const [intent, setIntent] = useState<SearchIntent | null>(null)
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([])
  const [answers, setAnswers] = useState<AnswerState>({})
  const [results, setResults] = useState<LiteratureSearchResultPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSettings(getSettings())
  }, [])

  useEffect(() => {
    const target = scrollRef.current
    if (!target) return
    target.scrollTo({ top: target.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [thinking, toolCalls.length, results, questions.length, reduceMotion])

  const modelLabel = useMemo(() => {
    const selected = getModelById(settings, settings.defaultLargeModelId)
    if (!selected) return '未配置大模型'
    return `${selected.provider.name} / ${selected.model.name}`
  }, [settings])

  const serializedAnswers = useMemo(() => {
    return Object.entries(answers)
      .filter(([, answer]) => answer.value)
      .map(([questionId, answer]) => ({
        questionId,
        value: answer.value,
        customText: answer.customText || undefined,
      }))
  }, [answers])

  const allQuestionsAnswered = useMemo(() => {
    if (questions.length === 0) return true
    return questions.every(question => {
      const answer = answers[question.id]
      if (!answer?.value) return false
      if (answer.value !== 'other') return true
      return Boolean(answer.customText.trim())
    })
  }, [answers, questions])

  function resetForRun() {
    setSteps(LITERATURE_SEARCH_STEPS)
    setThinking([])
    setToolCalls([])
    setQueryGroups([])
    setIntent(null)
    setQuestions([])
    setAnswers({})
    setResults(null)
    setError(null)
  }

  async function startSearch() {
    const query = inputValue.trim()
    if (!query) return

    const modelConfig = getSelectedLargeModel(getSettings())
    if (!modelConfig.apiKey) {
      addToast({ title: '请先在设置页配置大参数模型 API Key', color: 'warning' })
      return
    }

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    latestQueryRef.current = query
    setIsLoading(true)
    resetForRun()

    try {
      const response = await fetch('/api/ai/literature-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          answers: serializedAnswers,
          modelConfig,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || '检索请求失败')
      }

      if (!response.body) {
        throw new Error('检索流为空')
      }

      await readSearchStream(response.body, event => {
        switch (event.type) {
          case 'session':
            setSteps(event.steps)
            break
          case 'stage':
            setSteps(current => {
              const nextStep: LiteratureSearchStep = {
                id: event.stage,
                label: current.find(step => step.id === event.stage)?.label || event.stage,
                status: event.status as StepStatus,
              }
              return updateStepState(current, nextStep)
            })
            break
          case 'thinking':
            setThinking(current => [...current.slice(-9), event.bubble])
            break
          case 'strategy':
            if (event.intent) setIntent(event.intent)
            if (event.queryGroups) setQueryGroups(event.queryGroups)
            break
          case 'clarification':
            setIntent(event.intent)
            setQuestions(event.questions)
            break
          case 'tool':
            setToolCalls(current => upsertToolEvent(current, event.tool))
            break
          case 'results':
            setResults(event.payload)
            setQuestions([])
            break
          case 'error':
            setError(event.message)
            addToast({ title: event.message, color: 'danger' })
            break
          case 'done':
            setIsLoading(false)
            break
        }
      })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const message = err instanceof Error ? err.message : '检索失败'
        setError(message)
        addToast({ title: message, color: 'danger' })
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  function stopSearch() {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsLoading(false)
  }

  async function interruptAndRestart() {
    stopSearch()
    window.setTimeout(() => {
      void startSearch()
    }, 100)
  }

  function savePaper(paper: SearchPaper) {
    const item = createKnowledgeItemFromPaper(paper)
    addKnowledgeItem(item)
    addToast({ title: '已保存到知识库', color: 'success' })
    return item
  }

  function insertPaperCitation(paper: SearchPaper) {
    const item = savePaper(paper)
    dispatchCitationInsert(item)
    addToast({ title: '已插入引用', color: 'success' })
  }

  const canRestart = isLoading && inputValue.trim() && inputValue.trim() !== latestQueryRef.current

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-primary) 86%, #f5f7fb 14%) 0%, var(--bg-primary) 100%)',
      }}
    >
      <div
        style={{
          padding: '14px 14px 12px',
          borderBottom: '1px solid color-mix(in srgb, var(--border-color) 76%, transparent)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.86))',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 0.2 }}>论文智能检索</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              基于 OpenAlex 与多智能体编排的学术资料漫游
            </div>
          </div>
          <div
            style={{
              padding: '6px 8px',
              borderRadius: 10,
              background: 'color-mix(in srgb, var(--accent-color) 10%, white)',
              color: 'color-mix(in srgb, var(--accent-color) 80%, black)',
              fontSize: 11,
              fontWeight: 600,
              maxWidth: 150,
              textAlign: 'right',
            }}
          >
            {modelLabel}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          {steps.map(step => (
            <motion.div
              key={step.id}
              animate={step.status === 'in_progress' && !reduceMotion ? {
                opacity: [0.7, 1, 0.7],
              } : undefined}
              transition={step.status === 'in_progress' ? {
                duration: 1.6,
                repeat: Infinity,
                ease: 'easeInOut',
              } : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 10px',
                borderRadius: 999,
                fontSize: 11,
                border: `1px solid ${step.status === 'completed'
                  ? 'color-mix(in srgb, var(--accent-color) 45%, transparent)'
                  : step.status === 'in_progress'
                    ? 'color-mix(in srgb, #f59e0b 55%, transparent)'
                    : 'var(--border-color)'}`,
                background: step.status === 'completed'
                  ? 'color-mix(in srgb, var(--accent-color) 9%, white)'
                  : step.status === 'in_progress'
                    ? 'color-mix(in srgb, #f59e0b 10%, white)'
                    : 'var(--bg-secondary)',
                color: step.status === 'pending' ? 'var(--text-muted)' : 'var(--text-primary)',
              }}
            >
              <motion.span
                animate={step.status === 'in_progress' && !reduceMotion ? {
                  scale: [1, 1.2, 1],
                  opacity: [0.8, 1, 0.8],
                } : undefined}
                transition={step.status === 'in_progress' ? {
                  duration: 1.2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                } : undefined}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: step.status === 'completed'
                    ? 'var(--accent-color)'
                    : step.status === 'in_progress'
                      ? '#f59e0b'
                      : step.status === 'error'
                        ? '#ef4444'
                        : step.status === 'waiting'
                          ? '#8b5cf6'
                          : 'var(--text-muted)',
                  boxShadow: step.status === 'in_progress' ? '0 0 0 4px rgba(245, 158, 11, 0.12)' : 'none',
                }}
              />
              {step.label}
            </motion.div>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 14px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {intent && (
          <section
            style={{
              padding: 14,
              borderRadius: 16,
              border: '1px solid color-mix(in srgb, var(--border-color) 72%, transparent)',
              background: 'linear-gradient(180deg, rgba(248,250,252,0.92), rgba(255,255,255,0.96))',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.6 }}>
              检索意图
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, lineHeight: 1.5 }}>
              {intent.researchGoal || intent.clarifiedQuery}
            </div>
            {(intent.coreConcepts.length > 0 || intent.relatedFields.length > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {intent.coreConcepts.map(concept => (
                  <span
                    key={concept}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      background: 'var(--accent-light)',
                      color: 'var(--accent-color)',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                  >
                    {concept}
                  </span>
                ))}
                {intent.relatedFields.map(field => (
                  <span
                    key={field}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 999,
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                      fontSize: 11,
                    }}
                  >
                    {field}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {queryGroups.length > 0 && (
          <section style={{ display: 'grid', gap: 10 }}>
            {queryGroups.map(group => (
              <div
                key={group.id}
                style={{
                  padding: '12px 13px',
                  borderRadius: 14,
                  border: '1px solid color-mix(in srgb, var(--border-color) 75%, transparent)',
                  background: 'color-mix(in srgb, var(--bg-secondary) 82%, white)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{group.label}</div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{group.focus}</span>
                </div>
                <div style={{ fontSize: 12, marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {group.query}
                </div>
              </div>
            ))}
          </section>
        )}

        {thinking.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '6px 8px',
              borderRadius: 10,
              background: 'rgba(15, 23, 42, 0.015)',
              border: '1px solid rgba(15, 23, 42, 0.04)',
            }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {thinking.slice(-3).map((bubble, index) => {
                const isLatest = index === thinking.slice(-3).length - 1
                return (
                  <motion.div
                    key={bubble.id}
                    layout
                    initial={reduceMotion ? false : { opacity: 0, y: 12, filter: 'blur(4px)' }}
                    animate={reduceMotion ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '4px 10px',
                      borderRadius: 6,
                      background: 'transparent',
                    }}
                  >
                    <motion.div
                      animate={isLatest && !reduceMotion ? { opacity: [0.5, 1, 0.5] } : undefined}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                      style={{
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 2,
                      }}
                    >
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ opacity: 0.5 }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
                      </svg>
                    </motion.div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(15, 23, 42, 0.45)' }}>
                        {steps.find(step => step.id === bubble.stage)?.label || bubble.stage}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: 'rgba(15, 23, 42, 0.65)', marginTop: 2 }}>
                        {bubble.text}
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
            {thinking.length > 3 && (
              <div style={{ fontSize: 11, color: 'rgba(15, 23, 42, 0.35)', paddingLeft: 10 }}>
                +{thinking.length - 3} 条历史思考
              </div>
            )}
          </div>
        )}

        {toolCalls.length > 0 && (
          <ToolCallFeed
            calls={toolCalls}
            isLoading={isLoading}
            reduceMotion={reduceMotion}
          />
        )}

        {results && (
          <section style={{ display: 'grid', gap: 12 }}>
            <div
              style={{
                padding: 14,
                borderRadius: 16,
                background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-color) 8%, white), color-mix(in srgb, #0f172a 3%, white))',
                border: '1px solid color-mix(in srgb, var(--accent-color) 16%, transparent)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.6 }}>
                检索结论
              </div>
              <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.7 }}>
                {results.summary}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <MetricPill label="候选文献" value={String(results.totalCandidates)} />
                <MetricPill label="去重数量" value={String(results.duplicatesRemoved)} />
                <MetricPill label="最终推荐" value={String(results.papers.length)} />
                {results.retryCount > 0 && (
                  <MetricPill label="自动重检" value={String(results.retryCount)} />
                )}
              </div>

              {(results.retryCount > 0 || results.reviewNotes.length > 0) && (
                <div
                  style={{
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.72)',
                    border: '1px solid color-mix(in srgb, var(--border-color) 72%, transparent)',
                    display: 'grid',
                    gap: 6,
                  }}
                >
                  {results.retryCount > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      系统已根据候选质量自动重检 {results.retryCount} 次。
                    </div>
                  )}
                  {results.reviewNotes.map(note => (
                    <div
                      key={note}
                      style={{
                        fontSize: 11,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.6,
                        wordBreak: 'break-word',
                      }}
                    >
                      {note}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {results.papers.length === 0 && (
              <div
                style={{
                  padding: 14,
                  borderRadius: 18,
                  border: '1px solid color-mix(in srgb, var(--border-color) 78%, transparent)',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.92))',
                  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.06)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>当前仍未形成可推荐文献列表</div>
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  系统已经执行自动重检。你可以进一步补充研究对象、方法、应用场景或时间窗口，让下一轮检索更聚焦。
                </div>
              </div>
            )}

            {results.papers.map((paper, index) => (
              <motion.article
                key={paper.openAlexId}
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                transition={{ delay: reduceMotion ? 0 : Math.min(index * 0.04, 0.2) }}
                style={{
                  padding: 14,
                  borderRadius: 18,
                  border: '1px solid color-mix(in srgb, var(--border-color) 78%, transparent)',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.92))',
                  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.06)',
                }}
              >
                <PaperCard paper={paper} onSave={savePaper} onInsert={insertPaperCitation} />
              </motion.article>
            ))}
          </section>
        )}

        {!results && !isLoading && !error && questions.length === 0 && (
          <div
            style={{
              margin: 'auto 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              padding: '24px 8px 32px',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>
              从研究问题开始
            </div>
            <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.7 }}>
              输入问题后，系统会先理解意图，再自动扩展关键词、并行检索、滚雪球扩展并输出推荐文献。
            </div>
          </div>
        )}

        {error && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 14,
              background: 'color-mix(in srgb, #ef4444 8%, white)',
              color: '#b91c1c',
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div
        style={{
          position: 'relative',
          padding: '12px 12px 14px',
          borderTop: '1px solid color-mix(in srgb, var(--border-color) 80%, transparent)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.88), rgba(255,255,255,0.98))',
          backdropFilter: 'blur(12px)',
        }}
      >
        <AnimatePresence>
          {questions.length > 0 && (
            <ClarificationPanel
              questions={questions}
              answers={answers}
              setAnswers={setAnswers}
              canSubmit={allQuestionsAnswered}
              isLoading={isLoading}
              onSubmit={() => void startSearch()}
              reduceMotion={reduceMotion}
            />
          )}
        </AnimatePresence>

        <div
          style={{
            position: 'relative',
            borderRadius: 18,
            border: '1px solid color-mix(in srgb, var(--border-color) 80%, transparent)',
            background: 'linear-gradient(180deg, rgba(248,250,252,0.98), rgba(255,255,255,0.98))',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
          }}
        >
          <textarea
            value={inputValue}
            onChange={event => setInputValue(event.target.value)}
            placeholder={questions.length > 0 ? '补充限定条件...' : '输入研究问题，如：RAG 评测框架相关论文'}
            style={{
              width: '100%',
              minHeight: 90,
              maxHeight: 180,
              resize: 'vertical',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              padding: '14px 14px 56px',
              fontSize: 13,
              lineHeight: 1.65,
              color: 'var(--text-primary)',
            }}
          />

          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 10,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {questions.length > 0
                ? '回答后会重新规划整轮检索'
                : isLoading
                  ? '正在流式推进检索阶段'
                  : '支持中途停止并补充说明后重新规划'}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {isLoading ? (
                <>
                  <Button size="sm" color="danger" variant="flat" onPress={stopSearch}>
                    停止
                  </Button>
                  {canRestart && (
                    <Button size="sm" variant="flat" onPress={() => void interruptAndRestart()}>
                      打断并重检
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  color="primary"
                  onPress={() => void startSearch()}
                  isDisabled={!inputValue.trim() || (questions.length > 0 && !allQuestionsAnswered)}
                >
                  {questions.length > 0 ? '继续检索' : '开始检索'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 8px',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.7)',
        fontSize: 11,
        color: 'var(--text-secondary)',
      }}
    >
      <strong style={{ color: 'var(--text-primary)' }}>{value}</strong>
      {label}
    </span>
  )
}

function PaperBadge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'neutral' }) {
  return (
    <span
      style={{
        padding: '4px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: tone === 'success'
          ? 'color-mix(in srgb, #10b981 12%, white)'
          : 'var(--bg-secondary)',
        color: tone === 'success'
          ? '#047857'
          : 'var(--text-secondary)',
      }}
    >
      {children}
    </span>
  )
}

function PaperCard({
  paper,
  onSave,
  onInsert,
}: {
  paper: SearchPaper
  onSave: (paper: SearchPaper) => void
  onInsert: (paper: SearchPaper) => void
}) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <a
            href={paper.url || `https://openalex.org/${paper.openAlexId.split('/').pop()}`}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 15,
              fontWeight: 700,
              lineHeight: 1.45,
              color: 'var(--text-primary)',
              textDecoration: 'none',
            }}
          >
            {paper.title}
          </a>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.55 }}>
            {paper.authors.slice(0, 4).join(', ') || '未知作者'}
            {paper.year ? ` · ${paper.year}` : ''}
            {paper.venue ? ` · ${paper.venue}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <PaperBadge tone="neutral">被引 {paper.citedByCount}</PaperBadge>
          <PaperBadge tone={paper.isOpenAccess ? 'success' : 'neutral'}>
            {paper.isOpenAccess ? `OA · ${paper.oaStatus || '开放'}` : '闭源'}
          </PaperBadge>
        </div>
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-secondary)', marginTop: 10 }}>
        {paper.abstractSnippet}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          borderRadius: 14,
          background: 'color-mix(in srgb, var(--accent-color) 7%, white)',
          color: 'var(--text-primary)',
          fontSize: 12,
          lineHeight: 1.6,
        }}
      >
        推荐理由：{paper.recommendationReason}
      </div>

      {(paper.matchedQueries.length > 0 || paper.matchedConcepts.length > 0) && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {paper.matchedQueries.slice(0, 3).map(item => (
            <span
              key={item}
              style={{
                fontSize: 10,
                padding: '4px 7px',
                borderRadius: 999,
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
              }}
            >
              {item}
            </span>
          ))}
          {paper.matchedConcepts.slice(0, 3).map(item => (
            <span
              key={item}
              style={{
                fontSize: 10,
                padding: '4px 7px',
                borderRadius: 999,
                background: 'color-mix(in srgb, var(--accent-color) 10%, white)',
                color: 'var(--accent-color)',
              }}
            >
              {item}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button size="sm" variant="flat" color="primary" onPress={() => onSave(paper)}>
          保存到知识库
        </Button>
        <Button size="sm" variant="flat" onPress={() => onInsert(paper)}>
          插入引用
        </Button>
        {paper.pdfUrl && (
          <Button
            as="a"
            href={paper.pdfUrl}
            target="_blank"
            rel="noreferrer"
            size="sm"
            variant="light"
          >
            打开 PDF
          </Button>
        )}
      </div>
    </>
  )
}

function ClarificationPanel({
  questions,
  answers,
  setAnswers,
  canSubmit,
  isLoading,
  onSubmit,
  reduceMotion,
}: {
  questions: ClarificationQuestion[]
  answers: AnswerState
  setAnswers: React.Dispatch<React.SetStateAction<AnswerState>>
  canSubmit: boolean
  isLoading: boolean
  onSubmit: () => void
  reduceMotion: boolean | null
}) {
  const answeredCount = questions.filter(question => {
    const answer = answers[question.id]
    if (!answer?.value) return false
    if (answer.value !== 'other') return true
    return Boolean(answer.customText.trim())
  }).length

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 14 }}
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 'calc(100% + 10px)',
        borderRadius: 18,
        border: '1px solid color-mix(in srgb, #8b5cf6 22%, var(--border-color))',
        background: 'linear-gradient(180deg, color-mix(in srgb, #8b5cf6 7%, white), white)',
        boxShadow: '0 18px 36px rgba(15, 23, 42, 0.12)',
        padding: 14,
        display: 'grid',
        gap: 12,
        maxHeight: 340,
        overflowY: 'auto',
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#6d28d9' }}>答题器</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.6 }}>
          当前问题仍偏宽。先补充几个约束，系统会据此重新规划检索策略。
        </div>
      </div>

      {questions.map(question => {
        const answer = answers[question.id] || { value: '', customText: '' }
        return (
          <div
            key={question.id}
            style={{
              padding: 12,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.86)',
              border: '1px solid color-mix(in srgb, var(--border-color) 70%, transparent)',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.55 }}>{question.prompt}</div>
            <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
              {question.options.map(option => {
                const selected = answer.value === option.value
                return (
                  <label
                    key={option.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      padding: '9px 10px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      border: `1px solid ${selected ? 'color-mix(in srgb, #8b5cf6 38%, transparent)' : 'var(--border-color)'}`,
                      background: selected
                        ? 'color-mix(in srgb, #8b5cf6 9%, white)'
                        : 'white',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="radio"
                        name={question.id}
                        checked={selected}
                        onChange={() => {
                          setAnswers(current => ({
                            ...current,
                            [question.id]: {
                              value: option.value,
                              customText: option.isOther ? current[question.id]?.customText || '' : '',
                            },
                          }))
                        }}
                      />
                      <span style={{ fontSize: 12 }}>{option.label}</span>
                    </span>

                    {option.isOther && selected && (
                      <input
                        value={answer.customText}
                        onChange={event => {
                          const value = event.target.value
                          setAnswers(current => ({
                            ...current,
                            [question.id]: {
                              value: option.value,
                              customText: value,
                            },
                          }))
                        }}
                        placeholder="补充你的自定义说明"
                        style={{
                          width: '100%',
                          border: '1px solid var(--border-color)',
                          borderRadius: 10,
                          padding: '8px 10px',
                          fontSize: 12,
                          outline: 'none',
                          background: 'rgba(255,255,255,0.9)',
                        }}
                      />
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          marginTop: 4,
          paddingTop: 10,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.82), rgba(255,255,255,0.98))',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
          已完成 {answeredCount}/{questions.length} 题
        </div>
        <Button
          size="sm"
          color="primary"
          onPress={onSubmit}
          isLoading={isLoading}
          isDisabled={!canSubmit}
        >
          提交并继续检索
        </Button>
      </div>
    </motion.div>
  )
}
