'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { addToast } from '@heroui/react'
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
import { OdometerNumber } from './OdometerNumber'

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
          />
        )}

        {results && (
          <section className="grid gap-4">
            <div className="flex flex-col gap-4 rounded-xl border border-blue-100 bg-blue-50/30 p-6 shadow-[inset_0_0.5px_0_rgba(255,255,255,0.5)]">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-blue-600">
                <InsightIcon />
                <span>检索结论</span>
              </div>
              <p className="leading-relaxed text-gray-800">{results.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <MetricPill label="候选文献" value={String(results.totalCandidates)} />
                <MetricPill label="去重" value={String(results.duplicatesRemoved)} />
                <MetricPill label="最终推荐" value={String(results.papers.length)} tone="accent" />
                {results.retryCount > 0 && <MetricPill label="自动重检" value={String(results.retryCount)} />}
              </div>
            </div>

            {results.papers.length === 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-600 shadow-sm">
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
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-600">
            {error}
          </div>
        )}
      </div>
    </div>
  )

  const composer = (
    <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent ${isFullscreenLayout ? 'px-6 pb-6 pt-20' : 'px-4 pb-4 pt-16'} pointer-events-none`}>
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
          className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-[0_2px_10px_rgb(0,0,0,0.04)] transition-shadow focus-within:border-gray-300 focus-within:shadow-[0_4px_20px_rgb(0,0,0,0.08)]"
        >
          <div className="flex flex-1 items-center px-4">
            <input
              type="text"
              value={inputValue}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={questions.length > 0 ? '补充限定条件...' : '输入研究问题，如：RAG 评测框架相关论文'}
              className="w-full border-none bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400"
            />
          </div>

          <div className="flex shrink-0 items-center gap-3 pr-2">
            <AnimatePresence mode="wait">
              <motion.span
                key={questions.length > 0 ? 'clarify' : isLoading ? 'loading' : 'idle'}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-xs font-medium text-gray-400"
              >
                {questions.length > 0 ? '等待补充说明' : isLoading ? '正在检索中...' : '等待输入'}
              </motion.span>
            </AnimatePresence>

            {isLoading ? (
              <>
                <button
                  type="button"
                  onClick={stopSearch}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200"
                  aria-label="停止检索"
                >
                  <StopIcon />
                </button>
                {canRestart && (
                  <button
                    type="button"
                    onClick={() => void interruptAndRestart()}
                    className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
                  >
                    打断并重检
                  </button>
                )}
              </>
            ) : (
              <button
                type="submit"
                disabled={!inputValue.trim() || (questions.length > 0 && !allQuestionsAnswered)}
                className="flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
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
    <div className="shrink-0 border-b border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight text-black">论文智能检索</h1>
        </div>
        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600 shadow-sm">
          <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? 'bg-blue-500' : results ? 'bg-green-500' : 'bg-gray-400'}`} />
          {modelLabel || '未配置大模型'}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">检索进度</span>
          <span className="text-xs text-gray-500">
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
    <aside className="flex w-64 shrink-0 flex-col gap-8 border-r border-gray-200 bg-gray-50/50 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-bold tracking-tight text-black">论文智能检索</h1>
        <div className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600 shadow-sm">
          <span className={`h-1.5 w-1.5 rounded-full ${isLoading ? 'bg-blue-500' : results ? 'bg-green-500' : 'bg-gray-400'}`} />
          {modelLabel || '未配置大模型'}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">检索进度</h2>
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
      <div className="flex h-full bg-white text-black font-sans selection:bg-purple-200 selection:text-purple-900">
        {fullscreenSidebar}
        <main className="relative flex min-w-0 flex-1 overflow-hidden">
          {feed}
          {composer}
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col bg-white text-black font-sans selection:bg-purple-200 selection:text-purple-900">
      {compactHeader}
      {feed}
      {composer}
    </div>
  )
}

function StepProgressRail({
  steps,
  reduceMotion,
}: {
  steps: LiteratureSearchStep[]
  reduceMotion: boolean | null
}) {
  return (
    <div className="relative flex flex-col gap-3">
      <div className="absolute bottom-2 left-[7px] top-2 w-px bg-gray-200" />
      {steps.map(step => {
        const isCompleted = step.status === 'completed'
        const isInProgress = step.status === 'in_progress'
        const isError = step.status === 'error'

        return (
          <div key={step.id} className="relative z-10 flex items-center gap-3">
            <div
              className={[
                'flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 bg-white transition-colors duration-300',
                isCompleted ? 'border-black bg-black' : '',
                isInProgress ? 'border-blue-500' : '',
                !isCompleted && !isInProgress && !isError ? 'border-gray-200' : '',
                isError ? 'border-red-400' : '',
              ].join(' ')}
            >
              {isCompleted ? (
                <CheckIcon size={8} className="text-white" />
              ) : isInProgress ? (
                <motion.span
                  className="h-2 w-2 rounded-full border-2 border-blue-500 border-t-transparent"
                  animate={!reduceMotion ? { rotate: 360 } : undefined}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
              ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${isError ? 'bg-red-400' : 'bg-transparent'}`} />
              )}
            </div>
            <span
              className={[
                'text-sm transition-colors duration-300',
                isCompleted ? 'text-black' : '',
                isInProgress ? 'font-medium text-blue-600' : '',
                !isCompleted && !isInProgress && !isError ? 'text-gray-400' : '',
                isError ? 'text-red-500' : '',
              ].join(' ')}
            >
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function HorizontalProgressStrip({
  steps,
  reduceMotion,
}: {
  steps: LiteratureSearchStep[]
  reduceMotion: boolean | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {steps.map(step => {
          const isCompleted = step.status === 'completed'
          const isInProgress = step.status === 'in_progress'
          const isError = step.status === 'error'

          return (
            <div
              key={step.id}
              className={[
                'flex min-w-0 flex-1 items-center gap-1.5 text-[10px] font-semibold',
                isCompleted ? 'text-black' : '',
                isInProgress ? 'text-blue-600' : '',
                isError ? 'text-red-500' : '',
                !isCompleted && !isInProgress && !isError ? 'text-gray-400' : '',
              ].join(' ')}
            >
              {isCompleted ? (
                <CheckIcon size={9} />
              ) : isInProgress ? (
                <motion.span
                  className="h-1.5 w-1.5 rounded-full bg-blue-500"
                  animate={!reduceMotion ? { opacity: [0.4, 1, 0.4] } : undefined}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                />
              ) : (
                <span className={`h-1.5 w-1.5 rounded-full ${isError ? 'bg-red-400' : 'bg-gray-300'}`} />
              )}
              <span className="truncate">{step.label}</span>
            </div>
          )
        })}
      </div>

      <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-200">
        {steps.map((step, index) => {
          const isCompleted = step.status === 'completed'
          const isInProgress = step.status === 'in_progress'
          const isError = step.status === 'error'
          return (
            <motion.div
              key={step.id}
              initial={false}
              animate={{
                backgroundColor: isCompleted
                  ? '#111827'
                  : isInProgress
                    ? '#2563eb'
                    : isError
                      ? '#ef4444'
                      : 'transparent',
              }}
              transition={{ duration: 0.25 }}
              className={index < steps.length - 1 ? 'h-full flex-1 border-r border-gray-200/60' : 'h-full flex-1'}
            />
          )
        })}
      </div>
    </div>
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
}: {
  thinking: ThoughtBubble[]
  toolCalls: ToolCallEvent[]
  steps: LiteratureSearchStep[]
  queryGroups: QueryExpansionGroup[]
  results: LiteratureSearchResultPayload | null
  isLoading: boolean
  reduceMotion: boolean | null
}) {
  const toolItems = toolCalls.map(call => ({
    id: `tool-${call.id}`,
    stage: '工具调用',
    text: '',
    label: formatToolLabel(call.name),
    details: parseToolInputSummary(call.name, call.inputSummary),
    resultCount: call.resultCount,
    status: call.status,
    note: call.note,
    isLatest: false,
    type: 'tool' as const,
  }))

  const thoughtItems = thinking.map((bubble, index) => ({
    id: bubble.id,
    stage: steps.find(step => step.id === bubble.stage)?.label || bubble.stage,
    text: bubble.text,
    details: [] as string[],
    isLatest: index === thinking.length - 1,
    type: 'thought' as const,
  }))

  const items = [...thoughtItems, ...toolItems]
  const processEventCount = items.length + queryGroups.length + (results ? 1 : 0)

  return (
    <div className="flex flex-col gap-4 font-sans text-sm">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
          Process 日志
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
          {processEventCount} 条记录
        </span>
      </div>

      {queryGroups.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <BranchIcon />
            <span>检索计划</span>
          </div>
          <div className="flex flex-col gap-3">
            {queryGroups.map(group => (
              <div key={group.id} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-black">{group.label}</span>
                  <span className="text-[11px] text-gray-500">{group.focus}</span>
                </div>
                <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 font-mono text-xs leading-relaxed text-gray-700">
                  {group.query}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <KeywordStrip label="扩展词" items={group.synonyms} tone="neutral" />
                  <KeywordStrip label="相关概念" items={group.relatedConcepts} tone="accent" />
                  <KeywordStrip label="多语关键词" items={group.multilingualKeywords} tone="neutral" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative flex flex-col pl-2">
        <div className="absolute bottom-2 left-[7px] top-2 w-[1px] bg-gray-100" />

        <AnimatePresence mode="popLayout" initial={false}>
          {items.map(item => (
            <motion.div
              key={item.id}
              layout
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="relative flex gap-4 pb-6 last:pb-0"
            >
              <div className={[
                'relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-white',
                item.isLatest ? 'border-blue-500 text-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]' : 'border-gray-200 text-gray-400',
              ].join(' ')}>
                {item.type === 'tool' ? <TerminalIcon /> : <InfoDotIcon />}
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className={[
                    'text-[10px] font-bold uppercase tracking-wider',
                    item.isLatest ? 'text-blue-500' : 'text-gray-400',
                  ].join(' ')}>
                    {item.stage}
                  </span>
                  {item.type === 'tool' && (
                    <>
                      <span className={[
                        'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tighter',
                        item.status === 'running'
                          ? 'bg-blue-50 text-blue-600'
                          : item.status === 'error'
                            ? 'bg-red-50 text-red-500'
                            : 'bg-gray-100 text-gray-600',
                      ].join(' ')}>
                        {item.status === 'running' ? '执行中' : item.status === 'error' ? '失败' : '完成'}
                      </span>
                      {typeof item.resultCount === 'number' && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-600">
                          <span>召回</span>
                          <OdometerNumber value={item.resultCount} className="font-semibold text-gray-900" />
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className={[
                  'break-words text-sm leading-relaxed',
                  item.isLatest ? 'font-medium text-black' : 'text-gray-500',
                  item.type === 'tool' ? 'rounded border border-gray-100 bg-gray-50 p-2 font-mono text-xs' : '',
                ].join(' ')}>
                  {item.type === 'tool' ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="font-semibold text-gray-800">{item.label}</div>
                      {item.details && item.details.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.details.map(detail => (
                            <span
                              key={detail}
                              className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] leading-5 text-gray-600"
                            >
                              {detail}
                            </span>
                          ))}
                        </div>
                      )}
                      {item.note && (
                        <div className="text-[11px] leading-relaxed text-gray-500">{item.note}</div>
                      )}
                    </div>
                  ) : (
                    item.text
                  )}
                  {item.isLatest && item.type === 'thought' && isLoading && (
                    <AnimatedShinyText shimmerWidth={180} style={{ fontSize: 12, marginLeft: 4 }}>
                      …
                    </AnimatedShinyText>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 pl-1">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <AnimatedShinyText shimmerWidth={220} style={{ fontSize: 12 }}>
            处理中...
          </AnimatedShinyText>
        </div>
      )}

      {results && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            <InsightIcon />
            <span>结果检阅</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <MetricPill label="召回候选" value={results.totalCandidates} />
            <MetricPill label="去重后" value={results.duplicatesRemoved} />
            <MetricPill label="最终推荐" value={results.papers.length} tone="accent" />
            {results.retryCount > 0 && <MetricPill label="结果检阅重检" value={results.retryCount} tone="accent" />}
          </div>
          {(results.retryCount > 0 || results.reviewNotes.length > 0) && (
            <div className="mt-3 flex flex-col gap-2">
              {results.retryCount > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-600">
                  基于当前结果质量自动追加的补充检索。
                </div>
              )}
              {results.reviewNotes.map(note => (
                <div key={note} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm leading-relaxed text-gray-600">
                  {note}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
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

function MetricPill({ label, value, tone = 'neutral' }: { label: string; value: string | number; tone?: 'neutral' | 'accent' }) {
  const numeric = isNumericLikeValue(value)
  return (
    <div
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow-[inset_0_0.5px_0_rgba(0,0,0,0.05)]',
        tone === 'accent'
          ? 'border-blue-200 bg-white text-blue-700'
          : 'border-gray-200 bg-white text-gray-600',
      ].join(' ')}
    >
      <span className={tone === 'accent' ? 'text-blue-600' : 'text-gray-500'}>{label}</span>
      <span className={`h-3 w-px ${tone === 'accent' ? 'bg-blue-100' : 'bg-gray-200'}`} />
      <strong className={tone === 'accent' ? 'text-blue-700' : 'text-gray-900'}>
        {numeric ? <OdometerNumber value={value} /> : value}
      </strong>
    </div>
  )
}

function PaperBadge({ children, tone }: { children: React.ReactNode; tone: 'success' | 'neutral' }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-transparent bg-gray-100 text-gray-800',
      ].join(' ')}
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
    <div className="group flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow duration-300 hover:shadow-md">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <a
            href={targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-lg font-bold leading-tight text-black transition-colors hover:text-blue-600"
          >
            {paper.title}
            <span className="shrink-0 text-gray-400 transition-colors group-hover:text-blue-500">
              <ExternalLinkIcon />
            </span>
          </a>
          <div className="flex shrink-0 items-center gap-2">
            <PaperBadge tone="neutral">被引 {paper.citedByCount}</PaperBadge>
            {paper.isOpenAccess && <PaperBadge tone="success">OA</PaperBadge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <span>
            {displayAuthors.join(', ') || '未知作者'}
            {hasMoreAuthors && ' et al.'}
          </span>
          {paper.year && <span className="h-1 w-1 rounded-full bg-gray-300" />}
          {paper.year && <span>{paper.year}</span>}
          {paper.venue && <span className="h-1 w-1 rounded-full bg-gray-300" />}
          {paper.venue && <span className="italic">{paper.venue}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 pt-4">
        <div className="text-sm leading-relaxed text-gray-600">
          <span className="mr-2 font-semibold text-gray-900">摘要片段:</span>
          {paper.abstractSnippet}
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 text-sm leading-relaxed text-gray-600">
          <span className="mr-2 font-semibold text-gray-900">推荐理由:</span>
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
        <button type="button" onClick={() => onSave(paper)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
          保存到知识库
        </button>
        <button type="button" onClick={() => onInsert(paper)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
          插入引用
        </button>
        {paper.pdfUrl && (
          <a
            href={paper.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
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
      className="fixed inset-x-0 bottom-20 z-50 mx-auto w-full max-w-lg overflow-hidden rounded-2xl border border-purple-100 bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.12)]"
      style={{ maxHeight: 'min(480px, calc(100vh - 200px))' }}
    >
      <div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-purple-400 to-indigo-500 opacity-50" />

      <div className="flex max-h-[inherit] min-h-0 flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-purple-600">
          <ClarifyIcon />
          <span>答题器</span>
        </div>
        <div className="text-sm leading-relaxed text-gray-600">
          当前问题仍偏宽。先补充几个约束，系统会据此重新规划检索策略。已完成 {answeredCount}/{questions.length} 题。
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            {questions.map(question => {
              const answer = answers[question.id] || { value: '', customText: '' }

              return (
                <div key={question.id} className="flex flex-col gap-3">
                  <h3 className="text-base font-medium leading-snug text-gray-900">{question.prompt}</h3>
                  <div className="flex flex-col gap-2">
                    {question.options.map(option => {
                      const selected = answer.value === option.value
                      return (
                        <label
                          key={option.id}
                          className={[
                            'flex cursor-pointer flex-col gap-3 rounded-xl border p-3 transition-all duration-200',
                            selected
                              ? 'border-purple-500 bg-purple-50/50 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.5)]'
                              : 'border-gray-200 hover:border-purple-200 hover:bg-gray-50',
                          ].join(' ')}
                        >
                          <span className="flex items-center gap-3">
                            <span className={[
                              'flex h-4 w-4 items-center justify-center rounded-full border transition-colors',
                              selected ? 'border-purple-500 bg-purple-500' : 'border-gray-300',
                            ].join(' ')}>
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
                            <span className={selected ? 'text-sm font-medium text-purple-900' : 'text-sm text-gray-700'}>
                              {option.label}
                            </span>
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
                              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none"
                            />
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={isLoading}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 transition-all duration-200 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            跳过
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || isLoading}
            className="flex items-center justify-center gap-2 rounded-xl bg-black px-4 py-3 text-sm font-medium text-white transition-all duration-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            提交并继续检索
            <SendIcon />
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
