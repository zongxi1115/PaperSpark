import { NextRequest, NextResponse } from 'next/server'
import { extractMetadata, generateSummary } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SURYA_SERVICE_URL = process.env.SURYA_OCR_SERVICE_URL || 'http://127.0.0.1:8765'

interface SuryaParseResponse {
  document_name: string
  page_count: number
  full_text: string
  structure_counts: Record<string, number>
  pages: Array<{
    page: number
    image_bbox: number[]
    full_text: string
    structure_counts: Record<string, number>
    layout_regions: Array<{
      label: string
      confidence?: number
      position: number
      bbox: number[]
      polygon: number[][]
      line_count: number
      text: string
    }>
  }>
  artifacts?: Record<string, string>
}

interface SuryaJobStatusResponse {
  success: boolean
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage: string
  created_at: string
  updated_at: string
  file_name: string
  output_name?: string
  page_range?: string
  error?: string
  page_count?: number
  full_text_length?: number
  result_available: boolean
}

interface SuryaJobResultResponse extends SuryaJobStatusResponse {
  parsed?: SuryaParseResponse | null
}

interface SuryaResultRequest {
  jobId: string
  includeSummary?: boolean
  includeMetadata?: boolean
  modelConfig?: ModelConfig
  fileName?: string
}

async function proxyToSurya(path: string, init?: RequestInit) {
  return fetch(`${SURYA_SERVICE_URL}${path}`, {
    cache: 'no-store',
    ...init,
  })
}

async function handleJobSubmission(request: NextRequest) {
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 PDF 文件' }, { status: 400 })
  }

  const upstreamForm = new FormData()
  upstreamForm.set('file', file)

  const pageRange = form.get('pageRange')
  if (typeof pageRange === 'string' && pageRange.trim()) {
    upstreamForm.set('page_range', pageRange)
  }

  const keepOutputs = form.get('keepOutputs')
  if (typeof keepOutputs === 'string') {
    upstreamForm.set('keep_outputs', keepOutputs)
  }

  const outputName = form.get('outputName')
  if (typeof outputName === 'string' && outputName.trim()) {
    upstreamForm.set('output_name', outputName)
  }

  const parseResponse = await proxyToSurya('/jobs', {
    method: 'POST',
    body: upstreamForm,
  })

  const payload = await parseResponse.json().catch(() => null)
  if (!parseResponse.ok) {
    return NextResponse.json(
      { error: 'Surya 任务提交失败', detail: payload?.detail || payload?.error || null },
      { status: parseResponse.status },
    )
  }

  return NextResponse.json(payload)
}

async function handleJobResult(request: NextRequest) {
  const body = await request.json() as SuryaResultRequest
  if (!body.jobId) {
    return NextResponse.json({ error: '缺少 jobId' }, { status: 400 })
  }

  const resultResponse = await proxyToSurya(`/jobs/${body.jobId}/result`)
  const payload = await resultResponse.json().catch(() => null) as SuryaJobResultResponse | null

  if (!resultResponse.ok && resultResponse.status !== 202) {
    return NextResponse.json(
      { error: 'Surya 结果获取失败', detail: payload?.error || payload || null },
      { status: resultResponse.status },
    )
  }

  if (!payload) {
    return NextResponse.json({ error: 'Surya 返回空结果' }, { status: 500 })
  }

  if (payload.status !== 'completed' || !payload.parsed) {
    return NextResponse.json(payload, { status: resultResponse.status })
  }

  const responsePayload: Record<string, unknown> = {
    success: true,
    jobId: body.jobId,
    status: payload.status,
    stage: payload.stage,
    parsed: payload.parsed,
  }

  if ((body.includeSummary || body.includeMetadata) && body.modelConfig) {
    if (body.includeSummary) {
      responsePayload.summary = await generateSummary(payload.parsed.full_text, body.modelConfig, {
        maxLength: 500,
        language: '中文',
      })
    }

    if (body.includeMetadata) {
      responsePayload.metadata = await extractMetadata(
        payload.parsed.full_text,
        body.modelConfig,
        body.fileName,
      )
    }
  }

  return NextResponse.json(responsePayload)
}

export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('jobId')
    const includeResult = request.nextUrl.searchParams.get('result') === 'true'

    if (!jobId) {
      return NextResponse.json({ error: '缺少 jobId' }, { status: 400 })
    }

    const upstreamPath = includeResult ? `/jobs/${jobId}/result` : `/jobs/${jobId}`
    const response = await proxyToSurya(upstreamPath)
    const payload = await response.json().catch(() => null)

    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    console.error('Surya status proxy error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Surya 状态代理失败' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return await handleJobResult(request)
    }

    return await handleJobSubmission(request)
  } catch (error) {
    console.error('Surya proxy error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Surya 代理失败' },
      { status: 500 },
    )
  }
}
