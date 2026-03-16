import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { callMcpTool, unwrapMcpToolResult } from './mcpStdioClient'
import { withToolReport } from './literatureLocalTools'
import type {
  QueryExpansionGroup,
  SearchIntent,
  SearchPaper,
  ToolCallEvent,
} from './literatureSearchTypes'
import type {
  LiteratureProviderConfig,
  LiteratureProviderDiscoveredTool,
} from './literatureProviders'
import type { ModelConfig } from './types'

type PlannedToolCall = {
  toolName: string
  goal: string
  args: Record<string, unknown>
}

type PlannedToolCallResult = {
  rationale: string[]
  calls: PlannedToolCall[]
}

type ExecutedToolCall = PlannedToolCall & {
  output: unknown
}

type ExtractedPaper = {
  recordId?: string
  title: string
  abstract?: string
  authors?: string[]
  authorIds?: string[]
  year?: number
  publicationDate?: string
  venue?: string
  doi?: string
  url?: string
  pdfUrl?: string
  citedByCount?: number
  isOpenAccess?: boolean
  oaStatus?: string
  sourceType?: string
  concepts?: string[]
  topics?: string[]
}

type ExtractionResult = {
  summary?: string
  notes: string[]
  papers: ExtractedPaper[]
}

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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function summarizeTools(tools: LiteratureProviderDiscoveredTool[]) {
  return tools
    .slice(0, 24)
    .map(tool => `- ${tool.name}: ${tool.description || '无描述'}`)
    .join('\n')
}

function compactQueryGroups(queryGroups: QueryExpansionGroup[]) {
  return queryGroups.slice(0, 5).map(group => ({
    label: group.label,
    focus: group.focus,
    query: group.query,
  }))
}

function compactPapers(papers: SearchPaper[]) {
  return papers.slice(0, 8).map(paper => ({
    paperId: paper.openAlexId,
    sourceRecordId: paper.sourceRecordId,
    title: paper.title,
    authors: paper.authors.slice(0, 3),
    year: paper.year,
    venue: paper.venue,
    relevanceScore: paper.relevanceScore,
    citedByCount: paper.citedByCount,
  }))
}

function truncateValue(value: unknown, limit: number = 3500) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function normalizeExtractedPaper(
  provider: LiteratureProviderConfig,
  paper: ExtractedPaper,
): SearchPaper | null {
  const title = paper.title?.trim()
  if (!title) return null

  const recordId = paper.recordId?.trim() || paper.doi?.trim() || paper.url?.trim() || slugify(title)
  const normalizedId = `${provider.id}:${recordId}`
  const abstract = paper.abstract?.trim() || ''

  return {
    id: normalizedId,
    openAlexId: normalizedId,
    sourceRecordId: recordId,
    sourceProviderId: provider.id,
    sourceProviderName: provider.name,
    title,
    abstract,
    abstractSnippet: abstract ? (abstract.length > 220 ? `${abstract.slice(0, 220)}...` : abstract) : '暂无摘要',
    authors: uniqueStrings(paper.authors || []),
    authorIds: uniqueStrings(paper.authorIds || []),
    year: typeof paper.year === 'number' ? paper.year : undefined,
    publicationDate: paper.publicationDate?.trim() || undefined,
    venue: paper.venue?.trim() || undefined,
    doi: paper.doi?.trim() || undefined,
    url: paper.url?.trim() || undefined,
    pdfUrl: paper.pdfUrl?.trim() || undefined,
    citedByCount: paper.citedByCount || 0,
    isOpenAccess: Boolean(paper.isOpenAccess),
    oaStatus: paper.oaStatus?.trim() || undefined,
    sourceType: paper.sourceType?.trim() || undefined,
    concepts: uniqueStrings(paper.concepts || []).map(name => ({
      id: slugify(name),
      displayName: name,
    })),
    topics: uniqueStrings(paper.topics || []),
    keywordMatches: [],
    matchedQueries: [],
    matchedConcepts: [],
    relevanceScore: 0,
    citationScore: 0,
    noveltyScore: 0,
    openAccessScore: paper.isOpenAccess ? 1 : 0,
    finalScore: 0,
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

function fallbackPlan(queryGroups: QueryExpansionGroup[], tools: LiteratureProviderDiscoveredTool[]): PlannedToolCallResult {
  const firstQuery = queryGroups[0]?.query || ''
  const searchLike = tools.find(tool => /(search|paper|work|article|literature|find)/i.test(tool.name))

  return {
    rationale: searchLike
      ? ['已优先选择看起来最像检索入口的工具。']
      : ['当前未找到明显的检索工具，后续只能依赖 agent 做保守尝试。'],
    calls: searchLike && firstQuery
      ? [{
          toolName: searchLike.name,
          goal: '先拿到与核心问题最相关的一批候选论文',
          args: { query: firstQuery },
        }]
      : [],
  }
}

export async function planMcpToolCalls(params: {
  phase: 'discovery' | 'analysis'
  provider: LiteratureProviderConfig
  tools: LiteratureProviderDiscoveredTool[]
  intent: SearchIntent
  queryGroups: QueryExpansionGroup[]
  modelConfig: ModelConfig
  currentPapers?: SearchPaper[]
  suggestedQueries?: string[]
}) {
  const { phase, provider, tools, intent, queryGroups, modelConfig, currentPapers = [], suggestedQueries = [] } = params
  const fallback = fallbackPlan(queryGroups, tools)

  const systemPrompt = `你是 PaperSpark 的 MCP 检索编排智能体。
你的工作不是回答问题，而是阅读 MCP 工具目录后，为当前阶段挑选最有希望的工具并生成调用计划。

输出 JSON：
{
  "rationale": ["string"],
  "calls": [
    {
      "toolName": "必须与工具目录中的名字完全一致",
      "goal": "一句话说明此调用想拿到什么",
      "args": { "any": "json object" }
    }
  ]
}

规则：
1. discovery 阶段最多 4 个调用，analysis 阶段最多 3 个调用。
2. 优先选择与 paper / work / article / literature / search / citation / author / reference 相关的工具。
3. args 必须是 JSON object，不要输出字符串化 JSON。
4. 如果工具目录里没有合适工具，calls 返回空数组。
5. 只返回 JSON。`

  const userPrompt = `当前阶段：${phase}
Provider：${provider.name}

研究意图：
${JSON.stringify(intent, null, 2)}

查询组：
${JSON.stringify(compactQueryGroups(queryGroups), null, 2)}

补充检索提示：
${JSON.stringify(suggestedQueries.slice(0, 4), null, 2)}

当前已有候选：
${JSON.stringify(compactPapers(currentPapers), null, 2)}

可用工具目录：
${summarizeTools(tools)}

请生成调用计划。`

  try {
    const raw = await runJsonPrompt<PlannedToolCallResult>(systemPrompt, userPrompt, modelConfig)
    const allowed = new Set(tools.map(tool => tool.name))
    const calls = (raw?.calls || [])
      .filter(call => allowed.has(call.toolName) && call.args && typeof call.args === 'object' && !Array.isArray(call.args))
      .slice(0, phase === 'discovery' ? 4 : 3)

    return {
      rationale: uniqueStrings(raw?.rationale || []).slice(0, 4),
      calls: calls.length > 0 ? calls : fallback.calls,
    }
  } catch {
    return fallback
  }
}

export async function executeMcpToolCalls(params: {
  provider: LiteratureProviderConfig
  calls: PlannedToolCall[]
  report?: (event: ToolCallEvent) => void
}) {
  const { provider, calls, report } = params
  const executed: ExecutedToolCall[] = []

  for (const call of calls) {
    const output = await withToolReport(
      {
        name: `remote:${call.toolName}`,
        displayName: call.toolName,
        icon: 'tool',
        providerLabel: provider.name,
      },
      call.args,
      report,
      async () => unwrapMcpToolResult(await callMcpTool(provider, call.toolName, call.args)),
    )

    executed.push({
      ...call,
      output,
    })
  }

  return executed
}

export async function extractPapersFromMcpResults(params: {
  provider: LiteratureProviderConfig
  intent: SearchIntent
  queryGroups: QueryExpansionGroup[]
  executions: ExecutedToolCall[]
  modelConfig: ModelConfig
}) {
  const { provider, intent, queryGroups, executions, modelConfig } = params
  if (executions.length === 0) {
    return {
      summary: '',
      notes: ['当前未执行任何 MCP 工具。'],
      papers: [] as SearchPaper[],
    }
  }

  const systemPrompt = `你是 PaperSpark 的论文结果抽取智能体。
你会收到若干 MCP 工具调用的原始输出。请从中抽取真正像学术论文/文献记录的条目，并转成统一结构。

输出 JSON：
{
  "summary": "string",
  "notes": ["string"],
  "papers": [
    {
      "recordId": "string",
      "title": "string",
      "abstract": "string",
      "authors": ["string"],
      "authorIds": ["string"],
      "year": 2024,
      "publicationDate": "string",
      "venue": "string",
      "doi": "string",
      "url": "string",
      "pdfUrl": "string",
      "citedByCount": 12,
      "isOpenAccess": true,
      "oaStatus": "gold",
      "sourceType": "journal",
      "concepts": ["string"],
      "topics": ["string"]
    }
  ]
}

规则：
1. 只抽取看起来像论文、article、paper、work、publication 的记录。
2. papers 最多 16 条。
3. 缺失字段允许留空，但 title 必须可靠。
4. notes 给 2 到 4 条公开可展示说明。
5. 只返回 JSON。`

  const executionPayload = executions.map(item => ({
    toolName: item.toolName,
    goal: item.goal,
    args: item.args,
    output: truncateValue(item.output),
  }))

  const userPrompt = `Provider：${provider.name}

研究意图：
${JSON.stringify(intent, null, 2)}

查询组：
${JSON.stringify(compactQueryGroups(queryGroups), null, 2)}

工具执行结果：
${JSON.stringify(executionPayload, null, 2)}`

  const raw = await runJsonPrompt<ExtractionResult>(systemPrompt, userPrompt, modelConfig)
  const papers = (raw?.papers || [])
    .map(paper => normalizeExtractedPaper(provider, paper))
    .filter((paper): paper is SearchPaper => Boolean(paper))

  return {
    summary: raw?.summary || '',
    notes: uniqueStrings(raw?.notes || []).slice(0, 4),
    papers,
  }
}
