import { NextRequest } from 'next/server'
import { createOpenAlexToolset } from '@/lib/openalexTools'
import { scoreKeywordMatches } from '@/lib/openalex'
import {
  applyAnalysisToPapers,
  buildSearchSummary,
  runAnalysisAgent,
  runIntentAgent,
  runQueryExpansionAgent,
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
  SearchWorksOutput,
  StepStatus,
} from '@/lib/literatureSearchTypes'
import { LITERATURE_SEARCH_STEPS } from '@/lib/literatureSearchTypes'

export const maxDuration = 120

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
        const queryGroups = await runQueryExpansionAgent(intent, modelConfig)
        send({ type: 'strategy', queryGroups, intent })
        pushStage('expansion', 'completed', `已生成 ${queryGroups.length} 组检索策略。`)

        ensureActive(req.signal)
        pushStage('parallel-search', 'in_progress')
        pushThinking('parallel-search', '并行拉起关键词检索与概念检索，再用候选核心作者补充该方向代表性工作。')

        const baseFilters = buildBaseFilters(intent)

        const keywordSearchResults = await Promise.all(
          queryGroups.map(group =>
            callTool<SearchWorksOutput>(tools.searchWorks, {
              query: group.query,
              filters: {
                ...baseFilters,
                maxResults: 8,
              },
            }, req.signal),
          ),
        )

        const conceptTreeResults = await Promise.all(
          intent.coreConcepts.slice(0, 2).map(conceptName =>
            callTool<ConceptTreeOutput>(tools.getConceptTree, { conceptName }, req.signal),
          ),
        )

        const conceptSearchResults = await Promise.all(
          conceptTreeResults
            .filter(result => result.matched?.id)
            .slice(0, 2)
            .map((result, index) =>
              callTool<SearchWorksOutput>(tools.searchWorks, {
                query: queryGroups[index]?.query || result.matched?.displayName || intent.clarifiedQuery,
                filters: {
                  ...baseFilters,
                  conceptIds: [result.matched!.id],
                  maxResults: 6,
                },
              }, req.signal),
            ),
        )

        let combined = mergeWorks(
          [
            ...keywordSearchResults.flatMap(result => result.works),
            ...conceptSearchResults.flatMap(result => result.works),
          ],
          queryGroups,
          [...intent.coreConcepts, ...intent.relatedFields],
        )

        const filteredInitial = await callTool<FilterWorksOutput>(tools.filterWorks, {
          workIds: combined.map(work => work.openAlexId),
          criteria: {
            fromYear: intent.preferredYears?.from,
            toYear: intent.preferredYears?.to,
            minCitations: baseFilters.minCitations,
            openAccessOnly: intent.openAccessOnly,
            requireAbstract: false,
            relaxIfSparse: true,
          },
        }, req.signal)

        combined = mergeWorks(
          filteredInitial.works,
          queryGroups,
          [...intent.coreConcepts, ...intent.relatedFields],
        )

        const preliminaryRanked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
          workList: combined,
          queryGroups,
          extraKeywords: [...intent.coreConcepts, ...intent.relatedFields],
        }, req.signal)

        pushStage('parallel-search', 'completed', `初轮检索获得 ${preliminaryRanked.works.length} 篇候选文献。`)

        ensureActive(req.signal)
        pushStage('analysis', 'in_progress')
        pushThinking('analysis', '先给候选文献做相关性评分，再用核心论文的引用链做滚雪球扩展。')

        const analysis = await runAnalysisAgent(intent, preliminaryRanked.works, modelConfig)
        pushThinking('analysis', analysis.rationale[0] || '已识别出可继续深挖的核心论文与补充查询词。')

        let analysisEnriched = applyAnalysisToPapers(preliminaryRanked.works, analysis)

        const reSearchResults = analysis.newQueries.length > 0
          ? await Promise.all(
              analysis.newQueries.map(searchQuery =>
                callTool<SearchWorksOutput>(tools.searchWorks, {
                  query: searchQuery,
                  filters: {
                    ...baseFilters,
                    maxResults: 6,
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
                  callTool<RelatedWorksOutput>(tools.getRelatedWorks, { workId, direction: 'references', limit: 6 }, req.signal),
                  callTool<RelatedWorksOutput>(tools.getRelatedWorks, { workId, direction: 'citations', limit: 6 }, req.signal),
                ])),
            )
          : []

        const authorIds = getPrimaryAuthorIds(analysisEnriched.slice(0, 5))
        const authorResults = authorIds.length > 0
          ? await Promise.all(
              authorIds.map(authorId =>
                callTool<AuthorWorksOutput>(tools.getAuthorWorks, {
                  authorId,
                  fromYear: intent.preferredYears?.from,
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
          queryGroups,
          [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries],
        )

        pushStage('analysis', 'completed', `完成二次扩展，当前候选文献 ${analysisEnriched.length} 篇。`)

        ensureActive(req.signal)
        pushStage('aggregation', 'in_progress')
        pushThinking('aggregation', '开始按相关性、被引、新颖性和开放获取综合排序，并补齐推荐理由。')

        const finalRanked = await callTool<RankedWorksOutput>(tools.rankAndDeduplicate, {
          workList: analysisEnriched,
          queryGroups,
          extraKeywords: [...intent.coreConcepts, ...intent.relatedFields, ...analysis.newQueries],
        }, req.signal)

        const finalPapers = finalRanked.works
          .slice(0, 12)
          .map(paper => ({
            ...paper,
            recommendationReason: fillRecommendationReason(paper),
          }))

        const summary = buildSearchSummary(intent, analysis, finalPapers)

        send({
          type: 'results',
          payload: {
            summary,
            papers: finalPapers,
            totalCandidates: analysisEnriched.length,
            duplicatesRemoved: finalRanked.duplicatesRemoved,
            queryGroups,
            intent,
          },
        })
        pushStage('aggregation', 'completed', `最终输出 ${finalPapers.length} 篇推荐文献。`)
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
