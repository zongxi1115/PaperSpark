'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { addToast } from '@heroui/react'
import { cn } from '@/lib/utils'
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
import { AnimatedShinyText } from '@/components/ui/AnimatedShinyText'
import { AnimatedStepper, CompactProgressStrip, type Step as StepperStep } from '@/components/ui/animated-stepper'
import { AnimatedCounter } from '@/components/ui/animated-counter'
import {
  ChainOfThought,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
} from '@/components/ui/chain-of-thought'

type AnswerState = Record<string, { value: string; customText: string }>

interface LiteratureSearchPanelProps {
  layoutMode?: 'sidebar' | 'fullscreen'
}

const PANEL_MAX_WIDTH = 760
const SUGGESTED_RESEARCH_PROMPTS = [
  'RAG 评测框架相关论文',
  '多智能体系统在学术检索中的应用',
  '医学知识图谱问答评估方法',
]

function formatToolLabel(name: ToolCallEvent['name']) {
  const labels: Record<ToolCallEvent['name'], string> = {
    searchWorks: '搜索文献',
    getConceptTree: '获取概念树',
    getRelatedWorks: '关联文献',
    filterWorks: '筛选结果',
    getAuthorWorks: '作者作品',
    rankAndDeduplicate: '重排去重',
  }

  return labels[name] || name
}

function formatToolStatus(call: ToolCallEvent) {
  if (call.status === 'error') return '失败'
  if (call.resultCount !== undefined) return `结果 ${call.resultCount}`
  return call.status === 'running' ? '执行中' : '完成'
}

function formatOpenAlexId(value: unknown) {
  if (typeof value !== 'string' || value.length === 0) return ''
  const tail = value.split('/').pop() || value
  return tail.length > 14 ? `${tail.slice(0, 14)}...` : tail
}

function formatDirection(value: unknown) {
  const map: Record<string, string> = {
    references: '参考文献',
    citations: '被引文献',
    related: '相关文献',
  }
  return typeof value === 'string' ? (map[value] || value) : ''
}

function formatSourceTypes(value: unknown) {
  if (!Array.isArray(value)) return ''
  if (value.length === 0) return ''
  return value.map(item => {
    if (item === 'journal') return '期刊'
    if (item === 'conference') return '会议'
    if (item === 'repository') return '仓库'
    return String(item)
  }).join(' / ')
}

function parseToolInputSummary(name: ToolCallEvent['name'], inputSummary: string) {
  try {
    const parsed = JSON.parse(inputSummary) as Record<string, unknown>

    if (name === 'searchWorks') {
      const filters = (parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {}) as Record<string, unknown>
      const details = [
        typeof parsed.query === 'string' ? parsed.query : '',
        filters.fromYear || filters.toYear ? `年份 ${filters.fromYear || '?'} - ${filters.toYear || '?'}` : '',
        typeof filters.minCitations === 'number' ? `最低引用 ${filters.minCitations}` : '',
        typeof filters.maxResults === 'number' ? `上限 ${filters.maxResults}` : '',
        typeof filters.sortBy === 'string' ? `排序 ${filters.sortBy}` : '',
        formatSourceTypes(filters.sourceTypes) ? `来源 ${formatSourceTypes(filters.sourceTypes)}` : '',
      ].filter(Boolean)
      return details
    }

    if (name === 'getRelatedWorks') {
      return [
        formatOpenAlexId(parsed.workId) ? `文献 ${formatOpenAlexId(parsed.workId)}` : '',
        formatDirection(parsed.direction) ? `方向 ${formatDirection(parsed.direction)}` : '',
        typeof parsed.limit === 'number' ? `上限 ${parsed.limit}` : '',
      ].filter(Boolean)
    }

    if (name === 'getConceptTree') {
      return [typeof parsed.conceptName === 'string' ? `概念 ${parsed.conceptName}` : ''].filter(Boolean)
    }

    if (name === 'filterWorks') {
      const criteria = (parsed.criteria && typeof parsed.criteria === 'object' ? parsed.criteria : {}) as Record<string, unknown>
      return [
        Array.isArray(parsed.workIds) ? `候选 ${parsed.workIds.length}` : '',
        criteria.fromYear || criteria.toYear ? `年份 ${criteria.fromYear || '?'} - ${criteria.toYear || '?'}` : '',
        typeof criteria.minCitations === 'number' ? `最低引用 ${criteria.minCitations}` : '',
        typeof criteria.openAccessOnly === 'boolean' ? (criteria.openAccessOnly ? '仅开放获取' : '不限开放获取') : '',
      ].filter(Boolean)
    }

    if (name === 'rankAndDeduplicate') {
      return [
        typeof parsed.workCount === 'number' ? `候选 ${parsed.workCount}` : '',
        typeof parsed.groupCount === 'number' ? `检索组 ${parsed.groupCount}` : '',
      ].filter(Boolean)
    }

    if (name === 'getAuthorWorks') {
      return [
        formatOpenAlexId(parsed.authorId) ? `作者 ${formatOpenAlexId(parsed.authorId)}` : '',
        typeof parsed.fromYear === 'number' ? `起始年份 ${parsed.fromYear}` : '',
        typeof parsed.limit === 'number' ? `上限 ${parsed.limit}` : '',
      ].filter(Boolean)
    }

    return Object.entries(parsed)
      .map(([key, value]) => `${key} ${Array.isArray(value) ? value.length : String(value)}`)
      .slice(0, 4)
  } catch {
    return inputSummary ? [inputSummary] : []
  }
}

function isNumericLikeValue(value: string | number) {
  return typeof value === 'number' || /^\d+$/.test(String(value))
}

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

export function LiteratureSearchPanel({ layoutMode = 'sidebar' }: LiteratureSearchPanelProps) {
  const reduceMotion = useReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const latestQueryRef = useRef('')
  const eventSequenceRef = useRef(0) // Track event arrival order
  const [settings, setSettings] = useState<AppSettings>(() => getSettings())
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [steps, setSteps] = useState<LiteratureSearchStep[]>(LITERATURE_SEARCH_STEPS)
  
  // Unified timeline with sequence numbers
  type TimelineEvent = 
    | { seq: number; type: 'thought'; data: ThoughtBubble }
    | { seq: number; type: 'tool'; data: ToolCallEvent }
    | { seq: number; type: 'queryGroup'; data: QueryExpansionGroup }
  
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [intent, setIntent] = useState<SearchIntent | null>(null)
  const [questions, setQuestions] = useState<ClarificationQuestion[]>([])
  const [answers, setAnswers] = useState<AnswerState>({})
  const [results, setResults] = useState<LiteratureSearchResultPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Extract data for backward compatibility
  const thinking = useMemo(() => 
    timeline.filter(e => e.type === 'thought').map(e => e.data as ThoughtBubble),
    [timeline]
  )
  const toolCalls = useMemo(() => 
    timeline.filter(e => e.type === 'tool').map(e => e.data as ToolCallEvent),
    [timeline]
  )
  const queryGroups = useMemo(() => 
    timeline.filter(e => e.type === 'queryGroup').map(e => e.data as QueryExpansionGroup),
    [timeline]
  )

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
    setTimeline([])
    eventSequenceRef.current = 0
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
            setTimeline(current => [...current, { seq: eventSequenceRef.current++, type: 'thought', data: event.bubble }])
            break
          case 'strategy':
            if (event.intent) setIntent(event.intent)
            if (event.queryGroups) {
              // Add each query group as separate timeline events
              event.queryGroups.forEach(group => {
                setTimeline(current => [...current, { seq: eventSequenceRef.current++, type: 'queryGroup', data: group }])
              })
            }
            break
          case 'clarification':
            setIntent(event.intent)
            setQuestions(event.questions)
            break
          case 'tool':
            setTimeline(current => {
              const existing = current.findIndex(e => e.type === 'tool' && (e.data as ToolCallEvent).id === event.tool.id)
              if (existing >= 0) {
                // Update existing tool call in place
                const updated = [...current]
                updated[existing] = { seq: updated[existing].seq, type: 'tool', data: event.tool }
                return updated
              } else {
                // Add new tool call
                return [...current, { seq: eventSequenceRef.current++, type: 'tool', data: event.tool }]
              }
            })
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
  const isFullscreenLayout = layoutMode === 'fullscreen'
  const completedStepCount = steps.filter(step => step.status === 'completed').length
  const activeStep = steps.find(step => step.status === 'in_progress') ?? null
  const progressPercent = steps.length === 0
    ? 0
    : Math.round(((completedStepCount + (activeStep ? 0.5 : 0)) / steps.length) * 100)
  const hasProcessActivity = thinking.length > 0 || toolCalls.length > 0

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      if (isLoading) return
      if (!inputValue.trim()) return
      if (questions.length > 0 && !allQuestionsAnswered) return
      void startSearch()
    }
  }

  const feed = (
    <div ref={scrollRef} className={`flex-1 overflow-y-auto ${isFullscreenLayout ? 'p-6 pb-40' : 'p-5 pb-36'}`}>
      <div className={`mx-auto flex w-full flex-col ${isFullscreenLayout ? 'max-w-3xl gap-10' : 'max-w-full gap-8'}`}>
        {intent && <IntentSummaryCard intent={intent} />}

        {queryGroups.length > 0 && <QueryPlanCard groups={queryGroups} />}

        {hasProcessActivity && (
          <ProcessLogCard
            thinking={thinking}
            toolCalls={toolCalls}
            steps={steps}
            queryGroups={queryGroups}
            results={results}
            isLoading={isLoading}
            reduceMotion={reduceMotion}
            timeline={timeline}
          />
        )}

        {results && (
          <section className="grid gap-4">
            <div className="flex flex-col gap-4 rounded-xl border border-blue-100 bg-blue-50/30 p-6 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.5)] dark:border-blue-900 dark:bg-blue-950/30 dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.05)]">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">
                <InsightIcon />
                <span>检索结论</span>
              </div>
              <p className="leading-relaxed text-gray-800 dark:text-gray-200">{results.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <MetricPill label="候选文献" value={String(results.totalCandidates)} />
                <MetricPill label="去重" value={String(results.duplicatesRemoved)} />
                <MetricPill label="最终推荐" value={String(results.papers.length)} tone="accent" />
                {results.retryCount > 0 && <MetricPill label="自动重检" value={String(results.retryCount)} />}
              </div>
            </div>

            {results.papers.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
                当前仍未形成可推荐文献列表。你可以进一步补充研究对象、方法、应用场景或时间窗口，让下一轮检索更聚焦。
              </div>
            )}

            {results.papers.map((paper, index) => (
              <motion.article
                key={paper.openAlexId}
                initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.98 }}
                animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: reduceMotion ? 0 : Math.min(index * 0.04, 0.2), type: 'spring', stiffness: 260, damping: 22 }}
              >
                <PaperCard paper={paper} onSave={savePaper} onInsert={insertPaperCitation} />
              </motion.article>
            ))}
          </section>
        )}

        {!results && !isLoading && !error && questions.length === 0 && (
          <EmptySearchState onPickPrompt={setInputValue} />
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-600 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
            {error}
          </div>
        )}
      </div>
    </div>
  )

  const composer = (
    <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent dark:from-gray-950 dark:via-gray-950 ${isFullscreenLayout ? 'px-6 pb-6 pt-20' : 'px-4 pb-4 pt-16'} pointer-events-none`}>
      <div className={`relative mx-auto w-full ${isFullscreenLayout ? 'max-w-3xl' : 'max-w-full'} pointer-events-auto`}>
        <AnimatePresence>
          {questions.length > 0 && (
            <ClarificationPanel
              questions={questions}
              answers={answers}
              setAnswers={setAnswers}
              canSubmit={allQuestionsAnswered}
              isLoading={isLoading}
              onSubmit={() => void startSearch()}
              onSkip={() => {
                setQuestions([])
                setAnswers({})
                void startSearch()
              }}
              reduceMotion={reduceMotion}
            />
          )}
        </AnimatePresence>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!inputValue.trim()) return
            if (questions.length > 0 && !allQuestionsAnswered) return
            if (isLoading) return
            void startSearch()
          }}
          className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-[0_2px_10px_rgb(0,0,0,0.04)] transition-shadow focus-within:border-gray-300 focus-within:shadow-[0_4px_20px_rgb(0,0,0,0.08)] dark:border-gray-700 dark:bg-gray-900 dark:shadow-[0_2px_10px_rgb(0,0,0,0.2)] dark:focus-within:border-gray-600 dark:focus-within:shadow-[0_4px_20px_rgb(0,0,0,0.3)]"
        >
          <div className="flex flex-1 items-center px-4">
            <input
              type="text"
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={questions.length > 0 ? '补充限定条件...' : '输入研究问题，如：RAG 评测框架相关论文'}
              className="w-full border-none bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-gray-500"
            />
          </div>

          <div className="flex shrink-0 items-center gap-3 pr-2">
            <AnimatePresence mode="wait">
              <motion.span
                key={questions.length > 0 ? 'clarify' : isLoading ? 'loading' : 'idle'}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-xs font-medium text-gray-400 dark:text-gray-500"
              >
                {questions.length > 0 ? '等待补充说明' : isLoading ? '正在检索中...' : '等待输入'}
              </motion.span>
            </AnimatePresence>

            {isLoading ? (
              <>
                <button
                  type="button"
                  onClick={stopSearch}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  aria-label="停止检索"
                >
                  <StopIcon />
                </button>
                {canRestart && (
                  <button
                    type="button"
                    onClick={() => void interruptAndRestart()}
                    className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    打断并重检
                  </button>
                )}
              </>
            ) : (
              <button
                type="submit"
                disabled={!inputValue.trim() || (questions.length > 0 && !allQuestionsAnswered)}
                className="flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-gray-200"
              >
                发送
                <SendIcon />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )

  const compactHeader = (
    <div className="shrink-0 border-b border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight text-black dark:text-white">论文智能检索</h1>
        </div>
        <ModelBadge modelLabel={modelLabel} isLoading={isLoading} hasResults={!!results} />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500">检索进度</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {questions.length > 0
              ? '等待补充条件'
              : activeStep
                ? `当前：${activeStep.label}`
                : results
                  ? '已完成'
                  : '待开始'}
          </span>
        </div>
        <HorizontalProgressStrip steps={steps} reduceMotion={reduceMotion} />
        <div className="flex flex-wrap gap-2">
          <MetricPill label="完成" value={`${completedStepCount}/${steps.length}`} />
          <MetricPill label="进度" value={`${progressPercent}%`} />
          {results && <MetricPill label="推荐" value={String(results.papers.length)} />}
        </div>
      </div>
    </div>
  )

  const fullscreenSidebar = (
    <aside className="flex w-64 shrink-0 flex-col gap-8 border-r border-gray-200 bg-gray-50/50 p-6 dark:border-gray-800 dark:bg-gray-900/50">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-bold tracking-tight text-black dark:text-white">论文智能检索</h1>
        <ModelBadge modelLabel={modelLabel} isLoading={isLoading} hasResults={!!results} />
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">检索进度</h2>
        <StepProgressRail steps={steps} reduceMotion={reduceMotion} />
        <div className="flex flex-wrap gap-2">
          <MetricPill label="完成" value={`${completedStepCount}/${steps.length}`} />
          <MetricPill label="进度" value={`${progressPercent}%`} />
          {results && <MetricPill label="推荐" value={String(results.papers.length)} />}
        </div>
      </div>
    </aside>
  )

  if (isFullscreenLayout) {
    return (
      <div className="flex h-full bg-white text-black font-sans selection:bg-purple-200 selection:text-purple-900 dark:bg-gray-950 dark:text-white dark:selection:bg-purple-900 dark:selection:text-purple-100">
        {fullscreenSidebar}
        <main className="relative flex min-w-0 flex-1 overflow-hidden">
          {feed}
          {composer}
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-white text-black font-sans selection:bg-purple-200 selection:text-purple-900 dark:bg-gray-950 dark:text-white dark:selection:bg-purple-900 dark:selection:text-purple-100">
      {compactHeader}
      {feed}
      {composer}
    </div>
  )
}

function StepProgressRail({
  steps,
}: {
  steps: LiteratureSearchStep[]
  reduceMotion?: boolean | null
}) {
  const stepperSteps: StepperStep[] = steps.map(step => ({
    id: step.id,
    label: step.label,
    status: step.status,
  }))

  return (
    <AnimatedStepper
      steps={stepperSteps}
      variant="vertical"
      showProgressLine={true}
    />
  )
}

function HorizontalProgressStrip({
  steps,
}: {
  steps: LiteratureSearchStep[]
  reduceMotion?: boolean | null
}) {
  const stepperSteps: StepperStep[] = steps.map(step => ({
    id: step.id,
    label: step.label,
    status: step.status,
  }))

  return (
    <CompactProgressStrip steps={stepperSteps} />
  )
}

function IntentSummaryCard({ intent }: { intent: SearchIntent }) {
  const preferredYearText = intent.preferredYears
    ? [intent.preferredYears.from || '?', intent.preferredYears.to || '?'].join(' - ')
    : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-400">
        <SearchLensIcon />
        <span>检索意图</span>
      </div>
      <h2 className="text-xl font-bold leading-tight text-black">
        {intent.researchGoal || intent.clarifiedQuery}
      </h2>

      {(intent.coreConcepts.length > 0 || intent.relatedFields.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {intent.coreConcepts.map(concept => (
            <MetricPill key={concept} label="概念" value={concept} />
          ))}
          {intent.relatedFields.map(field => (
            <MetricPill key={field} label="领域" value={field} />
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {intent.literatureTypes.slice(0, 3).map(item => (
          <MetricPill key={item} label="文献类型" value={item} />
        ))}
        {preferredYearText && <MetricPill label="年份偏好" value={preferredYearText} />}
        <MetricPill label="引文偏好" value={intent.citationPreference} tone="accent" />
        {intent.openAccessOnly && <MetricPill label="访问策略" value="仅开放获取" />}
      </div>
    </motion.div>
  )
}

function QueryPlanCard({ groups }: { groups: QueryExpansionGroup[] }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-400">
          <BranchIcon />
          <span>检索树</span>
        </div>
        <div className="mt-2 text-sm leading-relaxed text-gray-500">
          下面这些查询组来自意图拆解与语义扩展，会在不同方向并行召回文献。
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map(group => (
          <div key={group.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-black">{group.label}</div>
              <span className="text-xs font-medium text-gray-500">{group.focus}</span>
            </div>

            <div className="rounded-lg border border-gray-100 bg-white p-3 text-xs leading-relaxed text-gray-700">
              {group.query}
            </div>

            <KeywordStrip label="扩展词" items={group.synonyms} tone="neutral" />
            <KeywordStrip label="相关概念" items={group.relatedConcepts} tone="accent" />
            <KeywordStrip label="多语关键词" items={group.multilingualKeywords} tone="neutral" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ProcessLogCard({
  thinking,
  toolCalls,
  steps,
  queryGroups,
  results,
  isLoading,
  reduceMotion,
  timeline,
}: {
  thinking: ThoughtBubble[]
  toolCalls: ToolCallEvent[]
  steps: LiteratureSearchStep[]
  queryGroups: QueryExpansionGroup[]
  results: LiteratureSearchResultPayload | null
  isLoading: boolean
  reduceMotion: boolean | null
  timeline: Array<{ seq: number; type: 'thought' | 'tool' | 'queryGroup'; data: ThoughtBubble | ToolCallEvent | QueryExpansionGroup }>
}) {
  type TimelineItem = typeof timeline[number]
  const runningTools = toolCalls.filter(call => call.status === 'running')
  const processEventCount = timeline.length + (results ? 1 : 0)

  return (
    <div className="flex flex-col gap-5 font-sans text-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <motion.div
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white"
            animate={isLoading && !reduceMotion ? { scale: [1, 1.05, 1] } : undefined}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <FlowIcon />
          </motion.div>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">智能检索</span>
        </div>
        {processEventCount > 0 && (
          <div className="flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            <AnimatedCounter value={processEventCount} />
            <span>事件</span>
          </div>
        )}
      </div>

      {/* Animated Stepper - Top Progress */}
      <div className="rounded-xl border border-gray-100 bg-gradient-to-b from-gray-50/50 to-white p-4 dark:border-gray-800 dark:from-gray-900/50 dark:to-gray-900">
        <AnimatedStepper
          steps={steps.map(s => ({ id: s.id, label: s.label, status: s.status }))}
          variant="horizontal"
          showProgressLine={true}
        />
      </div>

      {/* Chain of Thought - AI Reasoning Process */}
      {timeline.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              <ThinkingIcon />
              <span>AI推理过程</span>
            </div>
            {runningTools.length > 0 && (
              <motion.div
                className="ml-auto flex items-center gap-1.5 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
                animate={!reduceMotion ? { opacity: [0.7, 1, 0.7] } : undefined}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <motion.span
                  animate={!reduceMotion ? { rotate: 360 } : undefined}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                >
                  <LoadingSpinnerIcon />
                </motion.span>
                <span>执行中</span>
              </motion.div>
            )}
          </div>
          
          <ChainOfThought>
            {timeline.map((item, index) => {
              const isThought = item.type === 'thought'
              const isTool = item.type === 'tool'
              const isQuery = item.type === 'queryGroup'
              const isLatest = index === timeline.length - 1 && isLoading

              return (
                <ChainOfThoughtStep key={`${item.seq}-${item.type}`} defaultOpen={isLatest || index >= timeline.length - 3}>
                  <ChainOfThoughtTrigger
                    leftIcon={
                      isThought ? (
                        <BrainIcon />
                      ) : isTool ? (
                        <ToolTypeIcon type={(item.data as ToolCallEvent).name} />
                      ) : (
                        <BranchIcon />
                      )
                    }
                    className={cn(
                      isLatest && "text-blue-600 dark:text-blue-400",
                      isTool && (item.data as ToolCallEvent).status === 'running' && "text-blue-600 dark:text-blue-400",
                      isTool && (item.data as ToolCallEvent).status === 'error' && "text-red-600 dark:text-red-400"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {isThought && (
                        <span className="font-medium">
                          💭 {steps.find(s => s.id === (item.data as ThoughtBubble).stage)?.label || (item.data as ThoughtBubble).stage}
                        </span>
                      )}
                      {isTool && (
                        <>
                          <span className="font-medium">⚙️ {TOOL_DISPLAY_NAMES[(item.data as ToolCallEvent).name]}</span>
                          {(item.data as ToolCallEvent).resultCount !== undefined && (
                            <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              <AnimatedCounter value={(item.data as ToolCallEvent).resultCount!} />
                              <span>条</span>
                            </span>
                          )}
                        </>
                      )}
                      {isQuery && (
                        <span className="font-medium">🔍 {(item.data as QueryExpansionGroup).label}</span>
                      )}
                    </span>
                  </ChainOfThoughtTrigger>
                  
                  <ChainOfThoughtContent>
                    {isThought && (
                      <div className={cn(
                        "rounded-lg border px-3 py-2.5 text-sm leading-relaxed",
                        isLatest
                          ? "border-blue-100 bg-blue-50/50 text-gray-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-gray-200"
                          : "border-gray-100 bg-gray-50/50 text-gray-600 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300"
                      )}>
                        {(item.data as ThoughtBubble).text}
                        {isLatest && (
                          <AnimatedShinyText shimmerWidth={120} className="ml-1 inline">
                            …
                          </AnimatedShinyText>
                        )}
                      </div>
                    )}
                    
                    {isTool && (
                      <div className="space-y-2">
                        <div className={cn(
                          "rounded-lg border px-3 py-2.5 text-sm",
                          (item.data as ToolCallEvent).status === 'running'
                            ? "border-blue-100 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-900/20"
                            : (item.data as ToolCallEvent).status === 'error'
                              ? "border-red-100 bg-red-50/30 dark:border-red-900 dark:bg-red-900/20"
                              : "border-gray-100 bg-gray-50/30 dark:border-gray-800 dark:bg-gray-800/30"
                        )}>
                          <div className="font-mono text-xs text-gray-600 dark:text-gray-400">
                            {(item.data as ToolCallEvent).inputSummary}
                          </div>
                        </div>
                        {(item.data as ToolCallEvent).note && (
                          <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs leading-relaxed text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
                            💡 {(item.data as ToolCallEvent).note}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {isQuery && (
                      <div className="space-y-3">
                        <div className="rounded-lg border border-gray-100 bg-gray-50/30 p-3 dark:border-gray-800 dark:bg-gray-800/30">
                          <div className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">检索焦点</div>
                          <div className="text-sm text-gray-700 dark:text-gray-300">{(item.data as QueryExpansionGroup).focus}</div>
                        </div>
                        <div className="rounded-lg border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                          <div className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">查询语句</div>
                          <div className="font-mono text-xs text-gray-600 dark:text-gray-400">{(item.data as QueryExpansionGroup).query}</div>
                        </div>
                        {(item.data as QueryExpansionGroup).synonyms.length > 0 && (
                          <div>
                            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">扩展词汇</div>
                            <div className="flex flex-wrap gap-1.5">
                              {(item.data as QueryExpansionGroup).synonyms.slice(0, 8).map(syn => (
                                <span key={syn} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
                                  {syn}
                                </span>
                              ))}
                              {(item.data as QueryExpansionGroup).synonyms.length > 8 && (
                                <span className="flex items-center rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                  +<AnimatedCounter value={(item.data as QueryExpansionGroup).synonyms.length - 8} />
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </ChainOfThoughtContent>
                </ChainOfThoughtStep>
              )
            })}
          </ChainOfThought>
        </div>
      )}

      {/* Loading indicator */}
      {isLoading && timeline.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center gap-3 rounded-xl border border-blue-100 bg-blue-50/30 p-5 dark:border-blue-900 dark:bg-blue-900/20"
        >
          <motion.div
            animate={!reduceMotion ? { rotate: 360 } : undefined}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            className="text-blue-500"
          >
            <LoadingSpinnerIcon />
          </motion.div>
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">AI正在思考...</span>
        </motion.div>
      )}

      {/* Results Summary */}
      {results && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-green-100 bg-gradient-to-br from-green-50/50 to-white p-4 shadow-sm dark:border-green-900 dark:from-green-900/20 dark:to-gray-900"
        >
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
            <InsightIcon />
            <span>检索完成</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <MetricPill label="召回候选" value={results.totalCandidates} />
            <MetricPill label="去重" value={results.duplicatesRemoved} />
            <MetricPill label="最终推荐" value={results.papers.length} tone="accent" />
            {results.retryCount > 0 && (
              <MetricPill label="自动重检" value={results.retryCount} tone="accent" />
            )}
          </div>
          {results.reviewNotes.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {results.reviewNotes.map(note => (
                <div
                  key={note}
                  className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm leading-relaxed text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
                >
                  {note}
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}

/* Tool Call Item Component */
function ToolCallItem({
  call,
  isLatest,
  reduceMotion,
}: {
  call: ToolCallEvent
  isLatest: boolean
  reduceMotion: boolean | null
}) {
  const isRunning = call.status === 'running'
  const isError = call.status === 'error'
  const details = parseToolInputSummary(call.name, call.inputSummary)

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-lg border p-3 transition-all",
        isRunning && "border-blue-200 bg-blue-50/50",
        isError && "border-red-200 bg-red-50/50",
        !isRunning && !isError && "border-gray-100 bg-gray-50/30"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <motion.span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-md",
              isRunning && "bg-blue-100 text-blue-600",
              isError && "bg-red-100 text-red-500",
              !isRunning && !isError && "bg-gray-100 text-gray-500"
            )}
            animate={isRunning && !reduceMotion ? { scale: [1, 1.1, 1] } : undefined}
            transition={{ duration: 1, repeat: Infinity }}
          >
            <ToolTypeIcon type={call.name} />
          </motion.span>
          <span className="text-sm font-medium text-gray-800">
            {formatToolLabel(call.name)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {typeof call.resultCount === 'number' && (
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700 shadow-sm">
              <AnimatedCounter value={call.resultCount} duration={0.8} /> 条
            </span>
          )}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
              isRunning && "bg-blue-100 text-blue-600",
              isError && "bg-red-100 text-red-500",
              !isRunning && !isError && "bg-green-100 text-green-600"
            )}
          >
            {isRunning ? '执行中' : isError ? '失败' : '完成'}
          </span>
        </div>
      </div>
      
      {details.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {details.map(detail => (
            <span
              key={detail}
              className="rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-500 shadow-sm"
            >
              {detail}
            </span>
          ))}
        </div>
      )}
      
      {call.note && (
        <div className="mt-2 text-xs text-gray-500">{call.note}</div>
      )}
    </motion.div>
  )
}

/* Tool Type Icon */
function ToolTypeIcon({ type }: { type: ToolCallEvent['name'] }) {
  const iconMap: Record<ToolCallEvent['name'], React.ReactNode> = {
    searchWorks: <SearchLensIcon />,
    getConceptTree: <BranchIcon />,
    getRelatedWorks: <LinkIcon />,
    filterWorks: <FilterIcon />,
    getAuthorWorks: <UserIcon />,
    rankAndDeduplicate: <RankIcon />,
  }
  return <>{iconMap[type] || <TerminalIcon />}</>
}

function KeywordStrip({
  label,
  items,
  tone,
}: {
  label: string
  items: string[]
  tone: 'neutral' | 'accent'
}) {
  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.slice(0, 6).map(item => (
          <MetricPill key={item} label={tone === 'accent' ? '概念' : '词'} value={item} tone={tone} />
        ))}
      </div>
    </div>
  )
}

function EmptySearchState({ onPickPrompt }: { onPickPrompt: (value: string) => void }) {
  return (
    <div className="my-auto flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
      <div className="flex items-center justify-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-400">
        <SparkIcon />
        <span>研究工作台</span>
      </div>
      <div className="text-xl font-bold leading-tight text-black">
        从研究问题开始
      </div>
      <div className="mx-auto max-w-xl text-sm leading-relaxed text-gray-500">
        输入问题后，系统会先理解意图，再自动扩展关键词、并行检索、滚雪球扩展并输出推荐文献。
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {SUGGESTED_RESEARCH_PROMPTS.map(prompt => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPickPrompt(prompt)}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}

// Tool display names for UI
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  searchWorks: '文献检索',
  getConceptTree: '概念关系',
  getRelatedWorks: '相关文献',
  filterWorks: '过滤筛选',
  getAuthorWorks: '作者论文',
  rankAndDeduplicate: '排序去重',
}

function ModelBadge({
  modelLabel,
  isLoading,
  hasResults,
}: {
  modelLabel: string | null
  isLoading: boolean
  hasResults: boolean
}) {
  // Parse provider and model from label like "OpenAI / GPT-4"
  const [provider, model] = (modelLabel || '').split(' / ')
  
  return (
    <div className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-200/80 bg-gradient-to-r from-white to-gray-50/80 px-2.5 py-1.5 shadow-sm transition-all dark:border-gray-700 dark:from-gray-800 dark:to-gray-800/80">
      {/* Status indicator */}
      <span className="relative flex h-2 w-2">
        <span className={cn(
          "absolute inline-flex h-full w-full rounded-full opacity-75",
          isLoading && "animate-ping bg-blue-400",
          hasResults && !isLoading && "bg-green-400",
          !isLoading && !hasResults && "bg-gray-300"
        )} />
        <span className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          isLoading ? "bg-blue-500" : hasResults ? "bg-green-500" : "bg-gray-400"
        )} />
      </span>
      
      {modelLabel ? (
        <div className="flex items-center gap-1.5">
          {provider && (
            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
              {provider}
            </span>
          )}
          {provider && model && (
            <span className="text-gray-300 dark:text-gray-600">/</span>
          )}
          {model && (
            <span className="rounded bg-gradient-to-r from-blue-50 to-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 dark:from-blue-900/30 dark:to-indigo-900/30 dark:text-indigo-400">
              {model}
            </span>
          )}
        </div>
      ) : (
        <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500">
          未配置模型
        </span>
      )}
    </div>
  )
}

function MetricPill({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'neutral' | 'accent' }) {
  const numeric = isNumericLikeValue(value)
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-[inset_0_0.5px_0_rgba(0,0,0,0.05)] dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.05)]',
        tone === 'accent'
          ? 'border-blue-200 bg-white text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300'
          : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
      )}
    >
      <span className={cn(
        tone === 'accent' 
          ? 'text-blue-600 dark:text-blue-400' 
          : 'text-gray-500 dark:text-gray-400'
      )}>{label}</span>
      <span className={cn(
        'h-3 w-px',
        tone === 'accent' 
          ? 'bg-blue-100 dark:bg-blue-800' 
          : 'bg-gray-200 dark:bg-gray-600'
      )} />
      <strong className={cn(
        tone === 'accent' 
          ? 'text-blue-700 dark:text-blue-300' 
          : 'text-gray-900 dark:text-white'
      )}>
        {numeric ? <AnimatedCounter value={Number(value)} /> : value}
      </strong>
    </div>
  )
}

function PaperBadge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'neutral' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'success' 
          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400' 
          : 'border-transparent bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      )}
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
  const displayAuthors = paper.authors.slice(0, 4)
  const hasMoreAuthors = paper.authors.length > 4
  const targetUrl = paper.url || `https://openalex.org/${paper.openAlexId.split('/').pop()}`

  return (
    <div className="group flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow duration-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:shadow-gray-800/50">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-lg font-bold leading-tight text-black transition-colors hover:text-blue-600 dark:text-white dark:hover:text-blue-400"
          >
            {paper.title}
            <span className="shrink-0 text-gray-400 transition-colors group-hover:text-blue-500 dark:text-gray-500 dark:group-hover:text-blue-400">
              <ExternalLinkIcon />
            </span>
          </a>
          <div className="flex shrink-0 items-center gap-2">
            <PaperBadge tone="neutral">被引 {paper.citedByCount}</PaperBadge>
            {paper.isOpenAccess && <PaperBadge tone="success">OA</PaperBadge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span>
            {displayAuthors.join(', ') || '未知作者'}
            {hasMoreAuthors && ' et al.'}
          </span>
          {paper.year && <span className="h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />}
          {paper.year && <span>{paper.year}</span>}
          {paper.venue && <span className="h-1 w-1 rounded-full bg-gray-300 dark:bg-gray-600" />}
          {paper.venue && <span className="italic">{paper.venue}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
        <div className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          <span className="mr-2 font-semibold text-gray-900 dark:text-white">摘要片段:</span>
          {paper.abstractSnippet}
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 text-sm leading-relaxed text-gray-600 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300">
          <span className="mr-2 font-semibold text-gray-900 dark:text-white">推荐理由:</span>
          {paper.recommendationReason || '该论文与当前研究问题高度相关。'}
        </div>
      </div>

      {(paper.matchedQueries.length > 0 || paper.matchedConcepts.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-2">
          {paper.matchedQueries.slice(0, 3).map(item => (
            <MetricPill key={item} label="Query" value={item} />
          ))}
          {paper.matchedConcepts.slice(0, 3).map(item => (
            <MetricPill key={item} label="Concept" value={item} tone="accent" />
          ))}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" onClick={() => onSave(paper)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
          保存到知识库
        </button>
        <button type="button" onClick={() => onInsert(paper)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
          插入引用
        </button>
        {paper.pdfUrl && (
          <a
            href={paper.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            打开 PDF
          </a>
        )}
      </div>
    </div>
  )
}

function ClarificationPanel({
  questions,
  answers,
  setAnswers,
  canSubmit,
  isLoading,
  onSubmit,
  onSkip,
  reduceMotion,
}: {
  questions: ClarificationQuestion[]
  answers: AnswerState
  setAnswers: React.Dispatch<React.SetStateAction<AnswerState>>
  canSubmit: boolean
  isLoading: boolean
  onSubmit: () => void
  onSkip: () => void
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
      initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.96 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.96 }}
      transition={{
        type: 'spring',
        stiffness: 320,
        damping: 24,
        bounce: 0.22,
      }}
      className="fixed inset-x-0 bottom-24 z-50 mx-auto flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:border-indigo-900/50 dark:bg-gray-900 dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)]"
      style={{ maxHeight: 'min(600px, calc(100vh - 160px))' }}
    >
      {/* Top gradient bar with progress */}
      <div className="relative h-1.5 shrink-0 bg-gray-100 dark:bg-gray-800">
        <motion.div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"
          initial={{ width: '0%' }}
          animate={{ width: `${(answeredCount / questions.length) * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {/* Header - Fixed */}
      <div className="shrink-0 border-b border-gray-100 p-5 pb-4 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white"
              animate={!reduceMotion ? { scale: [1, 1.05, 1] } : undefined}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ClarifyIcon />
            </motion.div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">补充研究约束</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                已完成 {answeredCount}/{questions.length} 题
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {questions.map((_, idx) => (
              <motion.span
                key={idx}
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  idx < answeredCount ? "bg-indigo-500" : "bg-gray-200 dark:bg-gray-700"
                )}
                initial={false}
                animate={{ scale: idx < answeredCount ? [1, 1.2, 1] : 1 }}
                transition={{ duration: 0.3 }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Questions - Scrollable */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
        <div className="flex flex-col gap-6">
          {questions.map((question, qIdx) => {
            const answer = answers[question.id] || { value: '', customText: '' }

            return (
              <motion.div
                key={question.id}
                initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: qIdx * 0.1 }}
                className="rounded-xl border border-gray-100 bg-gray-50/30 p-4 dark:border-gray-800 dark:bg-gray-800/30"
              >
                <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {question.prompt}
                </h3>
                <div className="flex flex-col gap-2">
                  {question.options.map(option => {
                    const selected = answer.value === option.value
                    return (
                      <div key={option.id} className="flex flex-col gap-2">
                        <label
                          className={cn(
                            "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all",
                            selected
                              ? "border-indigo-500 bg-indigo-50/50 dark:border-indigo-400 dark:bg-indigo-900/30"
                              : "border-gray-200 hover:border-indigo-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-indigo-800 dark:hover:bg-gray-800"
                          )}
                        >
                          <span className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                            selected
                              ? "border-indigo-500 bg-indigo-500 dark:border-indigo-400 dark:bg-indigo-400"
                              : "border-gray-300 dark:border-gray-600"
                          )}>
                            {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </span>
                          <input
                            type="radio"
                            name={question.id}
                            value={option.value}
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
                            className="sr-only"
                          />
                          <span className={cn(
                            "text-sm",
                            selected
                              ? "font-medium text-indigo-900 dark:text-indigo-100"
                              : "text-gray-700 dark:text-gray-300"
                          )}>
                            {option.label}
                          </span>
                        </label>
                        
                        {/* Custom text input for "other" option */}
                        {option.isOther && selected && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="ml-7"
                          >
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
                              placeholder="补充你的自定义说明..."
                              className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-indigo-800 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-indigo-600 dark:focus:ring-indigo-900/50"
                            />
                          </motion.div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Footer - Fixed */}
      <div className="shrink-0 border-t border-gray-100 p-5 pt-4 dark:border-gray-800">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={isLoading}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-600 transition-all duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            跳过此步
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || isLoading}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50",
              canSubmit
                ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 dark:shadow-indigo-900/50 dark:hover:shadow-indigo-800/50"
                : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
            )}
          >
            {isLoading ? (
              <>
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <LoadingSpinnerIcon />
                </motion.span>
                处理中...
              </>
            ) : (
              <>
                继续检索
                <SendIcon />
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function SearchLensIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.65" y1="16.65" x2="21" y2="21" />
    </svg>
  )
}

function OrbitIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="2" />
      <path d="M4.93 4.93a10 10 0 0 1 14.14 14.14" />
      <path d="M19.07 4.93A10 10 0 0 1 4.93 19.07" />
    </svg>
  )
}

function FlowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h7" />
      <path d="M4 17h11" />
      <path d="M15 7h5v10h-5" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  )
}

function InsightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 3v12" />
      <path d="M6 9h7a4 4 0 0 1 4 4v8" />
      <circle cx="6" cy="3" r="2" />
      <circle cx="6" cy="15" r="2" />
      <circle cx="17" cy="21" r="2" />
    </svg>
  )
}

function TimelineIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
      <path d="M8 7.5 16 10.5" />
      <path d="M16.5 13.5 9.5 16.5" />
    </svg>
  )
}

function TerminalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

function SparkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  )
}

function ClarifyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-2.9 2.8-2.9 4" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function InfoDotIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="10" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 5h5v5" />
      <path d="M10 14 19 5" />
      <path d="M19 14v5h-14v-14h5" />
    </svg>
  )
}

function CheckIcon({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={className}>
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}

function LoadingSpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function ThinkingIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2a8 8 0 0 0-8 8c0 2.76 1.4 5.2 3.5 6.6V19a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-2.4c2.1-1.4 3.5-3.84 3.5-6.6a8 8 0 0 0-8-8z" />
      <path d="M9 22v1" />
      <path d="M15 22v1" />
    </svg>
  )
}

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function RankIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  )
}

function CheckCircleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  )
}
