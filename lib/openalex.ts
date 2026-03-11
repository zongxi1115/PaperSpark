import type {
  AuthorWorksOutput,
  ConceptNode,
  ConceptTreeOutput,
  QueryExpansionGroup,
  RelatedWorksOutput,
  SearchFilters,
  SearchPaper,
  SearchWorksOutput,
} from './literatureSearchTypes'

const OPENALEX_BASE_URL = 'https://api.openalex.org'
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '2opfreTTciNLpHWthEiV5R'
const OPENALEX_EMAIL = process.env.OPENALEX_EMAIL

const WORK_SELECT_FIELDS = [
  'id',
  'display_name',
  'publication_year',
  'publication_date',
  'cited_by_count',
  'authorships',
  'abstract_inverted_index',
  'primary_location',
  'open_access',
  'doi',
  'concepts',
  'topics',
  'primary_topic',
  'ids',
  'referenced_works',
  'related_works',
  'cited_by_api_url',
  'relevance_score',
].join(',')

type OpenAlexListResponse<T> = {
  meta?: {
    count?: number
  }
  results?: T[]
}

type OpenAlexWork = {
  id: string
  display_name: string
  publication_year?: number
  publication_date?: string
  cited_by_count?: number
  abstract_inverted_index?: Record<string, number[]>
  authorships?: Array<{
    author?: {
      id?: string | null
      display_name?: string | null
    }
  }>
  primary_location?: {
    landing_page_url?: string | null
    pdf_url?: string | null
    source?: {
      display_name?: string | null
      type?: string | null
    } | null
  } | null
  open_access?: {
    is_oa?: boolean
    oa_status?: string | null
  } | null
  doi?: string | null
  concepts?: Array<{
    id: string
    display_name: string
    level?: number
  }>
  topics?: Array<{
    display_name: string
  }>
  primary_topic?: {
    display_name?: string
  } | null
  referenced_works?: string[]
  related_works?: string[]
  cited_by_api_url?: string
  relevance_score?: number
}

type OpenAlexAuthor = {
  id: string
  display_name: string
}

type OpenAlexConcept = {
  id: string
  display_name: string
  level?: number
  description?: string
  ancestors?: Array<{
    id: string
    display_name: string
    level?: number
  }> | null
}

function toShortOpenAlexId(id: string) {
  return id.replace(/^https?:\/\/openalex\.org\//, '')
}

function fromDoiUrl(doi?: string | null) {
  if (!doi) return undefined
  return doi.replace(/^https?:\/\/doi\.org\//, '')
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5\s-]/gi, ' ')
}

function tokenize(text: string) {
  return normalizeText(text)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 1)
}

export function buildAbstractFromInvertedIndex(index?: Record<string, number[]>) {
  if (!index) return ''

  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      words[position] = word
    }
  }

  return words
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim()
}

function buildSnippet(text: string, limit: number = 220) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}…`
}

function toConceptNode(node?: { id?: string; display_name?: string; level?: number; description?: string | null } | null): ConceptNode | undefined {
  if (!node?.id || !node.display_name) return undefined
  return {
    id: node.id,
    displayName: node.display_name,
    level: node.level,
    description: node.description || undefined,
  }
}

export function normalizeOpenAlexWork(work: OpenAlexWork): SearchPaper {
  const abstract = buildAbstractFromInvertedIndex(work.abstract_inverted_index)
  const authors = (work.authorships || [])
    .map(item => item.author?.display_name?.trim())
    .filter(Boolean) as string[]
  const authorIds = (work.authorships || [])
    .map(item => item.author?.id || undefined)
    .filter(Boolean) as string[]
  const concepts = (work.concepts || [])
    .map(toConceptNode)
    .filter(Boolean) as ConceptNode[]
  const topics = Array.from(
    new Set(
      [
        ...(work.topics || []).map(item => item.display_name).filter(Boolean),
        work.primary_topic?.display_name,
      ].filter(Boolean) as string[],
    ),
  )

  return {
    id: work.id,
    openAlexId: work.id,
    title: work.display_name,
    abstract,
    abstractSnippet: buildSnippet(abstract || '暂无摘要'),
    authors,
    authorIds,
    year: work.publication_year,
    publicationDate: work.publication_date,
    venue: work.primary_location?.source?.display_name || undefined,
    doi: fromDoiUrl(work.doi),
    url: work.primary_location?.landing_page_url || undefined,
    pdfUrl: work.primary_location?.pdf_url || undefined,
    citedByCount: work.cited_by_count || 0,
    isOpenAccess: Boolean(work.open_access?.is_oa),
    oaStatus: work.open_access?.oa_status || undefined,
    sourceType: work.primary_location?.source?.type || undefined,
    concepts,
    topics,
    keywordMatches: [],
    matchedQueries: [],
    matchedConcepts: [],
    relevanceScore: 0,
    citationScore: 0,
    noveltyScore: 0,
    openAccessScore: work.open_access?.is_oa ? 1 : 0,
    finalScore: 0,
  }
}

async function openAlexFetch<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(path, OPENALEX_BASE_URL)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  url.searchParams.set('api_key', OPENALEX_API_KEY)
  if (OPENALEX_EMAIL) {
    url.searchParams.set('mailto', OPENALEX_EMAIL)
  }

  const response = await fetch(url.toString(), {
    signal,
    headers: {
      'User-Agent': 'paper-reader/1.0',
    },
    next: { revalidate: 0 },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`OpenAlex 请求失败：${response.status} ${message}`)
  }

  return await response.json() as T
}

function buildWorkFilter(filters: SearchFilters = {}, query?: string) {
  const segments: string[] = []

  if (query?.trim()) {
    segments.push(`title_and_abstract.search:${query.trim()}`)
  }

  if (filters.fromYear) {
    segments.push(`from_publication_date:${filters.fromYear}-01-01`)
  }

  if (filters.toYear) {
    segments.push(`to_publication_date:${filters.toYear}-12-31`)
  }

  if (filters.minCitations) {
    segments.push(`cited_by_count:>${filters.minCitations}`)
  }

  if (filters.openAccessOnly) {
    segments.push('open_access.is_oa:true')
  }

  if (filters.sourceTypes?.length) {
    segments.push(`primary_location.source.type:${filters.sourceTypes.join('|')}`)
  }

  if (filters.conceptIds?.length) {
    const conceptValues = filters.conceptIds
      .slice(0, 5)
      .map(toShortOpenAlexId)
      .join('|')
    segments.push(`concepts.id:${conceptValues}`)
  }

  if (filters.authorIds?.length) {
    const authorValues = filters.authorIds
      .slice(0, 4)
      .map(id => id.replace(/^https?:\/\/openalex\.org\//, ''))
      .join('|')
    segments.push(`authorships.author.id:${authorValues}`)
  }

  return segments.join(',')
}

function deduplicatePapers(works: SearchPaper[]) {
  const seen = new Map<string, SearchPaper>()

  for (const work of works) {
    const key = (work.doi || work.openAlexId).toLowerCase()
    const current = seen.get(key)
    if (!current || current.citedByCount < work.citedByCount) {
      seen.set(key, work)
    }
  }

  return Array.from(seen.values())
}

export async function fetchWorksByIds(ids: string[], signal?: AbortSignal) {
  const normalizedIds = Array.from(new Set(ids.map(toShortOpenAlexId))).filter(Boolean)
  if (normalizedIds.length === 0) return []

  const batches: string[][] = []
  for (let index = 0; index < normalizedIds.length; index += 20) {
    batches.push(normalizedIds.slice(index, index + 20))
  }

  const responses = await Promise.all(
    batches.map(batch =>
      openAlexFetch<OpenAlexListResponse<OpenAlexWork>>('/works', {
        filter: `openalex_id:${batch.join('|')}`,
        select: WORK_SELECT_FIELDS,
        'per-page': batch.length,
      }, signal),
    ),
  )

  return deduplicatePapers(
    responses.flatMap(response => (response.results || []).map(normalizeOpenAlexWork)),
  )
}

export async function searchWorksOnOpenAlex(
  query: string,
  filters: SearchFilters = {},
  signal?: AbortSignal,
): Promise<SearchWorksOutput> {
  const maxResults = Math.min(filters.maxResults || 10, 25)
  const list = await openAlexFetch<OpenAlexListResponse<OpenAlexWork>>('/works', {
    filter: buildWorkFilter(filters, query),
    sort: filters.sortBy === 'citations'
      ? 'cited_by_count:desc'
      : filters.sortBy === 'date'
        ? 'publication_date:desc'
        : 'relevance_score:desc',
    'per-page': maxResults,
    select: WORK_SELECT_FIELDS,
  }, signal)

  return {
    queryUsed: query,
    filtersApplied: filters,
    count: list.results?.length || 0,
    works: deduplicatePapers((list.results || []).map(normalizeOpenAlexWork)),
  }
}

export async function getConceptTreeFromOpenAlex(
  conceptName: string,
  signal?: AbortSignal,
): Promise<ConceptTreeOutput> {
  const response = await openAlexFetch<OpenAlexListResponse<OpenAlexConcept>>('/concepts', {
    search: conceptName,
    'per-page': 5,
    select: 'id,display_name,level,description,ancestors',
  }, signal)

  const [matched, ...related] = response.results || []
  const matchedNode = toConceptNode(matched)

  return {
    conceptName,
    matched: matchedNode,
    ancestors: (matched?.ancestors || [])
      .map(toConceptNode)
      .filter(Boolean) as ConceptNode[],
    children: related
      .map(toConceptNode)
      .filter(Boolean) as ConceptNode[],
  }
}

export async function getWorkById(workId: string, signal?: AbortSignal) {
  return await openAlexFetch<OpenAlexWork>(
    `/works/${toShortOpenAlexId(workId)}`,
    { select: WORK_SELECT_FIELDS },
    signal,
  )
}

export async function getRelatedWorksFromOpenAlex(
  workId: string,
  direction: 'references' | 'citations' | 'related',
  limit: number = 10,
  signal?: AbortSignal,
): Promise<RelatedWorksOutput> {
  const target = await getWorkById(workId, signal)

  let works: SearchPaper[] = []

  if (direction === 'references') {
    works = await fetchWorksByIds((target.referenced_works || []).slice(0, limit), signal)
  } else if (direction === 'related') {
    works = await fetchWorksByIds((target.related_works || []).slice(0, limit), signal)
  } else {
    const response = await openAlexFetch<OpenAlexListResponse<OpenAlexWork>>('/works', {
      filter: `cites:${toShortOpenAlexId(workId)}`,
      sort: 'cited_by_count:desc',
      'per-page': Math.min(limit, 20),
      select: WORK_SELECT_FIELDS,
    }, signal)
    works = (response.results || []).map(normalizeOpenAlexWork)
  }

  return {
    workId,
    direction,
    count: works.length,
    works: deduplicatePapers(works),
  }
}

export async function searchAuthorsOnOpenAlex(
  authorName: string,
  signal?: AbortSignal,
): Promise<OpenAlexAuthor[]> {
  const response = await openAlexFetch<OpenAlexListResponse<OpenAlexAuthor>>('/authors', {
    search: authorName,
    'per-page': 5,
    select: 'id,display_name',
  }, signal)

  return response.results || []
}

export async function getAuthorWorksFromOpenAlex(
  authorId: string,
  options: { fromYear?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<AuthorWorksOutput> {
  const filters: SearchFilters = {
    fromYear: options.fromYear,
    authorIds: [authorId],
    maxResults: options.limit || 8,
    sortBy: 'citations',
  }

  const result = await searchWorksOnOpenAlex('', filters, signal)
  return {
    authorId,
    count: result.count,
    works: result.works,
  }
}

export function scoreKeywordMatches(
  paper: SearchPaper,
  queryGroups: QueryExpansionGroup[],
  extraKeywords: string[] = [],
) {
  const searchable = normalizeText(
    [
      paper.title,
      paper.abstract,
      paper.venue,
      paper.concepts.map(item => item.displayName).join(' '),
      paper.topics.join(' '),
    ].filter(Boolean).join(' '),
  )

  const keywords = Array.from(new Set([
    ...queryGroups.flatMap(group => [group.query, ...group.synonyms, ...group.relatedConcepts, ...group.multilingualKeywords]),
    ...extraKeywords,
  ].flatMap(tokenize)))

  const matches = keywords.filter(keyword => searchable.includes(keyword))
  const matchedQueries = queryGroups
    .filter(group => tokenize([group.query, ...group.synonyms].join(' ')).some(keyword => searchable.includes(keyword)))
    .map(group => group.label)
  const matchedConcepts = paper.concepts
    .map(item => item.displayName)
    .filter(name => keywords.some(keyword => normalizeText(name).includes(keyword)))

  return {
    keywordMatches: Array.from(new Set(matches)),
    matchedQueries,
    matchedConcepts,
    lexicalScore: keywords.length === 0 ? 0.35 : Math.min(1, matches.length / Math.max(3, keywords.length * 0.7)),
  }
}
