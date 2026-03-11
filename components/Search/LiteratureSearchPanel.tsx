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

  return {
    id: `openalex-${openAlexShortId}`,
    title: paper.title,
    authors: paper.authors,
    abstract: paper.abstract,
    year: paper.year ? String(paper.year) : '',
    journal: paper.venue,
    doi: paper.doi,
    url: paper.url || `https://openalex.org/${openAlexShortId.toUpperCase()}`,
    sourceType: 'url',
    sourceId: paper.openAlexId,
    cachedSummary: paper.recommendationReason,
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
            <div
              key={step.id}
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
              <span
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
            </div>
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
          <section style={{ display: 'grid', gap: 10 }}>
            {thinking.map(bubble => (
              <motion.div
                key={bubble.id}
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '92%',
                  padding: '12px 14px',
                  borderRadius: '16px 16px 16px 6px',
                  background: 'linear-gradient(135deg, color-mix(in srgb, #0f172a 9%, white), color-mix(in srgb, var(--accent-color) 9%, white))',
                  border: '1px solid color-mix(in srgb, var(--accent-color) 18%, transparent)',
                  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.6 }}>
                  思考气泡 · {steps.find(step => step.id === bubble.stage)?.label || bubble.stage}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6 }}>{bubble.text}</div>
              </motion.div>
            ))}
          </section>
        )}

        {toolCalls.length > 0 && (
          <section
            style={{
              borderRadius: 16,
              border: '1px solid color-mix(in srgb, var(--border-color) 75%, transparent)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                background: 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border-color)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
                color: 'var(--text-muted)',
              }}
            >
              工具调用轨迹
            </div>
            <div style={{ display: 'grid' }}>
              {toolCalls.map(call => (
                <div
                  key={call.id}
                  style={{
                    padding: '11px 12px',
                    borderBottom: '1px solid color-mix(in srgb, var(--border-color) 55%, transparent)',
                    background: call.status === 'running'
                      ? 'color-mix(in srgb, #f59e0b 6%, white)'
                      : call.status === 'error'
                        ? 'color-mix(in srgb, #ef4444 5%, white)'
                        : 'white',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: call.status === 'completed'
                            ? 'var(--accent-color)'
                            : call.status === 'running'
                              ? '#f59e0b'
                              : '#ef4444',
                        }}
                      />
                      <span style={{ fontSize: 12, fontWeight: 700 }}>{call.name}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {call.resultCount !== undefined ? `${call.resultCount} 条` : call.status === 'running' ? '执行中' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.55 }}>
                    入参摘要：{call.inputSummary}
                  </div>
                  {call.note && (
                    <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>{call.note}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
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
              </div>
            </div>

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
            placeholder={questions.length > 0 ? '可继续补充限定条件，然后点“继续检索”' : '例如：帮我检索近五年关于 RAG 评测框架与 hallucination 缓解的高质量论文'}
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
              {isLoading && (
                <Button size="sm" color="danger" variant="flat" onPress={stopSearch}>
                  停止
                </Button>
              )}
              {canRestart && (
                <Button size="sm" variant="flat" onPress={() => void interruptAndRestart()}>
                  打断并重检
                </Button>
              )}
              <Button
                size="sm"
                color="primary"
                onPress={() => void startSearch()}
                isDisabled={!inputValue.trim() || (questions.length > 0 && !allQuestionsAnswered)}
              >
                {questions.length > 0 ? '继续检索' : '开始检索'}
              </Button>
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
