import { NextRequest } from 'next/server'
import { createOpenAlexToolset } from '@/lib/openalexTools'
import { scoreKeywordMatches } from '@/lib/openalex'
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
  SearchPaper,
  SearchReview,
  SearchWorksOutput,
  StepStatus,
} from '@/lib/literatureSearchTypes'
import { LITERATURE_SEARCH_STEPS } from '@/lib/literatureSearchTypes'

export const maxDuration = 120

interface DiscoveryPassResult {
  works: SearchPaper[]
  ranked: RankedWorksOutput
  filterResult: FilterWorksOutput
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
  onProgress?: (message: string) => void,
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
  onProgress?.(`关键词检索已返回 ${keywordSearchResults.reduce((sum, result) => sum + result.works.length, 0)} 篇候选。`)

  const conceptTreeResults = await Promise.all(
    intent.coreConcepts.slice(0, 2).map(conceptName =>
      callTool<ConceptTreeOutput>(tools.getConceptTree, { conceptName }, abortSignal),
    ),
  )
  onProgress?.(`概念扩展完成，命中 ${conceptTreeResults.filter(result => result.matched?.id).length} 个概念节点。`)

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
  onProgress?.(`概念检索补充 ${conceptSearchResults.reduce((sum, result) => sum + result.works.length, 0)} 篇候选。`)

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
  onProgress?.(`筛选阶段保留 ${filterResult.works.length} 篇候选文献。`)

  combined = mergeWorks(filterResult.works, queryGroups, extraKeywords)

  const ranked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
    workList: combined,
    queryGroups,
    extraKeywords,
  }, abortSignal)
  onProgress?.(`重排去重后保留 ${ranked.works.length} 篇候选，去除重复 ${ranked.duplicatesRemoved} 篇。`)

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
  const { query, answers, modelConfig } = body

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
      let lastEventAt = Date.now()
      let heartbeatStage: LiteratureSearchStage = 'intent'
      let heartbeatIndex = 0
      const heartbeatHints: Record<LiteratureSearchStage, string[]> = {
        intent: [
          'Working... 正在等待意图分析模型返回澄清结果。',
          'Working... 正在整理研究目标、核心概念与时间窗口。',
        ],
        expansion: [
          'Working... 正在扩展同义词、近义术语和多语关键词。',
          'Working... 正在组织多组检索表达式。',
        ],
        'parallel-search': [
          'Working... OpenAlex 正在返回关键词检索结果。',
          'Working... 正在汇总并行检索批次的候选文献。',
        ],
        analysis: [
          'Working... 正在执行滚雪球扩展与作者追踪。',
          'Working... 正在补充分析阶段的关联证据。',
        ],
        aggregation: [
          'Working... 正在检阅结果质量并准备最终推荐。',
          'Working... 正在生成结果摘要与阅读建议。',
        ],
      }
      const heartbeatEnabledStages = new Set<LiteratureSearchStage>([
        'parallel-search',
        'analysis',
        'aggregation',
      ])

      const send = (event: LiteratureSearchEvent) => {
        lastEventAt = Date.now()
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        )
      }

      const pushStage = (stage: LiteratureSearchStage, status: StepStatus, detail?: string) => {
        if (status === 'in_progress') {
          heartbeatStage = stage
        }
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

      const heartbeat = setInterval(() => {
        if (!heartbeatEnabledStages.has(heartbeatStage)) return
        if (Date.now() - lastEventAt < 2800) return
        const hints = heartbeatHints[heartbeatStage]
        const message = hints[heartbeatIndex % hints.length]
        heartbeatIndex += 1
        pushThinking(heartbeatStage, message)
      }, 3000)

      try {
        send({
          type: 'session',
          steps: LITERATURE_SEARCH_STEPS,
        })

        const workRegistry = new Map<string, SearchPaper>()
        const tools = createOpenAlexToolset({
          signal: req.signal,
          workRegistry,
          report: tool => send({ type: 'tool', tool }),
        })

        ensureActive(req.signal)
        pushStage('intent', 'in_progress')
        pushThinking('intent', '先判断用户问题是否已经足够具体，决定是否需要答题器补充约束。')
        const intent = await runIntentAgent(query, answers, modelConfig)
        send({ type: 'strategy', intent })

        if (!intent.isClear && (!answers || answers.length === 0)) {
          pushStage('intent', 'waiting', '当前研究意图仍偏宽，需要先完成澄清题。')
          send({
            type: 'clarification',
            questions: intent.clarificationQuestions || [],
            intent,
          })
          send({ type: 'done', outcome: 'clarification' })
          clearInterval(heartbeat)
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
        pushThinking('parallel-search', '并行拉起关键词检索与概念检索，再根据候选规模决定是否自动放宽条件。')

        let discovery = await runDiscoveryPass(
          tools,
          intent,
          activeQueryGroups,
          baseFilters,
          message => pushThinking('parallel-search', message),
          req.signal,
        )

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
          const retryPass = await runDiscoveryPass(
            tools,
            intent,
            activeQueryGroups,
            retryFilters,
            message => pushThinking('parallel-search', message),
            req.signal,
          )

          if (retryPass.filterResult.note) {
            pushThinking('parallel-search', retryPass.filterResult.note)
          }

          const mergedRetryWorks = mergeWorks(
            [...discovery.works, ...retryPass.works],
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields],
          )

          const reranked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
            workList: mergedRetryWorks,
            queryGroups: activeQueryGroups,
            extraKeywords: [...intent.coreConcepts, ...intent.relatedFields],
          }, req.signal)

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

        const reSearchResults = analysis.newQueries.length > 0
          ? await Promise.all(
              analysis.newQueries.map(searchQuery =>
                callTool<SearchWorksOutput>(tools.searchWorks, {
                  query: searchQuery,
                  filters: {
                    ...activeFilters,
                    maxResults: Math.max(activeFilters.maxResults || 8, 8),
                  },
                }, req.signal),
              ),
            )
          : []
        if (reSearchResults.length > 0) {
          pushThinking('analysis', `补充检索新增 ${reSearchResults.reduce((sum, result) => sum + result.works.length, 0)} 篇候选。`)
        }

        const relatedResults = analysis.corePaperIds.length > 0
          ? await Promise.all(
              analysis.corePaperIds
                .slice(0, 2)
                .flatMap(workId => ([
                  callTool<RelatedWorksOutput>(tools.getRelatedWorks, { workId, direction: 'references', limit: 6 }, req.signal),
                  callTool<RelatedWorksOutput>(tools.getRelatedWorks, { workId, direction: 'citations', limit: 6 }, req.signal),
                ])),
            )
          : []
        if (relatedResults.length > 0) {
          pushThinking('analysis', `关联文献扩展新增 ${relatedResults.reduce((sum, result) => sum + result.works.length, 0)} 篇候选。`)
        }

        const authorIds = getPrimaryAuthorIds(analysisEnriched.slice(0, 5))
        const authorResults = authorIds.length > 0
          ? await Promise.all(
              authorIds.map(authorId =>
                callTool<AuthorWorksOutput>(tools.getAuthorWorks, {
                  authorId,
                  fromYear: activeFilters.fromYear,
                  limit: 5,
                }, req.signal),
              ),
            )
          : []
        if (authorResults.length > 0) {
          pushThinking('analysis', `作者追踪补充 ${authorResults.reduce((sum, result) => sum + result.works.length, 0)} 篇候选。`)
        }

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

        pushStage('analysis', 'completed', `完成二次扩展，当前候选文献 ${analysisEnriched.length} 篇。`)

        ensureActive(req.signal)
        pushStage('aggregation', 'in_progress')
        pushThinking('aggregation', '开始综合排序，并由结果检阅智能体判断是否需要再次重检。')

        let finalRanked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
          workList: analysisEnriched,
          queryGroups: activeQueryGroups,
          extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries],
        }, req.signal)

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
          const reviewRetryPass = await runDiscoveryPass(
            tools,
            intent,
            activeQueryGroups,
            reviewRetryFilters,
            message => pushThinking('aggregation', message),
            req.signal,
          )

          reviewNotes = uniqueStrings([
            ...reviewNotes,
            reviewRetryPass.filterResult.note || '',
          ])

          let recheckedWorks = mergeWorks(
            [...analysisEnriched, ...reviewRetryPass.works],
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
          )

          const recheckedRanked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
            workList: recheckedWorks,
            queryGroups: activeQueryGroups,
            extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
          }, req.signal)

          analysis = await runAnalysisAgent(intent, recheckedRanked.works, modelConfig)
          recheckedWorks = applyAnalysisToPapers(recheckedRanked.works, analysis)

          analysisEnriched = mergeWorks(
            recheckedWorks,
            activeQueryGroups,
            [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
          )

          finalRanked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
            workList: analysisEnriched,
            queryGroups: activeQueryGroups,
            extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries, ...review.recommendedQueries],
          }, req.signal)

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
          },
        })
        pushStage(
          'aggregation',
          'completed',
          `最终输出 ${finalPapers.length} 篇推荐文献${retryCount > 0 ? `，自动重检 ${retryCount} 次` : ''}。`,
        )
        send({ type: 'done', outcome: 'results' })
        clearInterval(heartbeat)
        controller.close()
      } catch (error) {
        clearInterval(heartbeat)
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
