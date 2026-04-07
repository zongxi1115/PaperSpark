import type { ModelConfig } from './types'

export type LiteratureSearchStage =
  | 'intent'
  | 'expansion'
  | 'parallel-search'
  | 'analysis'
  | 'aggregation'

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'error' | 'waiting'

export interface LiteratureSearchStep {
  id: LiteratureSearchStage
  label: string
  status: StepStatus
}

export interface ClarificationOption {
  id: string
  label: string
  value: string
  isOther?: boolean
}

export interface ClarificationQuestion {
  id: string
  prompt: string
  options: ClarificationOption[]
}

export interface ClarificationAnswer {
  questionId: string
  value: string
  customText?: string
}

export interface SearchIntent {
  originalQuery: string
  clarifiedQuery: string
  isClear: boolean
  confidence: number
  researchGoal: string
  coreConcepts: string[]
  relatedFields: string[]
  preferredYears?: {
    from?: number
    to?: number
  }
  literatureTypes: string[]
  citationPreference: 'high-impact' | 'balanced' | 'latest'
  citationThreshold?: number
  openAccessOnly?: boolean
  notes?: string[]
  clarificationQuestions?: ClarificationQuestion[]
}

export interface QueryExpansionGroup {
  id: string
  label: string
  focus: string
  query: string
  synonyms: string[]
  relatedConcepts: string[]
  multilingualKeywords: string[]
}

export interface SearchFilters {
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

export interface ConceptNode {
  id: string
  displayName: string
  level?: number
  description?: string
}

export interface SearchPaper {
  id: string
  openAlexId: string
  title: string
  abstract: string
  abstractSnippet: string
  authors: string[]
  authorIds: string[]
  year?: number
  publicationDate?: string
  venue?: string
  doi?: string
  url?: string
  pdfUrl?: string
  citedByCount: number
  isOpenAccess: boolean
  oaStatus?: string
  sourceType?: string
  concepts: ConceptNode[]
  topics: string[]
  keywordMatches: string[]
  matchedQueries: string[]
  matchedConcepts: string[]
  relevanceScore: number
  citationScore: number
  noveltyScore: number
  openAccessScore: number
  finalScore: number
  recommendationReason?: string
}

export interface SearchWorksOutput {
  queryUsed: string
  filtersApplied: SearchFilters
  count: number
  works: SearchPaper[]
}

export interface ConceptTreeOutput {
  conceptName: string
  matched?: ConceptNode
  ancestors: ConceptNode[]
  children: ConceptNode[]
}

export interface RelatedWorksOutput {
  workId: string
  direction: 'references' | 'citations' | 'related'
  count: number
  works: SearchPaper[]
}

export interface AuthorWorksOutput {
  authorId: string
  authorName?: string
  count: number
  works: SearchPaper[]
}

export interface FilterCriteria {
  fromYear?: number
  toYear?: number
  minCitations?: number
  openAccessOnly?: boolean
  sourceTypes?: Array<'journal' | 'conference' | 'repository'>
  requireAbstract?: boolean
  relaxIfSparse?: boolean
}

export interface FilterWorksOutput {
  count: number
  works: SearchPaper[]
  criteriaApplied: FilterCriteria
  relaxed: boolean
  note?: string
}

export interface RankedWorksOutput {
  count: number
  duplicatesRemoved: number
  works: SearchPaper[]
}

export interface ToolCallEvent {
  id: string
  name:
    | 'searchWorks'
    | 'getConceptTree'
    | 'getRelatedWorks'
    | 'filterWorks'
    | 'getAuthorWorks'
    | 'rankAndDeduplicate'
  status: 'running' | 'completed' | 'error'
  inputSummary: string
  resultCount?: number
  note?: string
  output?: unknown
}

export interface ThoughtBubble {
  id: string
  stage: LiteratureSearchStage
  text: string
}

export interface ResearchAnalysis {
  newQueries: string[]
  corePaperIds: string[]
  relevanceAssessments: Array<{
    paperId: string
    score: number
    reason: string
  }>
  rationale: string[]
}

export interface SearchReview {
  acceptedPaperIds: string[]
  rejectedPaperIds: string[]
  retryNeeded: boolean
  retryReason?: string
  recommendedQueries: string[]
  relaxedFilters?: {
    minCitations?: number
    openAccessOnly?: boolean
    fromYear?: number
    toYear?: number
  }
  reviewNotes: string[]
}

export interface LiteratureSearchResultPayload {
  summary: string
  papers: SearchPaper[]
  totalCandidates: number
  duplicatesRemoved: number
  queryGroups: QueryExpansionGroup[]
  intent: SearchIntent
  reviewNotes: string[]
  retryCount: number
}

export interface LiteratureSearchRequest {
  query: string
  answers?: ClarificationAnswer[]
  modelConfig: ModelConfig
}

export type LiteratureSearchEvent =
  | {
      type: 'session'
      steps: LiteratureSearchStep[]
    }
  | {
      type: 'stage'
      stage: LiteratureSearchStage
      status: StepStatus
      detail: string
    }
  | {
      type: 'thinking'
      bubble: ThoughtBubble
    }
  | {
      type: 'strategy'
      intent?: SearchIntent
      queryGroups?: QueryExpansionGroup[]
    }
  | {
      type: 'clarification'
      questions: ClarificationQuestion[]
      intent: SearchIntent
    }
  | {
      type: 'tool'
      tool: ToolCallEvent
    }
  | {
      type: 'results'
      payload: LiteratureSearchResultPayload
    }
  | {
      type: 'error'
      message: string
    }
  | {
      type: 'done'
      outcome: 'clarification' | 'results'
    }

export const LITERATURE_SEARCH_STEPS: LiteratureSearchStep[] = [
  { id: 'intent', label: '意图理解', status: 'pending' },
  { id: 'expansion', label: '查询扩展', status: 'pending' },
  { id: 'parallel-search', label: '并行检索', status: 'pending' },
  { id: 'analysis', label: '深度挖掘', status: 'pending' },
  { id: 'aggregation', label: '结果聚合', status: 'pending' },
]
