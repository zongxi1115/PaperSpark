#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { executeWorkspaceQuery } from '../lib/workspaceBridgeQuery.js'

const DEFAULT_FILE_NAME = 'paperspark-workspace-snapshot.json'
const DEFAULT_SERVER_URL = process.env.PAPERSPARK_SERVER_URL || 'http://127.0.0.1:3000'

const argv = process.argv.slice(2)
const { positionals, options } = parseArgs(argv)

if (options.help || positionals.length === 0) {
  printHelp()
  process.exit(0)
}

const command = positionals[0]
const queryInput = buildQueryInput(command, positionals, options)

try {
  const source = await resolveSource(options)
  const result = source.type === 'server'
    ? await executeServerQuery(source.serverUrl, queryInput)
    : executeWorkspaceQuery(loadSnapshot(source.snapshotPath), {
        ...queryInput,
        sourceLabel: source.snapshotPath,
      })

  if (command === 'summary' && source.type === 'server' && result && typeof result === 'object') {
    result.snapshotSource = `${source.serverUrl}/api/workspace-cli/query`
  }

  outputValue(result, options)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

function buildQueryInput(command, positionals, options) {
  switch (command) {
    case 'summary':
      return { command: 'summary' }
    case 'list':
      return {
        command: 'list',
        section: positionals[1],
      }
    case 'get':
      return {
        command: 'get',
        section: positionals[1],
        id: positionals[2],
        field: options.field,
      }
    case 'dump':
      return {
        command: 'dump',
        section: positionals[1],
        field: options.field,
      }
    case 'search':
      return {
        command: 'search',
        query: positionals.slice(1).join(' '),
        limit: options.limit,
      }
    default:
      throw new Error(`未知命令: ${command}`)
  }
}

async function resolveSource(options) {
  if (options.snapshot) {
    return {
      type: 'snapshot',
      snapshotPath: resolveSnapshotPath(options.snapshot),
    }
  }

  return {
    type: 'server',
    serverUrl: normalizeServerUrl(options.server || DEFAULT_SERVER_URL),
  }
}

async function executeServerQuery(serverUrl, input) {
  const response = await fetch(`${serverUrl}/api/workspace-cli/query`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      payload?.error
        || payload?.message
        || `服务返回 HTTP ${response.status}`,
    )
  }

  return payload?.data
}

function loadSnapshot(snapshotPath) {
  const raw = fs.readFileSync(snapshotPath, 'utf8')
  const parsed = JSON.parse(raw)

  if (!parsed || typeof parsed !== 'object' || !parsed.data) {
    fail('快照文件格式无效')
  }

  return parsed
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
      `请检查 --snapshot 路径，或先导出 ${DEFAULT_FILE_NAME} 作为离线备份。`,
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
  node scripts/paperspark-data-cli.mjs <command> [args]
  node scripts/paperspark-data-cli.mjs <command> [args] --server ${DEFAULT_SERVER_URL}
  node scripts/paperspark-data-cli.mjs <command> [args] --snapshot path

Commands:
  summary
    输出工作区桥接概要与统计信息

  list <section>
    输出 section 的精简列表

  get <section> <id> [--field path] [--raw]
    输出指定条目的完整 JSON，或只取某个字段
    例: node scripts/paperspark-data-cli.mjs get knowledge abc123 --field immersive.fullText --raw

  dump [section] [--field path]
    输出整个工作区桥接数据，或某个 section

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
  settings
  zotero
  theme

Default mode:
  默认直接请求本地服务 ${DEFAULT_SERVER_URL} 的 /api/workspace-cli/query，
  不需要再手动指定快照目录。

Offline fallback:
  只有在你显式传入 --snapshot 时，CLI 才会读取本地 JSON 备份文件。
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
