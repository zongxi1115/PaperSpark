import { scoreKeywordMatches } from './openalex'
import type {
  FilterCriteria,
  FilterWorksOutput,
  QueryExpansionGroup,
  RankedWorksOutput,
  SearchPaper,
  ToolCallEvent,
} from './literatureSearchTypes'

export function indexWorks(registry: Map<string, SearchPaper>, works: SearchPaper[]) {
  for (const work of works) {
    registry.set(work.id, work)
    registry.set(work.openAlexId, work)
    if (work.sourceRecordId) {
      registry.set(work.sourceRecordId, work)
    }
    if (work.doi) {
      registry.set(work.doi.toLowerCase(), work)
    }
  }
}

function summarizeInput(input: unknown) {
  const json = JSON.stringify(input)
  if (json.length <= 180) return json
  return `${json.slice(0, 177)}...`
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

export async function withToolReport<T>(
  event: Pick<ToolCallEvent, 'name' | 'displayName' | 'icon' | 'providerLabel'>,
  input: unknown,
  report: ((event: ToolCallEvent) => void) | undefined,
  runner: () => Promise<T>,
) {
  const id = `${event.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  report?.({
    id,
    ...event,
    status: 'running',
    inputSummary: summarizeInput(input),
  })

  try {
    const result = await runner()
    report?.({
      id,
      ...event,
      status: 'completed',
      inputSummary: summarizeInput(input),
      resultCount: getResultCount(result),
    })
    return result
  } catch (error) {
    report?.({
      id,
      ...event,
      status: 'error',
      inputSummary: summarizeInput(input),
      note: error instanceof Error ? error.message : '工具调用失败',
    })
    throw error
  }
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

export async function filterWorksLocally(
  works: SearchPaper[],
  criteria: FilterCriteria,
): Promise<FilterWorksOutput> {
  let filtered = applyCriteria(works, criteria)
  let relaxed = false
  let note: string | undefined

  if (filtered.length < 5 && criteria.relaxIfSparse) {
    let best = {
      works: filtered,
      criteria,
      note,
    }

    for (const variant of buildRelaxedCriteriaVariants(criteria)) {
      const nextWorks = applyCriteria(works, variant.criteria)
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
}

export async function rankWorksLocally(
  workList: SearchPaper[],
  queryGroups: QueryExpansionGroup[] = [],
  extraKeywords: string[] = [],
): Promise<RankedWorksOutput> {
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
}
