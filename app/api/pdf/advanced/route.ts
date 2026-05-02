import { NextRequest, NextResponse } from 'next/server'
import { extractMetadata, generateSummary } from '@/lib/ai'
import { fetchMineruResult, getMineruJobStatus, submitMineruJob } from '@/lib/server/mineruService'
import { GET as suryaGET, POST as suryaPOST } from '@/app/api/pdf/surya/route'
import type { AdvancedParseProviderId, ModelConfig } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MineruResultRequest = {
  jobId: string
  providerId?: AdvancedParseProviderId
  baseUrl?: string
  apiKey?: string
  modelVersion?: string
  includeSummary?: boolean
  includeMetadata?: boolean
  modelConfig?: ModelConfig
  fileName?: string
}

function isMineruProvider(providerId: string | null | undefined) {
  return providerId === 'mineru'
}

function getMineruConfig(input: {
  baseUrl?: string | null
  apiKey?: string | null
  modelVersion?: string | null
}) {
  return {
    baseUrl: input.baseUrl?.trim() || process.env.MINERU_SERVICE_URL || process.env.MINERU_API_BASE_URL || 'https://mineru.net',
    apiKey: input.apiKey?.trim() || process.env.MINERU_API_KEY || '',
    modelVersion: input.modelVersion?.trim() || process.env.MINERU_MODEL_VERSION || 'vlm',
  }
}

async function handleMineruSubmission(request: NextRequest) {
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 PDF 文件' }, { status: 400 })
  }

  const outputName = typeof form.get('outputName') === 'string' ? String(form.get('outputName')).trim() : ''
  const config = getMineruConfig({
    baseUrl: typeof form.get('baseUrl') === 'string' ? String(form.get('baseUrl')) : undefined,
    apiKey: typeof form.get('apiKey') === 'string' ? String(form.get('apiKey')) : undefined,
    modelVersion: typeof form.get('modelVersion') === 'string' ? String(form.get('modelVersion')) : undefined,
  })

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const payload = await submitMineruJob({
      fileBuffer,
      fileName: file.name,
      documentId: outputName || file.name,
      config,
    })
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'MinerU 任务提交失败' },
      { status: 500 },
    )
  }
}

async function handleMineruStatus(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')
  if (!jobId) {
    return NextResponse.json({ error: '缺少 jobId' }, { status: 400 })
  }

  const config = getMineruConfig({
    baseUrl: request.nextUrl.searchParams.get('baseUrl'),
    apiKey: request.nextUrl.searchParams.get('apiKey'),
    modelVersion: request.nextUrl.searchParams.get('modelVersion'),
  })

  try {
    const payload = await getMineruJobStatus({
      jobId,
      config,
    })
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'MinerU 状态查询失败' },
      { status: 500 },
    )
  }
}

async function handleMineruResult(request: NextRequest) {
  const body = await request.json() as MineruResultRequest
  if (!body.jobId) {
    return NextResponse.json({ error: '缺少 jobId' }, { status: 400 })
  }

  const config = getMineruConfig({
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    modelVersion: body.modelVersion,
  })

  try {
    const payload = await fetchMineruResult({
      jobId: body.jobId,
      fileName: body.fileName || 'document.pdf',
      config,
    })

    if (payload.status !== 'completed' || !('parsed' in payload) || !payload.parsed) {
      return NextResponse.json(payload, { status: payload.status === 'failed' ? 500 : 202 })
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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'MinerU 结果获取失败' },
      { status: 500 },
    )
  }
}

export async function GET(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get('providerId')
  if (!isMineruProvider(providerId)) {
    return suryaGET(request)
  }
  return handleMineruStatus(request)
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const cloned = request.clone()
    const body = await cloned.json().catch(() => null) as MineruResultRequest | null
    if (!isMineruProvider(body?.providerId)) {
      return suryaPOST(request)
    }
    return handleMineruResult(request)
  }

  const form = await request.clone().formData()
  const providerIdRaw = form.get('providerId')
  const providerId = typeof providerIdRaw === 'string' ? providerIdRaw : null
  if (!isMineruProvider(providerId)) {
    return suryaPOST(request)
  }
  return handleMineruSubmission(request)
}
