import fs from 'node:fs/promises'
import path from 'node:path'
import type { WorkspaceSnapshot } from '@/lib/workspaceSnapshot'
import { DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME } from '@/lib/workspaceSnapshot'

export const WORKSPACE_BRIDGE_DIR = path.join(process.cwd(), 'out', 'workspace-cli')
export const WORKSPACE_BRIDGE_FILE_NAME = 'paperspark-workspace-bridge.json'
export const WORKSPACE_BRIDGE_FILE = path.join(WORKSPACE_BRIDGE_DIR, WORKSPACE_BRIDGE_FILE_NAME)

const LEGACY_BRIDGE_FILES = [
  path.join(WORKSPACE_BRIDGE_DIR, DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME),
  path.join(process.cwd(), 'out', DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME),
]

export class WorkspaceBridgeUnavailableError extends Error {
  status = 404

  constructor(message = '本地服务暂未接收到 PaperSpark 工作区数据') {
    super(message)
    this.name = 'WorkspaceBridgeUnavailableError'
  }
}

export function jsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
}

export async function writeWorkspaceBridgeSnapshot(snapshot: WorkspaceSnapshot) {
  if (!isWorkspaceSnapshot(snapshot)) {
    throw new Error('无效的工作区桥接数据')
  }

  await fs.mkdir(WORKSPACE_BRIDGE_DIR, { recursive: true })
  await fs.writeFile(WORKSPACE_BRIDGE_FILE, JSON.stringify(snapshot, null, 2), 'utf8')
  const stat = await fs.stat(WORKSPACE_BRIDGE_FILE)

  return {
    filePath: WORKSPACE_BRIDGE_FILE,
    syncedAt: stat.mtime.toISOString(),
    snapshot,
  }
}

export async function readWorkspaceBridgeSnapshot() {
  for (const candidate of [WORKSPACE_BRIDGE_FILE, ...LEGACY_BRIDGE_FILES]) {
    try {
      const raw = await fs.readFile(candidate, 'utf8')
      const parsed = JSON.parse(raw)
      if (!isWorkspaceSnapshot(parsed)) {
        continue
      }

      const stat = await fs.stat(candidate)

      return {
        filePath: candidate,
        raw,
        snapshot: parsed,
        syncedAt: stat.mtime.toISOString(),
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code === 'ENOENT') continue
      throw error
    }
  }

  throw new WorkspaceBridgeUnavailableError(
    '本地服务暂未接收到 PaperSpark 工作区数据，请先打开应用，等待自动桥接，或在设置页点击“立即同步”。',
  )
}

export async function getWorkspaceBridgeStatus() {
  try {
    const record = await readWorkspaceBridgeSnapshot()
    const exportedAtMs = Date.parse(record.snapshot.exportedAt)
    const ageMs = Number.isFinite(exportedAtMs) ? Math.max(0, Date.now() - exportedAtMs) : null

    return {
      available: true,
      filePath: record.filePath,
      syncedAt: record.syncedAt,
      exportedAt: record.snapshot.exportedAt,
      ageMs,
      origin: record.snapshot.origin,
      schemaVersion: record.snapshot.schemaVersion,
      stats: record.snapshot.stats,
      sections: Object.keys(record.snapshot.data),
    }
  } catch (error) {
    if (error instanceof WorkspaceBridgeUnavailableError) {
      return {
        available: false,
        filePath: WORKSPACE_BRIDGE_FILE,
        syncedAt: null,
        exportedAt: null,
        ageMs: null,
        origin: null,
        schemaVersion: null,
        stats: null,
        sections: [],
        message: error.message,
      }
    }

    throw error
  }
}

export function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as WorkspaceSnapshot).schemaVersion === 'number'
    && typeof (value as WorkspaceSnapshot).exportedAt === 'string'
    && (value as WorkspaceSnapshot).data
    && typeof (value as WorkspaceSnapshot).data === 'object',
  )
}
