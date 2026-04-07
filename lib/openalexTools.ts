import { jsonSchema, tool } from 'ai'
import {
  fetchWorksByIds,
  getAuthorWorksFromOpenAlex,
  getConceptTreeFromOpenAlex,
  getRelatedWorksFromOpenAlex,
  scoreKeywordMatches,
  searchWorksOnOpenAlex,
} from './openalex'
import type {
  FilterCriteria,
  FilterWorksOutput,
  QueryExpansionGroup,
  RankedWorksOutput,
  SearchPaper,
  SearchWorksOutput,
  ToolCallEvent,
} from './literatureSearchTypes'

type ToolReporter = (event: ToolCallEvent) => void

interface ToolContext {
  signal?: AbortSignal
  report?: ToolReporter
  workRegistry: Map<string, SearchPaper>
}

const paperSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    openAlexId: { type: 'string' },
    title: { type: 'string' },
    abstract: { type: 'string' },
    abstractSnippet: { type: 'string' },
    authors: { type: 'array', items: { type: 'string' } },
    authorIds: { type: 'array', items: { type: 'string' } },
    year: { type: 'number' },
    publicationDate: { type: 'string' },
    venue: { type: 'string' },
    doi: { type: 'string' },
    url: { type: 'string' },
    pdfUrl: { type: 'string' },
    citedByCount: { type: 'number' },
    isOpenAccess: { type: 'boolean' },
    oaStatus: { type: 'string' },
    sourceType: { type: 'string' },
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          displayName: { type: 'string' },
          level: { type: 'number' },
          description: { type: 'string' },
        },
        required: ['id', 'displayName'],
      },
    },
    topics: { type: 'array', items: { type: 'string' } },
    keywordMatches: { type: 'array', items: { type: 'string' } },
    matchedQueries: { type: 'array', items: { type: 'string' } },
    matchedConcepts: { type: 'array', items: { type: 'string' } },
    relevanceScore: { type: 'number' },
    citationScore: { type: 'number' },
    noveltyScore: { type: 'number' },
    openAccessScore: { type: 'number' },
    finalScore: { type: 'number' },
    recommendationReason: { type: 'string' },
  },
  required: [
    'id',
    'openAlexId',
    'title',
    'abstract',
    'abstractSnippet',
    'authors',
    'authorIds',
    'citedByCount',
    'isOpenAccess',
    'concepts',
    'topics',
    'keywordMatches',
    'matchedQueries',
    'matchedConcepts',
    'relevanceScore',
    'citationScore',
    'noveltyScore',
    'openAccessScore',
    'finalScore',
  ],
} as const

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value

  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[${value.length} items]`
    }

    if (value.length <= 6) {
      return value.map(item => summarizeValue(item, depth + 1))
    }

    return [
      ...value.slice(0, 3).map(item => summarizeValue(item, depth + 1)),
      `...(+${value.length - 3})`,
    ]
  }

  if (typeof value === 'object') {
    if (depth >= 2) {
      return '[object]'
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        summarizeValue(entry, depth + 1),
      ]),
    )
  }

  return String(value)
}

function summarizeInput(input: unknown) {
  return JSON.stringify(summarizeValue(input))
}

function getResultCount(result: unknown) {
  if (Array.isArray(result)) return result.length
  if (result && typeof result === 'object') {
    if ('works' in result && Array.isArray((result as { works?: unknown[] }).works)) {
      return (result as { works: unknown[] }).works.length
    }
    if ('count' in result && typeof (result as { count?: unknown }).count === 'number') {
      return (result as { count: number }).count
    }
  }
  return undefined
}

function indexWorks(registry: Map<string, SearchPaper>, works: SearchPaper[]) {
  for (const work of works) {
    registry.set(work.id, work)
    registry.set(work.openAlexId, work)
    if (work.doi) {
      registry.set(work.doi.toLowerCase(), work)
    }
  }
}

function normalizeCitations(works: SearchPaper[]) {
  const maxCitations = Math.max(...works.map(work => work.citedByCount), 1)
  return works.map(work => ({
    ...work,
    citationScore: Math.min(1, work.citedByCount / maxCitations),
  }))
}

function normalizeNovelty(works: SearchPaper[]) {
  const years = works.map(work => work.year).filter((year): year is number => typeof year === 'number')
  const minYear = years.length ? Math.min(...years) : new Date().getFullYear() - 10
  const maxYear = years.length ? Math.max(...years) : new Date().getFullYear()
  const span = Math.max(1, maxYear - minYear)

  return works.map(work => ({
    ...work,
    noveltyScore: work.year ? Math.max(0, (work.year - minYear) / span) : 0,
  }))
}

function deduplicateRankableWorks(works: SearchPaper[]) {
  const map = new Map<string, SearchPaper>()

  for (const work of works) {
    const key = (work.doi || work.openAlexId).toLowerCase()
    const current = map.get(key)
    if (!current || current.finalScore < work.finalScore || current.citedByCount < work.citedByCount) {
      map.set(key, work)
    }
  }

  return Array.from(map.values())
}

function applyCriteria(works: SearchPaper[], criteria: FilterCriteria) {
  return works.filter(work => {
    if (criteria.fromYear && (!work.year || work.year < criteria.fromYear)) {
      return false
    }
    if (criteria.toYear && (!work.year || work.year > criteria.toYear)) {
      return false
    }
    if (criteria.minCitations && work.citedByCount < criteria.minCitations) {
      return false
    }
    if (criteria.openAccessOnly && !work.isOpenAccess) {
      return false
    }
    if (criteria.sourceTypes?.length && (!work.sourceType || !criteria.sourceTypes.includes(work.sourceType as 'journal' | 'conference' | 'repository'))) {
      return false
    }
    if (criteria.requireAbstract && !work.abstract.trim()) {
      return false
    }
    return true
  })
}

function buildRelaxedCriteriaVariants(criteria: FilterCriteria): Array<{ criteria: FilterCriteria; note: string }> {
  const loosenedCitation = criteria.minCitations
    ? Math.max(0, Math.floor(criteria.minCitations * 0.5))
    : 0
  const widenedFromYear = criteria.fromYear ? Math.max(1900, criteria.fromYear - 3) : undefined
  const widenedToYear = criteria.toYear ? criteria.toYear + 1 : undefined

  return [
    {
      criteria: {
        ...criteria,
        minCitations: loosenedCitation,
        openAccessOnly: false,
      },
      note: '结果偏少，已放宽引用量与开放获取限制。',
    },
    {
      criteria: {
        ...criteria,
        minCitations: 0,
        openAccessOnly: false,
        fromYear: widenedFromYear,
        toYear: widenedToYear,
      },
      note: '结果仍偏少，已进一步放宽年份范围并取消最低引用要求。',
    },
    {
      criteria: {
        ...criteria,
        minCitations: 0,
        openAccessOnly: false,
        fromYear: undefined,
        toYear: undefined,
        sourceTypes: undefined,
        requireAbstract: false,
      },
      note: '结果持续稀疏，已切换到宽松筛选以保留更多候选供后续检阅。',
    },
  ]
}

async function runToolWithReport<T>(
  name: ToolCallEvent['name'],
  input: unknown,
  context: ToolContext,
  runner: () => Promise<T>,
) {
  const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  context.report?.({
    id,
    name,
    status: 'running',
    inputSummary: summarizeInput(input),
  })

  try {
    const result = await runner()
    context.report?.({
      id,
      name,
      status: 'completed',
      inputSummary: summarizeInput(input),
      resultCount: getResultCount(result),
      output: result,
    })
    return result
  } catch (error) {
    context.report?.({
      id,
      name,
      status: 'error',
      inputSummary: summarizeInput(input),
      note: error instanceof Error ? error.message : '工具调用失败',
    })
    throw error
  }
}

export function createOpenAlexToolset(context: ToolContext) {
  const searchWorks = tool({
    description: '按关键词、作者、概念和时间范围搜索 OpenAlex works。',
    inputSchema: jsonSchema<{
      query: string
      filters?: {
        fromYear?: number
        toYear?: number
        minCitations?: number
        maxResults?: number
        openAccessOnly?: boolean
        sourceTypes?: Array<'journal' | 'conference' | 'repository'>
        conceptIds?: string[]
        authorIds?: string[]
        sortBy?: 'relevance' | 'citations' | 'date'
        searchMode?: 'keyword' | 'exact' | 'semantic'
      }
    }>({
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词或布尔查询语句。' },
        filters: {
          type: 'object',
          properties: {
            fromYear: { type: 'number' },
            toYear: { type: 'number' },
            minCitations: { type: 'number' },
            maxResults: { type: 'number' },
            openAccessOnly: { type: 'boolean' },
            sourceTypes: {
              type: 'array',
              items: { type: 'string', enum: ['journal', 'conference', 'repository'] },
            },
            conceptIds: { type: 'array', items: { type: 'string' } },
            authorIds: { type: 'array', items: { type: 'string' } },
            sortBy: { type: 'string', enum: ['relevance', 'citations', 'date'] },
            searchMode: { type: 'string', enum: ['keyword', 'exact', 'semantic'] },
          },
        },
      },
      required: ['query'],
    }),
    outputSchema: jsonSchema<SearchWorksOutput>({
      type: 'object',
      properties: {
        queryUsed: { type: 'string' },
        filtersApplied: { type: 'object' },
        count: { type: 'number' },
        works: { type: 'array', items: paperSchema },
      },
      required: ['queryUsed', 'filtersApplied', 'count', 'works'],
    }),
    execute: async ({ query, filters }) => runToolWithReport('searchWorks', { query, filters }, context, async () => {
      const result = await searchWorksOnOpenAlex(query, filters, context.signal)
      indexWorks(context.workRegistry, result.works)
      return result
    }),
  })

  const getConceptTree = tool({
    description: '查询 OpenAlex Concepts 体系，返回最匹配概念及其上位、近邻概念。',
    inputSchema: jsonSchema<{ conceptName: string }>({
      type: 'object',
      properties: {
        conceptName: { type: 'string', description: '要查询的概念名称。' },
      },
      required: ['conceptName'],
    }),
    outputSchema: jsonSchema({
      type: 'object',
      properties: {
        conceptName: { type: 'string' },
        matched: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            displayName: { type: 'string' },
            level: { type: 'number' },
            description: { type: 'string' },
          },
        },
        ancestors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              displayName: { type: 'string' },
              level: { type: 'number' },
              description: { type: 'string' },
            },
            required: ['id', 'displayName'],
          },
        },
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              displayName: { type: 'string' },
              level: { type: 'number' },
              description: { type: 'string' },
            },
            required: ['id', 'displayName'],
          },
        },
      },
      required: ['conceptName', 'ancestors', 'children'],
    }),
    execute: async ({ conceptName }) =>
      runToolWithReport('getConceptTree', { conceptName }, context, async () =>
        await getConceptTreeFromOpenAlex(conceptName, context.signal),
      ),
  })

  const getRelatedWorks = tool({
    description: '基于某篇论文向前追溯参考文献、向后扩展被引论文，或获取近邻相关论文。',
    inputSchema: jsonSchema<{
      workId: string
      direction: 'references' | 'citations' | 'related'
      limit?: number
    }>({
      type: 'object',
      properties: {
        workId: { type: 'string', description: 'OpenAlex work id。' },
        direction: { type: 'string', enum: ['references', 'citations', 'related'] },
        limit: { type: 'number' },
      },
      required: ['workId', 'direction'],
    }),
    outputSchema: jsonSchema({
      type: 'object',
      properties: {
        workId: { type: 'string' },
        direction: { type: 'string', enum: ['references', 'citations', 'related'] },
        count: { type: 'number' },
        works: { type: 'array', items: paperSchema },
      },
      required: ['workId', 'direction', 'count', 'works'],
    }),
    execute: async ({ workId, direction, limit }) => runToolWithReport(
      'getRelatedWorks',
      { workId, direction, limit },
      context,
      async () => {
        const result = await getRelatedWorksFromOpenAlex(workId, direction, limit, context.signal)
        indexWorks(context.workRegistry, result.works)
        return result
      },
    ),
  })

  const filterWorks = tool({
    description: '按年份、引用量、开放获取和文献载体对候选 works 进行筛选，必要时自动放宽条件。',
    inputSchema: jsonSchema<{
      workIds: string[]
      criteria: FilterCriteria
    }>({
      type: 'object',
      properties: {
        workIds: {
          type: 'array',
          items: { type: 'string' },
          description: '待筛选的 OpenAlex work id 列表。',
        },
        criteria: {
          type: 'object',
          properties: {
            fromYear: { type: 'number' },
            toYear: { type: 'number' },
            minCitations: { type: 'number' },
            openAccessOnly: { type: 'boolean' },
            sourceTypes: {
              type: 'array',
              items: { type: 'string', enum: ['journal', 'conference', 'repository'] },
            },
            requireAbstract: { type: 'boolean' },
            relaxIfSparse: { type: 'boolean' },
          },
        },
      },
      required: ['workIds', 'criteria'],
    }),
    outputSchema: jsonSchema<FilterWorksOutput>({
      type: 'object',
      properties: {
        count: { type: 'number' },
        works: { type: 'array', items: paperSchema },
        criteriaApplied: { type: 'object' },
        relaxed: { type: 'boolean' },
        note: { type: 'string' },
      },
      required: ['count', 'works', 'criteriaApplied', 'relaxed'],
    }),
    execute: async ({ workIds, criteria }) => runToolWithReport('filterWorks', { workIds, criteria }, context, async () => {
      const cached = workIds
        .map(id => context.workRegistry.get(id))
        .filter(Boolean) as SearchPaper[]
      const missingIds = workIds.filter(id => !context.workRegistry.has(id))
      const fetched = missingIds.length > 0 ? await fetchWorksByIds(missingIds, context.signal) : []
      indexWorks(context.workRegistry, fetched)

      const allWorks = [...cached, ...fetched]
      let filtered = applyCriteria(allWorks, criteria)
      let relaxed = false
      let note: string | undefined

      if (filtered.length < 5 && criteria.relaxIfSparse) {
        let best = {
          works: filtered,
          criteria,
          note,
        }

        for (const variant of buildRelaxedCriteriaVariants(criteria)) {
          const nextWorks = applyCriteria(allWorks, variant.criteria)
          if (nextWorks.length > best.works.length) {
            best = {
              works: nextWorks,
              criteria: variant.criteria,
              note: variant.note,
            }
          }
          if (nextWorks.length >= 5) {
            break
          }
        }

        filtered = best.works
        relaxed = best.criteria !== criteria
        note = best.note

        return {
          count: filtered.length,
          works: filtered,
          criteriaApplied: best.criteria,
          relaxed,
          note,
        }
      }

      return {
        count: filtered.length,
        works: filtered,
        criteriaApplied: criteria,
        relaxed,
        note,
      }
    }),
  })

  const getAuthorWorks = tool({
    description: '按作者 id 获取其代表性论文，用于锁定该方向的核心作者。',
    inputSchema: jsonSchema<{
      authorId: string
      fromYear?: number
      limit?: number
    }>({
      type: 'object',
      properties: {
        authorId: { type: 'string', description: 'OpenAlex author id。' },
        fromYear: { type: 'number' },
        limit: { type: 'number' },
      },
      required: ['authorId'],
    }),
    outputSchema: jsonSchema({
      type: 'object',
      properties: {
        authorId: { type: 'string' },
        authorName: { type: 'string' },
        count: { type: 'number' },
        works: { type: 'array', items: paperSchema },
      },
      required: ['authorId', 'count', 'works'],
    }),
    execute: async ({ authorId, fromYear, limit }) => runToolWithReport(
      'getAuthorWorks',
      { authorId, fromYear, limit },
      context,
      async () => {
        const result = await getAuthorWorksFromOpenAlex(authorId, { fromYear, limit }, context.signal)
        indexWorks(context.workRegistry, result.works)
        return result
      },
    ),
  })

  const rankAndDeduplicate = tool({
    description: '按语义相关性、引用量、新颖性和开放获取四个维度综合排序并去重。',
    inputSchema: jsonSchema<{
      workList: SearchPaper[]
      queryGroups?: QueryExpansionGroup[]
      extraKeywords?: string[]
    }>({
      type: 'object',
      properties: {
        workList: { type: 'array', items: paperSchema },
        queryGroups: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              focus: { type: 'string' },
              query: { type: 'string' },
              synonyms: { type: 'array', items: { type: 'string' } },
              relatedConcepts: { type: 'array', items: { type: 'string' } },
              multilingualKeywords: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'label', 'focus', 'query', 'synonyms', 'relatedConcepts', 'multilingualKeywords'],
          },
        },
        extraKeywords: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['workList'],
    }),
    outputSchema: jsonSchema<RankedWorksOutput>({
      type: 'object',
      properties: {
        count: { type: 'number' },
        duplicatesRemoved: { type: 'number' },
        works: { type: 'array', items: paperSchema },
      },
      required: ['count', 'duplicatesRemoved', 'works'],
    }),
    execute: async ({ workList, queryGroups = [], extraKeywords = [] }) => runToolWithReport(
      'rankAndDeduplicate',
      { workCount: workList.length, groupCount: queryGroups.length },
      context,
      async () => {
        const unique = deduplicateRankableWorks(workList)
        const citationNormalized = normalizeCitations(unique)
        const noveltyNormalized = normalizeNovelty(citationNormalized)
        const enriched = noveltyNormalized.map(work => {
          const lexical = scoreKeywordMatches(work, queryGroups, extraKeywords)
          const relevanceScore = work.relevanceScore > 0
            ? work.relevanceScore
            : lexical.lexicalScore

          return {
            ...work,
            keywordMatches: Array.from(new Set([...work.keywordMatches, ...lexical.keywordMatches])),
            matchedQueries: Array.from(new Set([...work.matchedQueries, ...lexical.matchedQueries])),
            matchedConcepts: Array.from(new Set([...work.matchedConcepts, ...lexical.matchedConcepts])),
            relevanceScore,
            finalScore:
              relevanceScore * 0.4 +
              work.citationScore * 0.3 +
              work.noveltyScore * 0.2 +
              work.openAccessScore * 0.1,
          }
        })

        const ranked = [...enriched].sort((left, right) => right.finalScore - left.finalScore)
        return {
          count: ranked.length,
          duplicatesRemoved: Math.max(0, workList.length - unique.length),
          works: ranked,
        }
      },
    ),
  })

  return {
    searchWorks,
    getConceptTree,
    getRelatedWorks,
    filterWorks,
    getAuthorWorks,
    rankAndDeduplicate,
  }
}
