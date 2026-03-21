import { NextRequest, NextResponse } from 'next/server'
import {
  acknowledgeKnowledgeParseTask,
  cancelKnowledgeParseTask,
  enqueueKnowledgeParseTask,
  ensureKnowledgeParseQueueProcessing,
  getKnowledgeParseTaskResult,
  listKnowledgeParseTasks,
} from '@/lib/server/knowledgeParseQueue'
import type { KnowledgeItem, ModelConfig } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type BatchEnqueueRequest = {
  items?: Array<{
    taskId: string
    title: string
    fileName: string
    sourceType: KnowledgeItem['sourceType']
    remoteUrl?: string
    metadataModelConfig?: ModelConfig | null
    itemSnapshot: Pick<KnowledgeItem, 'id' | 'title' | 'authors' | 'abstract' | 'year' | 'journal'>
  }>
}

type AckRequest = {
  action?: 'ack'
  taskId?: string
  success?: boolean
  error?: string
}

export async function GET(request: NextRequest) {
  try {
    ensureKnowledgeParseQueueProcessing()
    const taskId = request.nextUrl.searchParams.get('taskId')
    const includeResult = request.nextUrl.searchParams.get('includeResult') === 'true'

    if (taskId && includeResult) {
      const payload = await getKnowledgeParseTaskResult(taskId)
      if (!payload) {
        return NextResponse.json({ error: '任务不存在' }, { status: 404 })
      }
      return NextResponse.json({ success: true, ...payload })
    }

    const tasks = await listKnowledgeParseTasks()
    return NextResponse.json({ success: true, tasks })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '获取任务状态失败' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const body = await request.json() as BatchEnqueueRequest | AckRequest
      if ('action' in body && body.action === 'ack') {
        if (!body.taskId || typeof body.success !== 'boolean') {
          return NextResponse.json({ error: '缺少确认参数' }, { status: 400 })
        }
        const task = await acknowledgeKnowledgeParseTask(body.taskId, body.success, body.error)
        return NextResponse.json({ success: true, task })
      }

      const enqueueBody = body as BatchEnqueueRequest
      if (!Array.isArray(enqueueBody.items) || enqueueBody.items.length === 0) {
        return NextResponse.json({ error: '缺少任务列表' }, { status: 400 })
      }

      const tasks = []
      for (const item of enqueueBody.items) {
        tasks.push(await enqueueKnowledgeParseTask(item))
      }

      ensureKnowledgeParseQueueProcessing()
      return NextResponse.json({ success: true, tasks })
    }

    const form = await request.formData()
    const taskId = form.get('taskId')
    const title = form.get('title')
    const fileName = form.get('fileName')
    const sourceType = form.get('sourceType')
    const itemSnapshotRaw = form.get('itemSnapshot')
    const metadataModelConfigRaw = form.get('metadataModelConfig')
    const file = form.get('file')

    if (
      typeof taskId !== 'string' ||
      typeof title !== 'string' ||
      typeof fileName !== 'string' ||
      typeof sourceType !== 'string' ||
      typeof itemSnapshotRaw !== 'string'
    ) {
      return NextResponse.json({ error: '缺少任务参数' }, { status: 400 })
    }

    const itemSnapshot = JSON.parse(itemSnapshotRaw) as Pick<KnowledgeItem, 'id' | 'title' | 'authors' | 'abstract' | 'year' | 'journal'>
    const metadataModelConfig = typeof metadataModelConfigRaw === 'string' && metadataModelConfigRaw
      ? JSON.parse(metadataModelConfigRaw) as ModelConfig
      : null

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少 PDF 文件' }, { status: 400 })
    }

    const task = await enqueueKnowledgeParseTask({
      taskId,
      title,
      fileName,
      sourceType: sourceType as KnowledgeItem['sourceType'],
      file,
      metadataModelConfig,
      itemSnapshot,
    })

    ensureKnowledgeParseQueueProcessing()
    return NextResponse.json({ success: true, task })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '创建解析任务失败' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId')
    if (!taskId) {
      return NextResponse.json({ error: '缺少 taskId' }, { status: 400 })
    }
    const task = await cancelKnowledgeParseTask(taskId)
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 })
    }
    return NextResponse.json({ success: true, task })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '暂停任务失败' },
      { status: 400 },
    )
  }
}
