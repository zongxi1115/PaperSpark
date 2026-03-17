#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_FILE_NAME = 'paperspark-workspace-snapshot.json'
const DEFAULT_SEARCH_LIMIT = 10

const argv = process.argv.slice(2)
const { positionals, options } = parseArgs(argv)

if (options.help || positionals.length === 0) {
  printHelp()
  process.exit(0)
}

const command = positionals[0]

try {
  const source = await resolveSnapshotSource(options)
  const snapshot = source.snapshot

  switch (command) {
    case 'summary':
      printJson(buildSummary(snapshot, source.label))
      break
    case 'list':
      handleList(snapshot, positionals[1])
      break
    case 'get':
      handleGet(snapshot, positionals[1], positionals[2], options)
      break
    case 'dump':
      handleDump(snapshot, positionals[1], options)
      break
    case 'search':
      handleSearch(snapshot, positionals.slice(1).join(' '), options)
      break
    default:
      fail(`未知命令: ${command}`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

function handleList(snapshot, sectionName) {
  const { key, value } = getSection(snapshot, sectionName)

  if (!Array.isArray(value)) {
    fail(`section ${key} 不是列表，不能使用 list`)
  }

  printJson(value.map(item => toCompactItem(key, item)))
}

function handleGet(snapshot, sectionName, id, options) {
  if (!sectionName) fail('get 需要 section')
  if (!id) fail('get 需要 id')

  const { key, value } = getSection(snapshot, sectionName)
  if (!Array.isArray(value)) {
    fail(`section ${key} 不是列表，不能使用 get`)
  }

  const item = value.find(entry => String(entry?.id) === String(id))
  if (!item) {
    fail(`在 ${key} 中未找到 id=${id}`)
  }

  const result = options.field ? getByPath(item, options.field) : item
  outputValue(result, options)
}

function handleDump(snapshot, sectionName, options) {
  if (!sectionName) {
    outputValue(snapshot, options)
    return
  }

  const { value } = getSection(snapshot, sectionName)
  const result = options.field ? getByPath(value, options.field) : value
  outputValue(result, options)
}

function handleSearch(snapshot, query, options) {
  if (!query.trim()) fail('search 需要查询词')

  const limit = Number.parseInt(options.limit || `${DEFAULT_SEARCH_LIMIT}`, 10)
  const results = buildSearchCorpus(snapshot)
    .map(entry => scoreEntry(entry, query))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_SEARCH_LIMIT)

  printJson({
    query,
    total: results.length,
    results,
  })
}

function buildSummary(snapshot, snapshotPath) {
  return {
    snapshotSource: snapshotPath,
    schemaVersion: snapshot.schemaVersion,
    exportedAt: snapshot.exportedAt,
    origin: snapshot.origin,
    stats: snapshot.stats,
    availableSections: Object.keys(snapshot.data),
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

function getSection(snapshot, sectionName) {
  if (!sectionName) fail('需要指定 section')
  const key = normalizeSectionName(sectionName)

  if (!(key in snapshot.data)) {
    fail(`未知 section: ${sectionName}`)
  }

  return {
    key,
    value: snapshot.data[key],
  }
}

function normalizeSectionName(name) {
  const normalized = String(name).trim().toLowerCase()
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
  }

  return aliases[normalized] || String(name).trim()
}

function loadSnapshot(snapshotPath) {
  const raw = fs.readFileSync(snapshotPath, 'utf8')
  const parsed = JSON.parse(raw)

  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    fail('快照文件格式无效')
  }

  return parsed
}

async function resolveSnapshotSource(options) {
  if (options.server) {
    const serverUrl = normalizeServerUrl(options.server)
    const response = await fetch(`${serverUrl}/api/workspace-cli/snapshot`, {
      headers: {
        Accept: 'application/json',
      },
    })

    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(payload?.error || `服务返回 HTTP ${response.status}`)
    }

    return {
      snapshot: payload,
      label: `${serverUrl}/api/workspace-cli/snapshot`,
    }
  }

  const snapshotPath = resolveSnapshotPath(options.snapshot)
  return {
    snapshot: loadSnapshot(snapshotPath),
    label: snapshotPath,
  }
}

function resolveSnapshotPath(userProvidedPath) {
  const candidates = []
  if (userProvidedPath) candidates.push(path.resolve(userProvidedPath))
  candidates.push(path.resolve(process.cwd(), 'out', 'workspace-cli', DEFAULT_FILE_NAME))
  candidates.push(path.resolve(process.cwd(), 'out', DEFAULT_FILE_NAME))
  candidates.push(path.resolve(process.cwd(), DEFAULT_FILE_NAME))

  const found = candidates.find(candidate => fs.existsSync(candidate))
  if (found) return found

  throw new Error(
    [
      '未找到快照文件。',
      `请先在设置页导出 ${DEFAULT_FILE_NAME}，然后使用 --snapshot 指定路径，或将文件放到 ./out/${DEFAULT_FILE_NAME}。`,
    ].join(' '),
  )
}

function outputValue(value, options) {
  if (options.raw && typeof value === 'string') {
    process.stdout.write(value)
    if (!value.endsWith('\n')) process.stdout.write('\n')
    return
  }

  printJson(value)
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function getByPath(value, fieldPath) {
  const segments = String(fieldPath)
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

function parseArgs(args) {
  const positionals = []
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]

    if (current === '--help' || current === '-h') {
      options.help = true
      continue
    }

    if (current === '--raw') {
      options.raw = true
      continue
    }

    if (current === '--snapshot') {
      options.snapshot = args[index + 1]
      index += 1
      continue
    }

    if (current === '--server') {
      options.server = args[index + 1]
      index += 1
      continue
    }

    if (current === '--field') {
      options.field = args[index + 1]
      index += 1
      continue
    }

    if (current === '--limit') {
      options.limit = args[index + 1]
      index += 1
      continue
    }

    positionals.push(current)
  }

  return { positionals, options }
}

function printHelp() {
  const help = `
PaperSpark workspace data CLI

Usage:
  node scripts/paperspark-data-cli.mjs <command> [args] [--snapshot path]
  node scripts/paperspark-data-cli.mjs <command> [args] [--server http://127.0.0.1:3000]

Commands:
  summary
    输出快照概要与统计信息

  list <section>
    输出 section 的精简列表

  get <section> <id> [--field path] [--raw]
    输出指定条目的完整 JSON，或只取某个字段
    例: node scripts/paperspark-data-cli.mjs get knowledge abc123 --field immersive.fullText --raw

  dump [section] [--field path]
    输出整个快照或某个 section

  search <query> [--limit 10]
    在文档、知识库、资产、随记、助手会话中做全文检索

Sections:
  documents
  documentVersions
  knowledge
  assets
  assetTypes
  thoughts
  agents
  conversations
  assistantNotes
  knowledgeGraph

Snapshot path:
  默认会依次查找:
  1. --snapshot 指定路径
  2. ./out/workspace-cli/${DEFAULT_FILE_NAME}
  3. ./out/${DEFAULT_FILE_NAME}
  4. ./${DEFAULT_FILE_NAME}

Server mode:
  先在设置页点击“同步到本地服务”，再用 --server 调用运行中的 Next 服务。
`.trim()

  process.stdout.write(`${help}\n`)
}

function normalizeServerUrl(input) {
  return String(input || '')
    .trim()
    .replace(/\/+$/, '')
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
