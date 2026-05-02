import fs from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { resolveRuntimeUploadPath } from '@/lib/server/runtimePaths'

const CONTENT_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

function sanitizeSegment(value: string) {
  return path.basename(value)
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ category: string; fileName: string }> },
) {
  try {
    const { category, fileName } = await context.params
    const safeCategory = sanitizeSegment(category)
    const safeFileName = sanitizeSegment(fileName)
    const filePath = resolveRuntimeUploadPath(safeCategory, safeFileName)
    const buffer = await fs.readFile(filePath)
    const ext = path.extname(safeFileName).toLowerCase()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '读取文件失败' },
      { status: 500 },
    )
  }
}
