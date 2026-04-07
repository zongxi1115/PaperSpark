import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  QueryExpansionGroup,
  ResearchAnalysis,
  SearchIntent,
  SearchPaper,
  SearchReview,
} from './literatureSearchTypes'
import type { ModelConfig } from './types'

function createProvider(modelConfig: ModelConfig) {
  return createOpenAI({
    baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
    apiKey: modelConfig.apiKey,
  })
}

function stripCodeFence(text: string) {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function safeJsonParse<T>(text: string): T | null {
  const cleaned = stripCodeFence(text)

  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T
      } catch {
        return null
      }
    }
    return null
  }
}

function clampScore(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function extractYears(text: string) {
  const matches = text.match(/\b(19|20)\d{2}\b/g) || []
  const years = matches.map(Number).filter(year => year >= 1900 && year <= 2100)
  if (years.length === 0) return undefined
  return {
    from: Math.min(...years),
    to: Math.max(...years),
  }
}

function toAnswerText(answer: ClarificationAnswer) {
  if (answer.value === 'other') {
    return answer.customText?.trim() || ''
  }
  return answer.customText?.trim() || answer.value
}

function buildClarifiedQuery(query: string, answers: ClarificationAnswer[]) {
  const extra = answers
    .map(answer => toAnswerText(answer))
    .filter(Boolean)
    .join('；')

  if (!extra) return query.trim()
  return `${query.trim()}。补充约束：${extra}`
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/gi, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length > 1)
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function fallbackClarificationQuestions(query: string): ClarificationQuestion[] {
  const lower = query.toLowerCase()
  const usesReview = lower.includes('综述') || lower.includes('review')
  return [
    {
      id: 'scope',
      prompt: '你更希望先收敛哪一种检索范围？',
      options: [
        { id: 'scope-narrow', label: '聚焦细分子题', value: '聚焦到具体方法、任务或场景' },
        { id: 'scope-wide', label: '先看全景图', value: '先覆盖整个研究方向，再逐步下钻' },
        { id: 'scope-other', label: '其他（请填写）', value: 'other', isOther: true },
      ],
    },
    {
      id: 'time',
      prompt: '你更关注哪一类时间窗口？',
      options: [
        { id: 'time-latest', label: '近五年', value: '优先近五年文献' },
        { id: 'time-classic', label: '经典奠基', value: '保留经典高被引论文' },
        { id: 'time-other', label: '其他（请填写）', value: 'other', isOther: true },
      ],
    },
    {
      id: 'type',
      prompt: '这轮检索更偏向哪类文献？',
      options: [
        { id: 'type-review', label: usesReview ? '综述优先' : '综述与方法并看', value: usesReview ? '优先 review / survey / tutorial' : 'review 与方法论文都保留' },
        { id: 'type-method', label: '方法论文', value: '优先方法、实验和实证论文' },
        { id: 'type-other', label: '其他（请填写）', value: 'other', isOther: true },
      ],
    },
  ]
}

function fallbackIntent(query: string, answers: ClarificationAnswer[] = []): SearchIntent {
  const clarifiedQuery = buildClarifiedQuery(query, answers)
  const yearRange = extractYears(clarifiedQuery)
  const coreConcepts = uniqueStrings(
    clarifiedQuery
      .split(/[，。,；;、/]/)
      .flatMap(part => tokenize(part).slice(0, 4))
      .slice(0, 6),
  )
  const isClear = clarifiedQuery.length > 18 && coreConcepts.length >= 2

  return {
    originalQuery: query,
    clarifiedQuery,
    isClear,
    confidence: isClear ? 0.68 : 0.42,
    researchGoal: clarifiedQuery,
    coreConcepts: coreConcepts.slice(0, 5),
    relatedFields: [],
    preferredYears: yearRange,
    literatureTypes: ['research article', 'review'],
    citationPreference: clarifiedQuery.includes('最新') ? 'latest' : clarifiedQuery.includes('高被引') || clarifiedQuery.includes('经典') ? 'high-impact' : 'balanced',
    citationThreshold: clarifiedQuery.includes('高被引') ? 50 : 10,
    openAccessOnly: clarifiedQuery.includes('开放获取') || clarifiedQuery.includes('open access'),
    notes: answers.map(toAnswerText).filter(Boolean),
    clarificationQuestions: isClear ? [] : fallbackClarificationQuestions(query),
  }
}

async function runJsonPrompt<T>(
  systemPrompt: string,
  userPrompt: string,
  modelConfig: ModelConfig,
): Promise<T | null> {
  const provider = createProvider(modelConfig)
  const { text } = await generateText({
    model: provider.chat(modelConfig.modelName),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.2,
  })

  return safeJsonParse<T>(text)
}

function normalizeIntent(raw: SearchIntent, fallback: SearchIntent): SearchIntent {
  const clarifiedQuery = raw.clarifiedQuery?.trim() || fallback.clarifiedQuery
  const questions = (raw.clarificationQuestions || [])
    .slice(0, 4)
    .map(question => ({
      ...question,
      options: uniqueQuestionOptions(question.options || []),
    }))

  return {
    ...fallback,
    ...raw,
    clarifiedQuery,
    confidence: clampScore(raw.confidence ?? fallback.confidence),
    coreConcepts: uniqueStrings(raw.coreConcepts || fallback.coreConcepts).slice(0, 6),
    relatedFields: uniqueStrings(raw.relatedFields || fallback.relatedFields).slice(0, 5),
    literatureTypes: uniqueStrings(raw.literatureTypes || fallback.literatureTypes).slice(0, 5),
    notes: uniqueStrings(raw.notes || fallback.notes || []).slice(0, 6),
    clarificationQuestions: questions.length > 0 ? questions : fallback.clarificationQuestions,
  }
}

function uniqueQuestionOptions(options: Array<{ id: string; label: string; value: string; isOther?: boolean }>) {
  const seen = new Set<string>()
  const normalized = options
    .filter(option => {
      const key = `${option.label}|${option.value}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 4)

  if (!normalized.some(option => option.isOther || option.label === '其他（请填写）')) {
    normalized.push({
      id: `other-${normalized.length + 1}`,
      label: '其他（请填写）',
      value: 'other',
      isOther: true,
    })
  }

  return normalized.map((option, index) => ({
    id: option.id || `option-${index + 1}`,
    label: option.label,
    value: option.value,
    isOther: option.isOther,
  }))
}

export async function runIntentAgent(
  query: string,
  answers: ClarificationAnswer[] | undefined,
  modelConfig: ModelConfig,
): Promise<SearchIntent> {
  const fallback = fallbackIntent(query, answers)

  const systemPrompt = `你是论文资料漫游检索系统中的意图理解智能体。
你必须把用户问题转成结构化检索意图，并判断当前意图是否足够清晰。

输出 JSON，字段必须完整：
{
  "originalQuery": "string",
  "clarifiedQuery": "string",
  "isClear": true,
  "confidence": 0.0,
  "researchGoal": "string",
  "coreConcepts": ["string"],
  "relatedFields": ["string"],
  "preferredYears": { "from": 2021, "to": 2026 },
  "literatureTypes": ["string"],
  "citationPreference": "high-impact | balanced | latest",
  "citationThreshold": 20,
  "openAccessOnly": false,
  "notes": ["string"],
  "clarificationQuestions": [
    {
      "id": "string",
      "prompt": "string",
      "options": [
        { "id": "string", "label": "string", "value": "string" },
        { "id": "string", "label": "其他（请填写）", "value": "other", "isOther": true }
      ]
    }
  ]
}

规则：
1. 如果用户问题已经足够明确，isClear=true，clarificationQuestions 返回空数组。
2. 如果问题模糊，生成 2 到 4 道单选澄清题。
3. 每一道题都必须包含“其他（请填写）”选项。
4. clarifiedQuery 要吸收已有补充说明，变成可直接检索的一句话。
5. confidence 范围必须是 0 到 1。`

  const userPrompt = `原始问题：${query}
补充回答：${answers?.length ? answers.map(answer => `- ${answer.questionId}: ${toAnswerText(answer)}`).join('\n') : '无'}

请返回 JSON，不要附带解释。`

  try {
    const raw = await runJsonPrompt<SearchIntent>(systemPrompt, userPrompt, modelConfig)
    if (!raw) return fallback

    const normalized = normalizeIntent(raw, fallback)
    if ((answers?.length || 0) > 0 && normalized.clarificationQuestions && normalized.clarificationQuestions.length > 0) {
      normalized.isClear = true
      normalized.clarificationQuestions = []
      normalized.confidence = Math.max(0.72, normalized.confidence)
    }
    return normalized
  } catch {
    return fallback
  }
}

function fallbackQueryGroups(intent: SearchIntent): QueryExpansionGroup[] {
  const concepts = intent.coreConcepts.length > 0 ? intent.coreConcepts : tokenize(intent.clarifiedQuery).slice(0, 4)
  const base = concepts.slice(0, 4)

  return base.map((concept, index) => ({
    id: `group-${Date.now()}-${index}`,
    label: index === 0 ? '核心问题' : `扩展方向 ${index}`,
    focus: index === 0 ? '直接覆盖原始研究问题' : `围绕 ${concept} 扩展相邻概念`,
    query: index === 0 ? intent.clarifiedQuery : `${concept} AND ${intent.coreConcepts[0] || concept}`,
    synonyms: [concept],
    relatedConcepts: intent.relatedFields.slice(0, 3),
    multilingualKeywords: [concept],
  }))
}

function normalizeQueryGroups(groups: QueryExpansionGroup[], fallback: QueryExpansionGroup[]) {
  const safeGroups = groups
    .filter(group => group.query?.trim())
    .slice(0, 5)
    .map((group, index) => ({
      id: group.id || `group-${Date.now()}-${index}`,
      label: group.label?.trim() || `检索组 ${index + 1}`,
      focus: group.focus?.trim() || '补充相关方向',
      query: group.query.trim(),
      synonyms: uniqueStrings(group.synonyms || []),
      relatedConcepts: uniqueStrings(group.relatedConcepts || []),
      multilingualKeywords: uniqueStrings(group.multilingualKeywords || []),
    }))

  return safeGroups.length > 0 ? safeGroups : fallback
}

export async function runQueryExpansionAgent(
  intent: SearchIntent,
  modelConfig: ModelConfig,
): Promise<QueryExpansionGroup[]> {
  const fallback = fallbackQueryGroups(intent)

  const systemPrompt = `你是论文检索系统中的查询扩展智能体。
目标是把用户意图扩展成 3 到 5 组检索关键词组合，提升 OpenAlex 检索覆盖率。

输出 JSON：
{
  "queryGroups": [
    {
      "id": "group-1",
      "label": "string",
      "focus": "string",
      "query": "boolean query in English when possible",
      "synonyms": ["string"],
      "relatedConcepts": ["string"],
      "multilingualKeywords": ["string"]
    }
  ]
}

规则：
1. query 尽量使用英文专业词，并保留缩写。
2. synonym 至少提供 2 个同义或近义词。
3. multilingualKeywords 同时照顾中文和英文关键词。
4. 每组 focus 要说明该组检索的侧重点。
5. 只返回 JSON。`

  const userPrompt = `结构化意图：
${JSON.stringify(intent, null, 2)}

请生成 queryGroups。`

  try {
    const raw = await runJsonPrompt<{ queryGroups: QueryExpansionGroup[] }>(systemPrompt, userPrompt, modelConfig)
    return normalizeQueryGroups(raw?.queryGroups || [], fallback)
  } catch {
    return fallback
  }
}

function fallbackAnalysis(papers: SearchPaper[]): ResearchAnalysis {
  const top = [...papers]
    .sort((left, right) => right.finalScore - left.finalScore || right.citedByCount - left.citedByCount)
    .slice(0, 8)

  return {
    newQueries: [],
    corePaperIds: top.slice(0, 2).map(paper => paper.openAlexId),
    relevanceAssessments: top.map(paper => ({
      paperId: paper.openAlexId,
      score: clampScore(paper.relevanceScore || 0.55),
      reason: paper.keywordMatches.length > 0
        ? `命中关键词：${paper.keywordMatches.slice(0, 3).join(' / ')}`
        : '标题与摘要与当前主题存在直接关联',
    })),
    rationale: [
      '优先保留标题、摘要和概念标签同时命中核心主题的论文。',
      '高被引与近年工作并存，以兼顾奠基论文和最新进展。',
    ],
  }
}

function buildFallbackReviewQueries(intent: SearchIntent, papers: SearchPaper[]) {
  const paperSignals = uniqueStrings(
    papers.flatMap(paper => [
      ...paper.matchedConcepts,
      ...paper.concepts.map(item => item.displayName),
      ...paper.keywordMatches,
      ...paper.topics,
    ]),
  ).slice(0, 8)

  const queries = [
    intent.coreConcepts.slice(0, 2).join(' AND '),
    [intent.coreConcepts[0], paperSignals[0]].filter(Boolean).join(' AND '),
    [...intent.coreConcepts.slice(0, 2), ...paperSignals.slice(0, 1)].filter(Boolean).join(' AND '),
    intent.clarifiedQuery,
  ]

  return uniqueStrings(queries).slice(0, 3)
}

function fallbackReview(intent: SearchIntent, papers: SearchPaper[]): SearchReview {
  const accepted = papers.filter(paper => {
    const directMatch = paper.matchedQueries.length > 0 || paper.matchedConcepts.length > 0
    const keywordSupport = paper.keywordMatches.length >= 2
    const scoreSupport = paper.relevanceScore >= 0.56 || paper.finalScore >= 0.5
    return (directMatch && scoreSupport) || (keywordSupport && paper.relevanceScore >= 0.48)
  })

  const acceptedPaperIds = (accepted.length > 0 ? accepted : papers.slice(0, Math.min(3, papers.length)))
    .map(paper => paper.openAlexId)
  const acceptedIdSet = new Set(acceptedPaperIds)
  const reviewNotes = uniqueStrings([
    papers.length === 0 ? '当前候选为空，需要放宽限制并重组查询词。' : '',
    acceptedPaperIds.length < papers.length ? `已剔除 ${papers.length - acceptedPaperIds.length} 篇弱相关候选。` : '',
    acceptedPaperIds.length < 4 ? '保留下来的高相关论文偏少，建议继续自动重检。' : '',
    acceptedPaperIds.length > 0 ? '优先保留同时命中核心概念、检索组或摘要关键词的论文。' : '',
  ]).slice(0, 4)

  const citationBaseline = intent.citationPreference === 'high-impact'
    ? Math.max(8, Math.floor((intent.citationThreshold || 40) * 0.45))
    : 0

  return {
    acceptedPaperIds,
    rejectedPaperIds: papers
      .filter(paper => !acceptedIdSet.has(paper.openAlexId))
      .map(paper => paper.openAlexId),
    retryNeeded:
      papers.length === 0 ||
      acceptedPaperIds.length < 4 ||
      (papers[0]?.relevanceScore || 0) < 0.45,
    retryReason: papers.length === 0
      ? '首轮结果为空'
      : acceptedPaperIds.length < 4
        ? '高相关论文数量不足'
        : (papers[0]?.relevanceScore || 0) < 0.45
          ? '头部论文相关性偏低'
          : undefined,
    recommendedQueries: buildFallbackReviewQueries(intent, papers),
    relaxedFilters: {
      minCitations: citationBaseline,
      openAccessOnly: false,
      fromYear: intent.preferredYears?.from ? Math.max(1900, intent.preferredYears.from - 3) : undefined,
      toYear: intent.preferredYears?.to,
    },
    reviewNotes,
  }
}

function normalizeReview(raw: SearchReview, fallback: SearchReview, papers: SearchPaper[]): SearchReview {
  const availableIds = new Set(papers.map(paper => paper.openAlexId))
  const acceptedPaperIds = uniqueStrings(raw.acceptedPaperIds || []).filter(id => availableIds.has(id))
  const rejectedPaperIds = uniqueStrings(raw.rejectedPaperIds || []).filter(id => availableIds.has(id))
  const normalizedAccepted = acceptedPaperIds.length > 0 ? acceptedPaperIds : fallback.acceptedPaperIds

  return {
    acceptedPaperIds: normalizedAccepted,
    rejectedPaperIds: rejectedPaperIds.length > 0 ? rejectedPaperIds : fallback.rejectedPaperIds,
    retryNeeded:
      Boolean(raw.retryNeeded) ||
      (normalizedAccepted.length < 4 && fallback.retryNeeded),
    retryReason: raw.retryReason?.trim() || fallback.retryReason,
    recommendedQueries: uniqueStrings(raw.recommendedQueries || fallback.recommendedQueries).slice(0, 3),
    relaxedFilters: {
      minCitations: raw.relaxedFilters?.minCitations ?? fallback.relaxedFilters?.minCitations,
      openAccessOnly: raw.relaxedFilters?.openAccessOnly ?? fallback.relaxedFilters?.openAccessOnly,
      fromYear: raw.relaxedFilters?.fromYear ?? fallback.relaxedFilters?.fromYear,
      toYear: raw.relaxedFilters?.toYear ?? fallback.relaxedFilters?.toYear,
    },
    reviewNotes: uniqueStrings(raw.reviewNotes || fallback.reviewNotes).slice(0, 4),
  }
}

export async function runAnalysisAgent(
  intent: SearchIntent,
  papers: SearchPaper[],
  modelConfig: ModelConfig,
): Promise<ResearchAnalysis> {
  const fallback = fallbackAnalysis(papers)
  const compactPapers = papers.slice(0, 12).map(paper => ({
    paperId: paper.openAlexId,
    title: paper.title,
    year: paper.year,
    citedByCount: paper.citedByCount,
    abstractSnippet: paper.abstractSnippet,
    concepts: paper.concepts.map(item => item.displayName).slice(0, 4),
    topics: paper.topics.slice(0, 4),
    authors: paper.authors.slice(0, 4),
    keywordMatches: paper.keywordMatches.slice(0, 6),
    matchedQueries: paper.matchedQueries,
  }))

  const systemPrompt = `你是论文检索系统中的结果分析与再检索智能体。
你要评估候选论文与研究问题的相关性，并指出是否值得继续扩展。

只输出 JSON：
{
  "newQueries": ["string"],
  "corePaperIds": ["https://openalex.org/W..."],
  "relevanceAssessments": [
    {
      "paperId": "https://openalex.org/W...",
      "score": 0.84,
      "reason": "一句话说明为什么相关"
    }
  ],
  "rationale": ["string"]
}

约束：
1. relevanceAssessments 只评估已给出的 paperId。
2. score 范围必须是 0 到 1。
3. newQueries 最多 2 条，只有在确实能提升召回时才补充。
4. corePaperIds 最多 2 条，优先高相关且可做滚雪球扩展的论文。
5. rationale 给 2 到 4 条公开可展示的分析摘要，不要暴露内部思维。`

  const userPrompt = `研究意图：
${JSON.stringify(intent, null, 2)}

候选论文：
${JSON.stringify(compactPapers, null, 2)}`

  try {
    const raw = await runJsonPrompt<ResearchAnalysis>(systemPrompt, userPrompt, modelConfig)
    if (!raw) return fallback

    const assessments = (raw.relevanceAssessments || [])
      .filter(item => compactPapers.some(paper => paper.paperId === item.paperId))
      .map(item => ({
        paperId: item.paperId,
        score: clampScore(item.score),
        reason: item.reason?.trim() || '与当前主题直接相关',
      }))

    return {
      newQueries: uniqueStrings(raw.newQueries || []).slice(0, 2),
      corePaperIds: uniqueStrings(raw.corePaperIds || []).slice(0, 2),
      relevanceAssessments: assessments.length > 0 ? assessments : fallback.relevanceAssessments,
      rationale: uniqueStrings(raw.rationale || []).slice(0, 4),
    }
  } catch {
    return fallback
  }
}

export async function runResultReviewAgent(
  intent: SearchIntent,
  papers: SearchPaper[],
  modelConfig: ModelConfig,
): Promise<SearchReview> {
  const fallback = fallbackReview(intent, papers)
  if (papers.length === 0) {
    return fallback
  }

  const compactPapers = papers.slice(0, 10).map(paper => ({
    paperId: paper.openAlexId,
    title: paper.title,
    year: paper.year,
    citedByCount: paper.citedByCount,
    relevanceScore: paper.relevanceScore,
    finalScore: paper.finalScore,
    venue: paper.venue,
    keywordMatches: paper.keywordMatches.slice(0, 6),
    matchedQueries: paper.matchedQueries,
    matchedConcepts: paper.matchedConcepts,
    concepts: paper.concepts.map(item => item.displayName).slice(0, 4),
    abstractSnippet: paper.abstractSnippet,
  }))

  const systemPrompt = `你是论文检索系统中的结果检阅智能体。
目标是审查候选文献是否真正契合研究问题，并在结果不足时给出重检建议。

只输出 JSON：
{
  "acceptedPaperIds": ["https://openalex.org/W..."],
  "rejectedPaperIds": ["https://openalex.org/W..."],
  "retryNeeded": false,
  "retryReason": "string",
  "recommendedQueries": ["string"],
  "relaxedFilters": {
    "minCitations": 10,
    "openAccessOnly": false,
    "fromYear": 2019,
    "toYear": 2026
  },
  "reviewNotes": ["string"]
}

规则：
1. acceptedPaperIds 和 rejectedPaperIds 只能使用给定 paperId。
2. 若高相关论文过少、主题偏移或没有结果，retryNeeded 必须为 true。
3. recommendedQueries 最多 3 条，要更聚焦、更利于召回。
4. reviewNotes 给 2 到 4 条可展示给用户的简短说明。
5. 只返回 JSON，不要附带解释。`

  const userPrompt = `研究意图：
${JSON.stringify(intent, null, 2)}

候选论文：
${JSON.stringify(compactPapers, null, 2)}`

  try {
    const raw = await runJsonPrompt<SearchReview>(systemPrompt, userPrompt, modelConfig)
    if (!raw) return fallback
    return normalizeReview(raw, fallback, papers)
  } catch {
    return fallback
  }
}

export function applyAnalysisToPapers(
  papers: SearchPaper[],
  analysis: ResearchAnalysis,
): SearchPaper[] {
  const assessments = new Map(
    analysis.relevanceAssessments.map(item => [item.paperId, item]),
  )

  return papers.map(paper => {
    const assessment = assessments.get(paper.openAlexId)
    if (!assessment) return paper

    return {
      ...paper,
      relevanceScore: clampScore(assessment.score),
      recommendationReason: assessment.reason,
    }
  })
}

export function buildSearchSummary(intent: SearchIntent, analysis: ResearchAnalysis, papers: SearchPaper[]) {
  const topPapers = papers.slice(0, 3)
  const venues = uniqueStrings(topPapers.map(paper => paper.venue || '').filter(Boolean))
  const summaryLines = [
    `围绕“${intent.researchGoal || intent.clarifiedQuery}”完成多轮检索，最终保留 ${papers.length} 篇高相关论文。`,
  ]

  if (analysis.rationale.length > 0) {
    summaryLines.push(analysis.rationale[0])
  }

  if (venues.length > 0) {
    summaryLines.push(`结果主要分布在 ${venues.slice(0, 3).join('、')} 等来源。`)
  }

  if (topPapers.length > 0) {
    summaryLines.push(`推荐优先阅读《${topPapers[0].title}》及其相邻论文链。`)
  }

  return summaryLines.join(' ')
}
