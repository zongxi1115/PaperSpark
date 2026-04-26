import { NextResponse } from 'next/server'
import { jsonHeaders, getWorkspaceBridgeStatus } from '@/lib/server/workspaceBridge'

export async function GET() {
  try {
    const status = await getWorkspaceBridgeStatus()
    return NextResponse.json(status, { headers: jsonHeaders() })
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        error: error instanceof Error ? error.message : '读取桥接状态失败',
      },
      { status: 500, headers: jsonHeaders() },
    )
  }
}
