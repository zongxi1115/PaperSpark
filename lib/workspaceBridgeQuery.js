const DEFAULT_SEARCH_LIMIT = 10

export class WorkspaceQueryError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'WorkspaceQueryError'
    this.status = status
  }
}

export function executeWorkspaceQuery(snapshot, input = {}) {
  ensureSnapshot(snapshot)

  const command = String(input.command || '').trim().toLowerCase()

  switch (command) {
    case 'summary':
      return buildSummary(snapshot, input.sourceLabel || 'workspace-bridge')
    case 'list':
      return listSection(snapshot, input.section)
    case 'get':
      return getSectionItem(snapshot, input.section, input.id, input.field)
    case 'dump':
      return dumpSection(snapshot, input.section, input.field)
    case 'search':
      return searchSnapshot(snapshot, input.query, input.limit)
    default:
      throw new WorkspaceQueryError(`未知命令: ${input.command || '(empty)'}`)
  }
}

export function buildSummary(snapshot, sourceLabel = 'workspace-bridge') {
  ensureSnapshot(snapshot)
  return {
    snapshotSource: sourceLabel,
    schemaVersion: snapshot.schemaVersion,
    exportedAt: snapshot.exportedAt,
    origin: snapshot.origin,
    stats: snapshot.stats,
    availableSections: Object.keys(snapshot.data),
  }
}

export function listSection(snapshot, sectionName) {
  const { key, value } = getSection(snapshot, sectionName)

  if (!Array.isArray(value)) {
    throw new WorkspaceQueryError(`section ${key} 不是列表，不能使用 list`)
  }

  return value.map(item => toCompactItem(key, item))
}

export function getSectionItem(snapshot, sectionName, id, field) {
  if (!sectionName) throw new WorkspaceQueryError('get 需要 section')
  if (!id) throw new WorkspaceQueryError('get 需要 id')

  const { key, value } = getSection(snapshot, sectionName)
  if (!Array.isArray(value)) {
    throw new WorkspaceQueryError(`section ${key} 不是列表，不能使用 get`)
  }

  const item = value.find(entry => String(entry?.id) === String(id))
  if (!item) {
    throw new WorkspaceQueryError(`在 ${key} 中未找到 id=${id}`, 404)
  }

  return field ? getByPath(item, field) : item
}

export function dumpSection(snapshot, sectionName, field) {
  if (!sectionName) {
    return field ? getByPath(snapshot, field) : snapshot
  }

  const { value } = getSection(snapshot, sectionName)
  return field ? getByPath(value, field) : value
}

export function searchSnapshot(snapshot, query, limit) {
  const normalizedQuery = String(query || '').trim()
  if (!normalizedQuery) throw new WorkspaceQueryError('search 需要查询词')

  const parsedLimit = Number.parseInt(`${limit || DEFAULT_SEARCH_LIMIT}`, 10)
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_SEARCH_LIMIT

  const results = buildSearchCorpus(snapshot)
    .map(entry => scoreEntry(entry, normalizedQuery))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, safeLimit)

  return {
    query: normalizedQuery,
    total: results.length,
    results,
  }
}

export function normalizeSectionName(name) {
  const normalized = String(name || '').trim().toLowerCase()
  const aliases = {
    documents: 'documents',
    docs: 'documents',
    document: 'documents',
    documentversions: 'documentVersions',
    versions: 'documentVersions',
    version: 'documentVersions',
    knowledge: 'knowledge',
    knowledgeitems: 'knowledge',
    knowledgeitem: 'knowledge',
    items: 'knowledge',
    assets: 'assets',
    asset: 'assets',
    assettypes: 'assetTypes',
    assettype: 'assetTypes',
    thoughts: 'thoughts',
    thought: 'thoughts',
    agents: 'agents',
    conversations: 'conversations',
    conversation: 'conversations',
    assistantnotes: 'assistantNotes',
    note: 'assistantNotes',
    notes: 'assistantNotes',
    knowledgegraph: 'knowledgeGraph',
    graph: 'knowledgeGraph',
    settings: 'settings',
    zotero: 'zotero',
    theme: 'theme',
  }

  return aliases[normalized] || String(name || '').trim()
}

export function getSection(snapshot, sectionName) {
  if (!sectionName) throw new WorkspaceQueryError('需要指定 section')
  const key = normalizeSectionName(sectionName)

  if (!(key in snapshot.data)) {
    throw new WorkspaceQueryError(`未知 section: ${sectionName}`)
  }

  return {
    key,
    value: snapshot.data[key],
  }
}

function ensureSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.data || typeof snapshot.data !== 'object') {
    throw new WorkspaceQueryError('工作区桥接数据格式无效', 500)
  }
}

function buildSearchCorpus(snapshot) {
  const corpus = []

  for (const doc of snapshot.data.documents || []) {
    corpus.push({
      section: 'documents',
      id: doc.id,
      title: doc.title,
      updatedAt: doc.updatedAt,
      text: [doc.title, doc.articleTitle, doc.articleAbstract, doc.plainText].filter(Boolean).join('\n'),
    })
  }

  for (const item of snapshot.data.knowledge || []) {
    const guideSummary = item.immersive?.guide?.summary
      ? [
          item.immersive.guide.summary.background,
          item.immersive.guide.summary.methods,
          item.immersive.guide.summary.conclusions,
          ...(item.immersive.guide.summary.keyPoints || []),
        ].filter(Boolean).join('\n')
      : ''

    corpus.push({
      section: 'knowledge',
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      text: [
        item.title,
        item.overviewText,
        item.abstract,
        item.cachedSummary,
        item.immersive?.fullText,
        guideSummary,
      ].filter(Boolean).join('\n'),
    })
  }

  for (const asset of snapshot.data.assets || []) {
    corpus.push({
      section: 'assets',
      id: asset.id,
      title: asset.title,
      updatedAt: asset.updatedAt,
      text: [asset.title, asset.summary, asset.plainText, ...(asset.tags || [])].filter(Boolean).join('\n'),
    })
  }

  for (const thought of snapshot.data.thoughts || []) {
    corpus.push({
      section: 'thoughts',
      id: thought.id,
      title: thought.title,
      updatedAt: thought.updatedAt,
      text: [thought.title, thought.summary, thought.plainText].filter(Boolean).join('\n'),
    })
  }

  for (const conversation of snapshot.data.conversations || []) {
    corpus.push({
      section: 'conversations',
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      text: [
        conversation.title,
        ...(conversation.messages || []).map(message => message.content || ''),
      ].filter(Boolean).join('\n'),
    })
  }

  return corpus
}

function scoreEntry(entry, query) {
  const normalizedText = normalize(entry.text)
  const normalizedTitle = normalize(entry.title)
  const tokens = tokenize(query)
  if (tokens.length === 0) return null

  let score = 0
  for (const token of tokens) {
    if (normalizedTitle.includes(token)) score += 5
    if (normalizedText.includes(token)) score += 1
  }

  if (score <= 0) return null

  return {
    section: entry.section,
    id: entry.id,
    title: entry.title,
    updatedAt: entry.updatedAt,
    score,
    snippet: createSnippet(entry.text, tokens),
  }
}

function toCompactItem(section, item) {
  if (!item || typeof item !== 'object') return item

  switch (section) {
    case 'documents':
      return {
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        previewText: item.previewText,
      }
    case 'documentVersions':
      return {
        id: item.id,
        documentId: item.documentId,
        title: item.title,
        createdAt: item.createdAt,
        previewText: item.previewText,
      }
    case 'knowledge':
      return {
        id: item.id,
        title: item.title,
        year: item.year || null,
        journal: item.journal || null,
        updatedAt: item.updatedAt,
        hasImmersiveCache: Boolean(item.immersive),
        hasFullText: Boolean(item.immersive?.fullText),
        overviewText: item.overviewText,
      }
    case 'assets':
      return {
        id: item.id,
        title: item.title,
        typeId: item.typeId,
        updatedAt: item.updatedAt,
        previewText: item.previewText,
        tags: item.tags || [],
      }
    case 'thoughts':
      return {
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        previewText: item.previewText,
      }
    case 'conversations':
      return {
        id: item.id,
        title: item.title,
        updatedAt: item.updatedAt,
        messageCount: Array.isArray(item.messages) ? item.messages.length : 0,
      }
    case 'assistantNotes':
      return {
        id: item.id,
        updatedAt: item.updatedAt,
        previewText: createSnippet(item.content || '', []),
      }
    case 'agents':
      return {
        id: item.id,
        title: item.title,
        isPreset: Boolean(item.isPreset),
        isDefault: Boolean(item.isDefault),
      }
    case 'assetTypes':
      return {
        id: item.id,
        name: item.name,
        description: item.description || '',
        isPreset: Boolean(item.isPreset),
      }
    default:
      return item
  }
}

function getByPath(value, fieldPath) {
  const segments = String(fieldPath || '')
    .split('.')
    .map(segment => segment.trim())
    .filter(Boolean)

  let current = value
  for (const segment of segments) {
    if (current == null) return null

    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)]
      continue
    }

    current = current[segment]
  }

  return current
}

function createSnippet(text, tokens) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''

  const searchTokens = tokens.length > 0 ? tokens : tokenize(normalized).slice(0, 1)
  const lower = normalized.toLowerCase()
  const firstHit = searchTokens
    .map(token => lower.indexOf(token))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0]

  if (firstHit == null) {
    return normalized.length <= 180 ? normalized : `${normalized.slice(0, 180)}...`
  }

  const start = Math.max(0, firstHit - 60)
  const end = Math.min(normalized.length, firstHit + 120)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < normalized.length ? '...' : ''
  return `${prefix}${normalized.slice(start, end)}${suffix}`
}

function tokenize(input) {
  return normalize(input)
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}

function normalize(input) {
  return String(input || '').toLowerCase()
}
