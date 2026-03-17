import fs from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME } from '@/lib/workspaceSnapshot'

const SNAPSHOT_DIR = path.join(process.cwd(), 'out', 'workspace-cli')
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME)

function jsonHeaders() {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
}

export async function GET() {
  try {
    const raw = await fs.readFile(SNAPSHOT_FILE, 'utf8')
    return new NextResponse(raw, { headers: jsonHeaders() })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      return NextResponse.json(
        {
          error: '尚未同步 CLI 快照到服务端',
          message: '请先在设置页点击“同步到本地服务”',
        },
        { status: 404, headers: jsonHeaders() },
      )
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '读取快照失败',
      },
      { status: 500, headers: jsonHeaders() },
    )
  }
}

export async function POST(request: Request) {
  try {
    const snapshot = await request.json() as {
      schemaVersion?: unknown
      exportedAt?: unknown
      data?: unknown
      stats?: unknown
    }

    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      typeof snapshot.schemaVersion !== 'number' ||
      typeof snapshot.exportedAt !== 'string' ||
      !snapshot.data ||
      typeof snapshot.data !== 'object'
    ) {
      return NextResponse.json(
        { error: '无效的快照数据' },
        { status: 400, headers: jsonHeaders() },
      )
    }

    await fs.mkdir(SNAPSHOT_DIR, { recursive: true })
    await fs.writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf8')

    return NextResponse.json(
      {
        success: true,
        filePath: SNAPSHOT_FILE,
        exportedAt: snapshot.exportedAt,
        schemaVersion: snapshot.schemaVersion,
        stats: snapshot.stats ?? null,
      },
      { headers: jsonHeaders() },
    )
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : '保存快照失败',
      },
      { status: 500, headers: jsonHeaders() },
    )
  }
}
