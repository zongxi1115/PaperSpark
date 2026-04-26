import { NextResponse } from 'next/server'
import type { WorkspaceSnapshot } from '@/lib/workspaceSnapshot'
import {
  WorkspaceBridgeUnavailableError,
  isWorkspaceSnapshot,
  jsonHeaders,
  readWorkspaceBridgeSnapshot,
  writeWorkspaceBridgeSnapshot,
} from '@/lib/server/workspaceBridge'

export async function GET() {
  try {
    const record = await readWorkspaceBridgeSnapshot()
    return new NextResponse(record.raw, { headers: jsonHeaders() })
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
    const snapshot = await request.json() as WorkspaceSnapshot
    if (!isWorkspaceSnapshot(snapshot)) {
      return NextResponse.json(
        { error: '无效的工作区桥接数据' },
        { status: 400, headers: jsonHeaders() },
      )
    }

    const result = await writeWorkspaceBridgeSnapshot(snapshot)

    return NextResponse.json(
      {
        success: true,
        filePath: result.filePath,
        syncedAt: result.syncedAt,
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
