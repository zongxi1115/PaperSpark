import { NextRequest } from 'next/server'
import { createOpenAlexToolset } from '@/lib/openalexTools'
import { scoreKeywordMatches } from '@/lib/openalex'
import {
  executeMcpToolCalls,
  extractPapersFromMcpResults,
  planMcpToolCalls,
} from '@/lib/literatureMcpService'
import {
  filterWorksLocally,
  indexWorks,
  rankWorksLocally,
  withToolReport,
} from '@/lib/literatureLocalTools'
import { listMcpTools } from '@/lib/mcpStdioClient'
import { createDefaultLiteratureProviders } from '@/lib/literatureProviders'
import {
  applyAnalysisToPapers,
  buildSearchSummary,
  runAnalysisAgent,
  runIntentAgent,
  runQueryExpansionAgent,
  runResultReviewAgent,
} from '@/lib/literatureSearchService'
import type {
  AuthorWorksOutput,
  ConceptTreeOutput,
  FilterWorksOutput,
  LiteratureSearchEvent,
  LiteratureSearchRequest,
  LiteratureSearchStage,
  QueryExpansionGroup,
  RankedWorksOutput,
  RelatedWorksOutput,
  SearchFilters,
  SearchIntent,
  SearchPaper,
  SearchReview,
  SearchWorksOutput,
  StepStatus,
} from '@/lib/literatureSearchTypes'
import { LITERATURE_SEARCH_STEPS } from '@/lib/literatureSearchTypes'
import type { LiteratureProviderConfig, LiteratureProviderDiscoveredTool } from '@/lib/literatureProviders'

export const maxDuration = 120
export const runtime = 'nodejs'

interface DiscoveryPassResult {
  works: SearchPaper[]
  ranked: RankedWorksOutput
  filterResult: FilterWorksOutput
}

interface McpPassResult extends DiscoveryPassResult {
  discoveredTools: LiteratureProviderDiscoveredTool[]
  usedTools: string[]
  notes: string[]
}

function stageDetail(stage: LiteratureSearchStage) {
  switch (stage) {
    case 'intent':
      return '正在理解研究问题并判断是否需要澄清'
    case 'expansion':
      return '正在扩展同义词、上下位概念和多语言关键词'
    case 'parallel-search':
      return '正在并行检索关键词、概念和作者线索'
    case 'analysis':
      return '正在评估相关性并做引用滚雪球扩展'
    case 'aggregation':
      return '正在去重、排序并生成最终推荐'
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function buildBaseFilters(intent: {
  preferredYears?: { from?: number; to?: number }
  citationPreference: 'high-impact' | 'balanced' | 'latest'
  citationThreshold?: number
  openAccessOnly?: boolean
}) {
  const minCitations = intent.citationPreference === 'latest'
    ? 0
    : intent.citationPreference === 'high-impact'
      ? intent.citationThreshold || 40
      : intent.citationThreshold || 10

  return {
    fromYear: intent.preferredYears?.from,
    toYear: intent.preferredYears?.to,
    minCitations,
    openAccessOnly: intent.openAccessOnly,
    maxResults: 8,
    sortBy: intent.citationPreference === 'latest'
      ? 'date'
      : intent.citationPreference === 'high-impact'
        ? 'citations'
        : 'relevance',
  } as SearchFilters
}

function buildRetryFilters(
  baseFilters: SearchFilters,
  retryCount: number,
  review?: SearchReview,
): SearchFilters {
  const next: SearchFilters = {
    ...baseFilters,
    maxResults: Math.min(16, (baseFilters.maxResults || 8) + retryCount * 2),
    sortBy: 'relevance',
  }

  if (retryCount >= 1) {
    next.minCitations = next.minCitations ? Math.max(0, Math.floor(next.minCitations * 0.5)) : 0
    next.openAccessOnly = false
  }

  if (retryCount >= 2) {
    next.minCitations = 0
    next.fromYear = next.fromYear ? Math.max(1900, next.fromYear - 3) : undefined
    next.toYear = next.toYear ? next.toYear + 1 : undefined
  }

  if (review?.relaxedFilters) {
    next.minCitations = review.relaxedFilters.minCitations ?? next.minCitations
    next.openAccessOnly = review.relaxedFilters.openAccessOnly ?? next.openAccessOnly
    next.fromYear = review.relaxedFilters.fromYear ?? next.fromYear
    next.toYear = review.relaxedFilters.toYear ?? next.toYear
  }

  return next
}

function createAdHocQueryGroups(queries: string[], prefix: string): QueryExpansionGroup[] {
  return uniqueStrings(queries)
    .slice(0, 5)
    .map((query, index) => ({
      id: `${prefix.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
      label: `${prefix} ${index + 1}`,
      focus: '基于当前结果质量自动追加的补充检索',
      query,
      synonyms: [],
      relatedConcepts: [],
      multilingualKeywords: [],
    }))
}

function mergeQueryGroups(
  baseGroups: QueryExpansionGroup[],
  extraGroups: QueryExpansionGroup[],
) {
  const seen = new Set<string>()
  const merged: QueryExpansionGroup[] = []

  for (const group of [...baseGroups, ...extraGroups]) {
    const key = group.query.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(group)
  }

  return merged.slice(0, 6)
}

function buildRetryQueries(
  intent: {
    clarifiedQuery: string
    coreConcepts: string[]
    relatedFields: string[]
  },
  queryGroups: QueryExpansionGroup[],
  analysisQueries: string[] = [],
  reviewQueries: string[] = [],
) {
  return uniqueStrings([
    ...reviewQueries,
    ...analysisQueries,
    intent.coreConcepts.slice(0, 2).join(' AND '),
    [intent.coreConcepts[0], intent.relatedFields[0]].filter(Boolean).join(' AND '),
    [...intent.coreConcepts.slice(0, 2), ...intent.relatedFields.slice(0, 1)].filter(Boolean).join(' AND '),
    intent.clarifiedQuery,
    ...queryGroups.map(group => group.query),
  ]).slice(0, 5)
}

function assessDiscoveryRetryNeed(ranked: RankedWorksOutput) {
  const topWorks = ranked.works.slice(0, 3)
  const averageRelevance = topWorks.length > 0
    ? topWorks.reduce((sum, paper) => sum + paper.relevanceScore, 0) / topWorks.length
    : 0

  if (ranked.works.length === 0) {
    return '当前没有检索到可用候选文献'
  }

  if (ranked.works.length < 4) {
    return '首轮候选文献过少'
  }

  if (
    averageRelevance < 0.34 &&
    topWorks.every(paper =>
      paper.matchedQueries.length === 0 &&
      paper.matchedConcepts.length === 0 &&
      paper.keywordMatches.length < 2,
    )
  ) {
    return '头部候选缺少明确的主题命中'
  }

  return undefined
}

function mergeWorks(
  works: SearchPaper[],
  queryGroups: QueryExpansionGroup[],
  extraKeywords: string[] = [],
) {
  const merged = new Map<string, SearchPaper>()

  for (const work of works) {
    const lexical = scoreKeywordMatches(work, queryGroups, extraKeywords)
    const current = merged.get(work.openAlexId)
    const next: SearchPaper = {
      ...(current || work),
      ...work,
      keywordMatches: Array.from(new Set([...(current?.keywordMatches || []), ...lexical.keywordMatches, ...work.keywordMatches])),
      matchedQueries: Array.from(new Set([...(current?.matchedQueries || []), ...lexical.matchedQueries, ...work.matchedQueries])),
      matchedConcepts: Array.from(new Set([...(current?.matchedConcepts || []), ...lexical.matchedConcepts, ...work.matchedConcepts])),
      relevanceScore: Math.max(current?.relevanceScore || 0, work.relevanceScore || 0, lexical.lexicalScore),
    }

    if (!current || next.relevanceScore > current.relevanceScore || next.citedByCount > current.citedByCount) {
      merged.set(work.openAlexId, next)
    } else {
      merged.set(work.openAlexId, {
        ...current,
        keywordMatches: next.keywordMatches,
        matchedQueries: next.matchedQueries,
        matchedConcepts: next.matchedConcepts,
        relevanceScore: Math.max(current.relevanceScore, next.relevanceScore),
      })
    }
  }

  return Array.from(merged.values())
}

function fillRecommendationReason(paper: SearchPaper) {
  if (paper.recommendationReason?.trim()) return paper.recommendationReason
  if (paper.matchedQueries.length > 0) {
    return `直接命中检索组：${paper.matchedQueries.slice(0, 2).join('、')}。`
  }
  if (paper.keywordMatches.length > 0) {
    return `标题/摘要命中关键词：${paper.keywordMatches.slice(0, 3).join(' / ')}。`
  }
  if (paper.citedByCount >= 100) {
    return '高被引核心论文，适合用来建立该方向的基础文献框架。'
  }
  if (paper.isOpenAccess) {
    return '开放获取且相关度较高，适合优先阅读全文。'
  }
  return '与当前主题保持稳定相关，可作为补充阅读。'
}

function getPrimaryAuthorIds(papers: SearchPaper[]) {
  const seen = new Set<string>()
  const authorIds: string[] = []

  for (const paper of papers) {
    for (const authorId of paper.authorIds.slice(0, 2)) {
      if (authorId && !seen.has(authorId)) {
        seen.add(authorId)
        authorIds.push(authorId)
      }
      if (authorIds.length >= 2) {
        return authorIds
      }
    }
  }

  return authorIds
}

function selectFinalPapers(rankedWorks: SearchPaper[], review: SearchReview) {
  const acceptedIds = new Set(review.acceptedPaperIds)
  const rejectedIds = new Set(review.rejectedPaperIds)

  let selected = rankedWorks.filter(paper => acceptedIds.has(paper.openAlexId))
  const fallbackPool = rankedWorks.filter(paper => {
    if (acceptedIds.has(paper.openAlexId) || rejectedIds.has(paper.openAlexId)) return false
    return (
      paper.relevanceScore >= 0.48 ||
      paper.matchedQueries.length > 0 ||
      paper.matchedConcepts.length > 0 ||
      paper.keywordMatches.length >= 2
    )
  })

  if (selected.length < 6) {
    selected = [...selected, ...fallbackPool].slice(0, 12)
  }

  if (selected.length === 0) {
    selected = rankedWorks
      .filter(paper => !rejectedIds.has(paper.openAlexId))
      .slice(0, 12)
  }

  if (selected.length === 0) {
    selected = rankedWorks.slice(0, 12)
  }

  return selected
}

async function callTool<TResult>(
  toolDef: { execute?: (...args: any[]) => unknown },
  input: unknown,
  abortSignal?: AbortSignal,
) {
  const execute = toolDef.execute
  if (!execute) {
    throw new Error('工具未实现 execute')
  }

  return await Promise.resolve(
    execute(input, {
      toolCallId: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      messages: [],
      abortSignal,
    }),
  ) as TResult
}

function getActiveLiteratureProvider(provider?: LiteratureProviderConfig) {
  return provider || createDefaultLiteratureProviders()[0]
}

async function runLocalFilterAndRank(params: {
  works: SearchPaper[]
  filters: SearchFilters
  queryGroups: QueryExpansionGroup[]
  extraKeywords: string[]
  report?: (event: LiteratureSearchEvent) => void
}) {
  const { works, filters, queryGroups, extraKeywords, report } = params

  const filterResult = await withToolReport(
    {
      name: 'filterWorks',
      displayName: '筛选结果',
      icon: 'filter',
      providerLabel: '本地聚合',
    },
    {
      workCount: works.length,
      filters,
    },
    tool => report?.({ type: 'tool', tool }),
    async () => await filterWorksLocally(works, {
      fromYear: filters.fromYear,
      toYear: filters.toYear,
      minCitations: filters.minCitations,
      openAccessOnly: filters.openAccessOnly,
      sourceTypes: filters.sourceTypes,
      requireAbstract: false,
      relaxIfSparse: true,
    }),
  )

  const ranked = await withToolReport(
    {
      name: 'rankAndDeduplicate',
      displayName: '排序去重',
      icon: 'rank',
      providerLabel: '本地聚合',
    },
    {
      workCount: filterResult.works.length,
      groupCount: queryGroups.length,
    },
    tool => report?.({ type: 'tool', tool }),
    async () => await rankWorksLocally(filterResult.works, queryGroups, extraKeywords),
  )

  return {
    filterResult,
    ranked,
  }
}

async function runLocalRankOnly(params: {
  works: SearchPaper[]
  queryGroups: QueryExpansionGroup[]
  extraKeywords: string[]
  report?: (event: LiteratureSearchEvent) => void
}) {
  const { works, queryGroups, extraKeywords, report } = params
  return await withToolReport(
    {
      name: 'rankAndDeduplicate',
      displayName: '排序去重',
      icon: 'rank',
      providerLabel: '本地聚合',
    },
    {
      workCount: works.length,
      groupCount: queryGroups.length,
    },
    tool => report?.({ type: 'tool', tool }),
    async () => await rankWorksLocally(works, queryGroups, extraKeywords),
  )
}

async function runMcpDiscoveryPass(params: {
  provider: LiteratureProviderConfig
  discoveredTools: LiteratureProviderDiscoveredTool[]
  intent: SearchIntent
  queryGroups: QueryExpansionGroup[]
  filters: SearchFilters
  modelConfig: LiteratureSearchRequest['modelConfig']
  report?: (event: LiteratureSearchEvent) => void
  suggestedQueries?: string[]
}) {
  const { provider, discoveredTools, intent, queryGroups, filters, modelConfig, report, suggestedQueries = [] } = params
  const extraKeywords = [...intent.coreConcepts, ...intent.relatedFields]

  const plan = await planMcpToolCalls({
    phase: 'discovery',
    provider,
    tools: discoveredTools,
    intent,
    queryGroups,
    modelConfig,
    suggestedQueries,
  })

  const executed = await executeMcpToolCalls({
    provider,
    calls: plan.calls,
    report: tool => report?.({ type: 'tool', tool }),
  })

  const extracted = await extractPapersFromMcpResults({
    provider,
    intent,
    queryGroups,
    executions: executed,
    modelConfig,
  })

  const combined = mergeWorks(extracted.papers, queryGroups, extraKeywords)
  const local = await runLocalFilterAndRank({
    works: combined,
    filters,
    queryGroups,
    extraKeywords,
    report,
  })

  return {
    works: combined,
    ranked: local.ranked,
    filterResult: local.filterResult,
    discoveredTools,
    usedTools: uniqueStrings(executed.map(item => item.toolName)),
    notes: uniqueStrings([...plan.rationale, ...extracted.notes]),
  } satisfies McpPassResult
}

async function runMcpAnalysisExpansion(params: {
  provider: LiteratureProviderConfig
  discoveredTools: LiteratureProviderDiscoveredTool[]
  intent: SearchIntent
  queryGroups: QueryExpansionGroup[]
  papers: SearchPaper[]
  modelConfig: LiteratureSearchRequest['modelConfig']
  suggestedQueries?: string[]
  report?: (event: LiteratureSearchEvent) => void
}) {
  const { provider, discoveredTools, intent, queryGroups, papers, modelConfig, suggestedQueries = [], report } = params
  const plan = await planMcpToolCalls({
    phase: 'analysis',
    provider,
    tools: discoveredTools,
    intent,
    queryGroups,
    modelConfig,
    currentPapers: papers,
    suggestedQueries,
  })

  const executed = await executeMcpToolCalls({
    provider,
    calls: plan.calls,
    report: tool => report?.({ type: 'tool', tool }),
  })

  const extracted = await extractPapersFromMcpResults({
    provider,
    intent,
    queryGroups,
    executions: executed,
    modelConfig,
  })

  return {
    works: extracted.papers,
    usedTools: uniqueStrings(executed.map(item => item.toolName)),
    notes: uniqueStrings([...plan.rationale, ...extracted.notes]),
  }
}

async function runDiscoveryPass(
  tools: ReturnType<typeof createOpenAlexToolset>,
  intent: {
    clarifiedQuery: string
    coreConcepts: string[]
    relatedFields: string[]
    preferredYears?: { from?: number; to?: number }
    openAccessOnly?: boolean
  },
  queryGroups: QueryExpansionGroup[],
  filters: SearchFilters,
  abortSignal?: AbortSignal,
): Promise<DiscoveryPassResult> {
  const extraKeywords = [...intent.coreConcepts, ...intent.relatedFields]
  const searchQueries = uniqueStrings(queryGroups.map(group => group.query)).slice(0, 5)

  const keywordSearchResults = await Promise.all(
    searchQueries.map(query =>
      callTool<SearchWorksOutput>(tools.searchWorks, {
        query,
        filters: {
          ...filters,
          maxResults: filters.maxResults || 8,
        },
      }, abortSignal),
    ),
  )

  const conceptTreeResults = await Promise.all(
    intent.coreConcepts.slice(0, 2).map(conceptName =>
      callTool<ConceptTreeOutput>(tools.getConceptTree, { conceptName }, abortSignal),
    ),
  )

  const conceptSearchResults = await Promise.all(
    conceptTreeResults
      .filter(result => result.matched?.id)
      .slice(0, 2)
      .map((result, index) =>
        callTool<SearchWorksOutput>(tools.searchWorks, {
          query: searchQueries[index] || result.matched!.displayName || intent.clarifiedQuery,
          filters: {
            ...filters,
            conceptIds: [result.matched!.id],
            maxResults: Math.min(filters.maxResults || 8, 8),
          },
        }, abortSignal),
      ),
  )

  let combined = mergeWorks(
    [
      ...keywordSearchResults.flatMap(result => result.works),
      ...conceptSearchResults.flatMap(result => result.works),
    ],
    queryGroups,
    extraKeywords,
  )

  const filterResult = await callTool<FilterWorksOutput>(tools.filterWorks, {
    workIds: combined.map(work => work.openAlexId),
    criteria: {
      fromYear: filters.fromYear,
      toYear: filters.toYear,
      minCitations: filters.minCitations,
      openAccessOnly: filters.openAccessOnly,
      sourceTypes: filters.sourceTypes,
      requireAbstract: false,
      relaxIfSparse: true,
    },
  }, abortSignal)

  combined = mergeWorks(filterResult.works, queryGroups, extraKeywords)

  const ranked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
    workList: combined,
    queryGroups,
    extraKeywords,
  }, abortSignal)

  return {
    works: combined,
    ranked,
    filterResult,
  }
}

function ensureActive(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('检索已被用户中断')
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as LiteratureSearchRequest
  const { query, answers, modelConfig, literatureProvider } = body

  if (!modelConfig?.apiKey || !modelConfig?.modelName) {
    return Response.json(
      { error: '请先在设置页配置大参数模型的 API Key 和模型名称' },
      { status: 400 },
    )
  }

  if (!query?.trim()) {
    return Response.json({ error: '请输入检索问题' }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: LiteratureSearchEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        )
      }

      const pushStage = (stage: LiteratureSearchStage, status: StepStatus, detail?: string) => {
        send({
          type: 'stage',
          stage,
          status,
          detail: detail || stageDetail(stage),
        })
      }

      const pushThinking = (stage: LiteratureSearchStage, text: string) => {
        send({
          type: 'thinking',
          bubble: {
            id: `${stage}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            stage,
            text,
          },
        })
      }

      try {
        send({
          type: 'session',
          steps: LITERATURE_SEARCH_STEPS,
        })

        const workRegistry = new Map<string, SearchPaper>()
        const activeProvider = getActiveLiteratureProvider(literatureProvider)
        const openAlexTools = activeProvider.kind === 'openalex'
          ? createOpenAlexToolset({
              signal: req.signal,
              workRegistry,
              report: tool => send({ type: 'tool', tool }),
            })
          : null
        let discoveredTools: LiteratureProviderDiscoveredTool[] = []
        let usedProviderTools: string[] = []
        let providerNotes: string[] = []

        ensureActive(req.signal)
        pushStage('intent', 'in_progress')
        pushThinking('intent', '先判断用户问题是否已经足够具体，决定是否需要答题器补充约束。')
        const intent = await runIntentAgent(query, answers, modelConfig)
        send({ type: 'strategy', intent })

        if (!intent.isClear && (!answers || answers.length === 0)) {
          pushStage('intent', 'waiting', '当前研究意图仍偏宽，需要先完成澄清题。')
          pushThinking('intent', '已生成澄清题，等待补充研究范围、时间窗口和文献类型偏好。')
          send({
            type: 'clarification',
            questions: intent.clarificationQuestions || [],
            intent,
          })
          send({ type: 'done', outcome: 'clarification' })
          controller.close()
          return
        }

        pushStage('intent', 'completed', '检索目标已明确，开始扩展查询策略。')

        ensureActive(req.signal)
        pushStage('expansion', 'in_progress')
        pushThinking('expansion', '正在把核心概念扩成多组关键词，兼顾英文术语、缩写和相邻概念。')
        let activeQueryGroups = await runQueryExpansionAgent(intent, modelConfig)
        send({ type: 'strategy', queryGroups: activeQueryGroups, intent })
        pushStage('expansion', 'completed', `已生成 ${activeQueryGroups.length} 组检索策略。`)

        const baseFilters = buildBaseFilters(intent)
        let retryCount = 0

        ensureActive(req.signal)
        pushStage('parallel-search', 'in_progress')
        pushThinking(
          'parallel-search',
          activeProvider.kind === 'openalex'
            ? '并行拉起关键词检索与概念检索，再根据候选规模决定是否自动放宽条件。'
            : '先自动发现 MCP 工具目录，再让检索 agent 自主决定该用哪些工具。',
        )

        if (activeProvider.kind === 'mcp') {
          const toolListing = await listMcpTools(activeProvider)
          discoveredTools = toolListing.tools
          if (discoveredTools.length === 0) {
            throw new Error('当前 MCP 没有发现可用工具。')
          }
          pushThinking(
            'parallel-search',
            `已从 ${toolListing.serverInfo?.name || activeProvider.name} 自动发现 ${discoveredTools.length} 个工具，检索 agent 会自行挑选。`,
          )
        }

        let discovery = activeProvider.kind === 'openalex' && openAlexTools
          ? await runDiscoveryPass(openAlexTools, intent, activeQueryGroups, baseFilters, req.signal)
          : await runMcpDiscoveryPass({
              provider: activeProvider,
              discoveredTools,
              intent,
              queryGroups: activeQueryGroups,
              filters: baseFilters,
              modelConfig,
              report: send,
            })

        if (activeProvider.kind === 'mcp') {
          usedProviderTools = uniqueStrings([...usedProviderTools, ...(discovery as McpPassResult).usedTools])
          providerNotes = uniqueStrings([...providerNotes, ...(discovery as McpPassResult).notes])
          if ((discovery as McpPassResult).notes[0]) {
            pushThinking('parallel-search', (discovery as McpPassResult).notes[0])
          }
        }

        if (discovery.filterResult.note) {
          pushThinking('parallel-search', discovery.filterResult.note)
        }

        const discoveryRetryReason = assessDiscoveryRetryNeed(discovery.ranked)
        if (discoveryRetryReason) {
          retryCount += 1
          pushThinking('parallel-search', `${discoveryRetryReason}，已自动放宽筛选并补充重检查询。`)
          const retryQueries = buildRetryQueries(intent, activeQueryGroups)
          activeQueryGroups = mergeQueryGroups(
            activeQueryGroups,
            createAdHocQueryGroups(retryQueries, `补充检索 ${retryCount}`),
          )
          send({ type: 'strategy', queryGroups: activeQueryGroups, intent })

          const retryFilters = buildRetryFilters(baseFilters, retryCount)
          const retryPass = activeProvider.kind === 'openalex' && openAlexTools
            ? await runDiscoveryPass(openAlexTools, intent, activeQueryGroups, retryFilters, req.signal)
            : await runMcpDiscoveryPass({
                provider: activeProvider,
                discoveredTools,
                intent,
                queryGroups: activeQueryGroups,
                filters: retryFilters,
                modelConfig,
                report: send,
                suggestedQueries: retryQueries,
              })

          if (retryPass.filterResult.note) {
            pushThinking('parallel-search', retryPass.filterResult.note)
          }

          if (activeProvider.kind === 'mcp') {
            usedProviderTools = uniqueStrings([...usedProviderTools, ...(retryPass as McpPassResult).usedTools])
            providerNotes = uniqueStrings([...providerNotes, ...(retryPass as McpPassResult).notes])
            if ((retryPass as McpPassResult).notes[0]) {
              pushThinking('parallel-search', (retryPass as McpPassResult).notes[0])
            }
          }

          const mergedRetryWorks = mergeWorks(
            [...discovery.works, ...retryPass.works],
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields],
          )

          const reranked = activeProvider.kind === 'openalex' && openAlexTools
            ? await callTool<RankedWorksOutput>(openAlexTools.rankAndDeduplicate, {
                workList: mergedRetryWorks,
                queryGroups: activeQueryGroups,
                extraKeywords: [...intent.coreConcepts, ...intent.relatedFields],
              }, req.signal)
            : await runLocalRankOnly({
                works: mergedRetryWorks,
                queryGroups: activeQueryGroups,
                extraKeywords: [...intent.coreConcepts, ...intent.relatedFields],
                report: send,
              })

          discovery = {
            works: mergedRetryWorks,
            ranked: reranked,
            filterResult: retryPass.filterResult,
          }
        }

        pushStage('parallel-search', 'completed', `初轮检索获得 ${discovery.ranked.works.length} 篇候选文献。`)

        ensureActive(req.signal)
        pushStage('analysis', 'in_progress')
        pushThinking('analysis', '先给候选文献做相关性评分，再用核心论文的引用链做滚雪球扩展。')

        let analysis = await runAnalysisAgent(intent, discovery.ranked.works, modelConfig)
        pushThinking('analysis', analysis.rationale[0] || '已识别出可继续深挖的核心论文与补充查询词。')

        const activeFilters = buildRetryFilters(baseFilters, retryCount)
        let analysisEnriched = applyAnalysisToPapers(discovery.ranked.works, analysis)

        if (activeProvider.kind === 'openalex' && openAlexTools) {
          const reSearchResults = analysis.newQueries.length > 0
            ? await Promise.all(
                analysis.newQueries.map(searchQuery =>
                  callTool<SearchWorksOutput>(openAlexTools.searchWorks, {
                    query: searchQuery,
                    filters: {
                      ...activeFilters,
                      maxResults: Math.max(activeFilters.maxResults || 8, 8),
                    },
                  }, req.signal),
                ),
              )
            : []

          const relatedResults = analysis.corePaperIds.length > 0
            ? await Promise.all(
                analysis.corePaperIds
                  .slice(0, 2)
                  .flatMap(workId => ([
                    callTool<RelatedWorksOutput>(openAlexTools.getRelatedWorks, { workId, direction: 'references', limit: 6 }, req.signal),
                    callTool<RelatedWorksOutput>(openAlexTools.getRelatedWorks, { workId, direction: 'citations', limit: 6 }, req.signal),
                  ])),
              )
            : []

          const authorIds = getPrimaryAuthorIds(analysisEnriched.slice(0, 5))
          const authorResults = authorIds.length > 0
            ? await Promise.all(
                authorIds.map(authorId =>
                  callTool<AuthorWorksOutput>(openAlexTools.getAuthorWorks, {
                    authorId,
                    fromYear: activeFilters.fromYear,
                    limit: 5,
                  }, req.signal),
                ),
              )
            : []

          analysisEnriched = mergeWorks(
            [
              ...analysisEnriched,
              ...reSearchResults.flatMap(result => result.works),
              ...relatedResults.flatMap(result => result.works),
              ...authorResults.flatMap(result => result.works),
            ],
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries],
          )
        } else {
          const expansion = await runMcpAnalysisExpansion({
            provider: activeProvider,
            discoveredTools,
            intent,
            queryGroups: activeQueryGroups,
            papers: analysisEnriched,
            modelConfig,
            suggestedQueries: analysis.newQueries,
            report: send,
          })
          usedProviderTools = uniqueStrings([...usedProviderTools, ...expansion.usedTools])
          providerNotes = uniqueStrings([...providerNotes, ...expansion.notes])
          if (expansion.notes[0]) {
            pushThinking('analysis', expansion.notes[0])
          }

          analysisEnriched = mergeWorks(
            [
              ...analysisEnriched,
              ...expansion.works,
            ],
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries],
          )
        }

        pushStage('analysis', 'completed', `完成二次扩展，当前候选文献 ${analysisEnriched.length} 篇。`)

        ensureActive(req.signal)
        pushStage('aggregation', 'in_progress')
        pushThinking('aggregation', '开始综合排序，并由结果检阅智能体判断是否需要再次重检。')

        let finalRanked = activeProvider.kind === 'openalex' && openAlexTools
          ? await callTool<RankedWorksOutput>(openAlexTools.rankAndDeduplicate, {
              workList: analysisEnriched,
              queryGroups: activeQueryGroups,
              extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries],
            }, req.signal)
          : await runLocalRankOnly({
              works: analysisEnriched,
              queryGroups: activeQueryGroups,
              extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries],
              report: send,
            })

        let review = await runResultReviewAgent(intent, finalRanked.works.slice(0, 12), modelConfig)
        let reviewNotes = uniqueStrings(review.reviewNotes)

        if (reviewNotes.length > 0) {
          pushThinking('aggregation', reviewNotes[0])
        }

        if (review.retryNeeded || selectFinalPapers(finalRanked.works, review).length < 4) {
          retryCount += 1
          pushThinking(
            'aggregation',
            `${review.retryReason || '结果检阅认为当前返回结果仍不足以支撑阅读列表'}，正在自动重检。`,
          )

          const retryQueries = buildRetryQueries(
            intent,
            activeQueryGroups,
            analysis.newQueries,
            review.recommendedQueries,
          )
          activeQueryGroups = mergeQueryGroups(
            activeQueryGroups,
            createAdHocQueryGroups(retryQueries, `结果检阅重检 ${retryCount}`),
          )
          send({ type: 'strategy', queryGroups: activeQueryGroups, intent })

          const reviewRetryFilters = buildRetryFilters(baseFilters, retryCount, review)
          const reviewRetryPass = activeProvider.kind === 'openalex' && openAlexTools
            ? await runDiscoveryPass(
                openAlexTools,
                intent,
                activeQueryGroups,
                reviewRetryFilters,
                req.signal,
              )
            : await runMcpDiscoveryPass({
                provider: activeProvider,
                discoveredTools,
                intent,
                queryGroups: activeQueryGroups,
                filters: reviewRetryFilters,
                modelConfig,
                report: send,
                suggestedQueries: retryQueries,
              })

          reviewNotes = uniqueStrings([
            ...reviewNotes,
            reviewRetryPass.filterResult.note || '',
          ])

          if (activeProvider.kind === 'mcp') {
            usedProviderTools = uniqueStrings([...usedProviderTools, ...(reviewRetryPass as McpPassResult).usedTools])
            providerNotes = uniqueStrings([...providerNotes, ...(reviewRetryPass as McpPassResult).notes])
            reviewNotes = uniqueStrings([...reviewNotes, ...(reviewRetryPass as McpPassResult).notes])
          }

          let recheckedWorks = mergeWorks(
            [...analysisEnriched, ...reviewRetryPass.works],
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
          )

          const recheckedRanked = activeProvider.kind === 'openalex' && openAlexTools
            ? await callTool<RankedWorksOutput>(openAlexTools.rankAndDeduplicate, {
                workList: recheckedWorks,
                queryGroups: activeQueryGroups,
                extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
              }, req.signal)
            : await runLocalRankOnly({
                works: recheckedWorks,
                queryGroups: activeQueryGroups,
                extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
                report: send,
              })

          analysis = await runAnalysisAgent(intent, recheckedRanked.works, modelConfig)
          recheckedWorks = applyAnalysisToPapers(recheckedRanked.works, analysis)

          analysisEnriched = mergeWorks(
            recheckedWorks,
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
          )

          finalRanked = activeProvider.kind === 'openalex' && openAlexTools
            ? await callTool<RankedWorksOutput>(openAlexTools.rankAndDeduplicate, {
                workList: analysisEnriched,
                queryGroups: activeQueryGroups,
                extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
              }, req.signal)
            : await runLocalRankOnly({
                works: analysisEnriched,
                queryGroups: activeQueryGroups,
                extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
                report: send,
              })

          review = await runResultReviewAgent(intent, finalRanked.works.slice(0, 12), modelConfig)
          reviewNotes = uniqueStrings([...reviewNotes, ...review.reviewNotes])
        }

        const finalPapers = selectFinalPapers(finalRanked.works, review)
          .slice(0, 12)
          .map(paper => ({
            ...paper,
            recommendationReason: fillRecommendationReason(paper),
          }))

        const summary = `${buildSearchSummary(intent, analysis, finalPapers)}${retryCount > 0 ? ` 系统已自动重检 ${retryCount} 次。` : ''}`

        send({
          type: 'results',
          payload: {
            summary,
            papers: finalPapers,
            totalCandidates: analysisEnriched.length,
            duplicatesRemoved: finalRanked.duplicatesRemoved,
            queryGroups: activeQueryGroups,
            intent,
            reviewNotes: reviewNotes.slice(0, 4),
            retryCount,
            provider: {
              id: activeProvider.id,
              name: activeProvider.name,
              kind: activeProvider.kind,
              transport: activeProvider.transport,
              discoveredTools: discoveredTools.map(tool => tool.name),
              usedTools: uniqueStrings(usedProviderTools),
              notes: uniqueStrings(providerNotes).slice(0, 4),
            },
          },
        })
        pushStage(
          'aggregation',
          'completed',
          `最终输出 ${finalPapers.length} 篇推荐文献${retryCount > 0 ? `，自动重检 ${retryCount} 次` : ''}。`,
        )
        send({ type: 'done', outcome: 'results' })
        controller.close()
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : '论文检索失败',
        })
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
}
