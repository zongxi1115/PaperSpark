import { NextResponse } from 'next/server'
import { executeWorkspaceQuery, WorkspaceQueryError } from '@/lib/workspaceBridgeQuery'
import {
  WorkspaceBridgeUnavailableError,
  jsonHeaders,
  readWorkspaceBridgeSnapshot,
} from '@/lib/server/workspaceBridge'

type QueryPayload = {
  command?: unknown
  section?: unknown
  id?: unknown
  field?: unknown
  query?: unknown
  limit?: unknown
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  return handleQuery({
    command: url.searchParams.get('command'),
    section: url.searchParams.get('section'),
    id: url.searchParams.get('id'),
    field: url.searchParams.get('field'),
    query: url.searchParams.get('query'),
    limit: url.searchParams.get('limit'),
  })
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as QueryPayload
  return handleQuery(payload)
}

async function handleQuery(payload: QueryPayload) {
  try {
    const record = await readWorkspaceBridgeSnapshot()
    const data = executeWorkspaceQuery(record.snapshot, {
      command: typeof payload.command === 'string' ? payload.command : '',
      section: typeof payload.section === 'string' ? payload.section : '',
      id: typeof payload.id === 'string' ? payload.id : '',
      field: typeof payload.field === 'string' ? payload.field : '',
      query: typeof payload.query === 'string' ? payload.query : '',
      limit: payload.limit,
      sourceLabel: 'workspace-bridge',
    })

    return NextResponse.json(
      {
        data,
        source: {
          filePath: record.filePath,
          exportedAt: record.snapshot.exportedAt,
          syncedAt: record.syncedAt,
          origin: record.snapshot.origin,
        },
      },
      { headers: jsonHeaders() },
    )
  } catch (error) {
    if (error instanceof WorkspaceBridgeUnavailableError) {
      return NextResponse.json(
        {
          error: error.message,
          message: '请先保持 PaperSpark 页面打开几秒钟，等待自动桥接，或在设置页点击“立即同步”。',
        },
        { status: error.status, headers: jsonHeaders() },
      )
    }

    if (error instanceof WorkspaceQueryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status || 400, headers: jsonHeaders() },
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '工作区查询失败' },
      { status: 500, headers: jsonHeaders() },
    )
  }
}
