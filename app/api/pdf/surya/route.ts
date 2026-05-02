import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { extractMetadata, generateSummary } from '@/lib/ai'
import { DEFAULT_ADVANCED_PARSE_PROVIDER } from '@/lib/documentParseProviders'
import { getAdvancedParseServiceUrl, normalizeAdvancedParseProviderId } from '@/lib/server/advancedParseProviderRuntime'
import { resolveRuntimeOutPath } from '@/lib/server/runtimePaths'
import type { AdvancedParseProviderId, ModelConfig } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SURYA_BINDING_DIR = resolveRuntimeOutPath('surya')
const SURYA_BINDING_FILE = path.join(SURYA_BINDING_DIR, 'job-bindings.json')

interface SuryaJobBinding {
  fingerprint: string
  jobId: string
  fileName: string
  providerId: AdvancedParseProviderId
  baseUrl?: string
  pageRange?: string
  outputName?: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage?: string
  createdAt: string
  updatedAt: string
}

interface SuryaJobBindingStore {
  version: 1
  updatedAt: string
  byFingerprint: Record<string, SuryaJobBinding>
  byJobId: Record<string, string>
}

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
  providerId?: AdvancedParseProviderId
  baseUrl?: string
  includeSummary?: boolean
  includeMetadata?: boolean
  modelConfig?: ModelConfig
  fileName?: string
}

function createEmptyBindingStore(): SuryaJobBindingStore {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    byFingerprint: {},
    byJobId: {},
  }
}

async function readBindingStore() {
  try {
    const raw = await fs.readFile(SURYA_BINDING_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SuryaJobBindingStore>
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.byFingerprint &&
      typeof parsed.byFingerprint === 'object' &&
      parsed.byJobId &&
      typeof parsed.byJobId === 'object'
    ) {
      return parsed as SuryaJobBindingStore
    }
    return createEmptyBindingStore()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') {
      return createEmptyBindingStore()
    }
    throw error
  }
}

async function writeBindingStore(store: SuryaJobBindingStore) {
  const nextStore: SuryaJobBindingStore = {
    ...store,
    updatedAt: new Date().toISOString(),
  }
  await fs.mkdir(SURYA_BINDING_DIR, { recursive: true })
  await fs.writeFile(SURYA_BINDING_FILE, JSON.stringify(nextStore, null, 2), 'utf8')
}

async function updateBindingStore(mutator: (store: SuryaJobBindingStore) => void) {
  const store = await readBindingStore()
  mutator(store)
  await writeBindingStore(store)
}

function upsertBinding(store: SuryaJobBindingStore, binding: SuryaJobBinding) {
  const previous = store.byFingerprint[binding.fingerprint]
  if (previous && previous.jobId !== binding.jobId) {
    delete store.byJobId[previous.jobId]
  }

  store.byFingerprint[binding.fingerprint] = binding
  store.byJobId[binding.jobId] = binding.fingerprint
}

function removeBindingByFingerprint(store: SuryaJobBindingStore, fingerprint: string) {
  const existing = store.byFingerprint[fingerprint]
  if (!existing) return
  delete store.byJobId[existing.jobId]
  delete store.byFingerprint[fingerprint]
}

async function buildSubmissionFingerprint(params: {
  file: File
  providerId: AdvancedParseProviderId
  baseUrl?: string
  pageRange?: string
  outputName?: string
}) {
  const contentBuffer = Buffer.from(await params.file.arrayBuffer())
  const fileContentHash = createHash('sha256').update(contentBuffer).digest('hex')
  const key = [
    params.providerId,
    params.baseUrl || '',
    params.file.name,
    String(params.file.size),
    params.file.type || '',
    params.pageRange || '',
    params.outputName || '',
    fileContentHash,
  ].join('|')

  return createHash('sha256').update(key).digest('hex')
}

async function syncBindingStatusByJobId(jobId: string, payload: Partial<SuryaJobStatusResponse> | null | undefined) {
  if (!jobId || !payload?.status) return

  await updateBindingStore((store) => {
    const fingerprint = store.byJobId[jobId]
    if (!fingerprint) return

    const existing = store.byFingerprint[fingerprint]
    if (!existing) {
      delete store.byJobId[jobId]
      return
    }

    upsertBinding(store, {
      ...existing,
      status: payload.status || existing.status,
      stage: payload.stage || existing.stage,
      updatedAt: new Date().toISOString(),
    })

    if (payload.status === 'failed') {
      removeBindingByFingerprint(store, fingerprint)
    }
  })
}

async function proxyToSurya(
  providerId: AdvancedParseProviderId,
  pathname: string,
  init?: RequestInit,
  explicitBaseUrl?: string,
) {
  const serviceUrl = getAdvancedParseServiceUrl(providerId, explicitBaseUrl)
  return fetch(`${serviceUrl}${pathname}`, {
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

  const providerId = normalizeAdvancedParseProviderId(form.get('providerId') as string | null | undefined)
  const baseUrl = typeof form.get('baseUrl') === 'string' ? String(form.get('baseUrl')).trim() : ''

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

  const normalizedPageRange = typeof pageRange === 'string' && pageRange.trim() ? pageRange.trim() : undefined
  const normalizedOutputName = typeof outputName === 'string' && outputName.trim() ? outputName.trim() : undefined
  const fingerprint = await buildSubmissionFingerprint({
    file,
    providerId,
    baseUrl,
    pageRange: normalizedPageRange,
    outputName: normalizedOutputName,
  })

  const bindingStore = await readBindingStore()
  const existingBinding = bindingStore.byFingerprint[fingerprint]
  if (existingBinding) {
    const statusResponse = await proxyToSurya(
      existingBinding.providerId || DEFAULT_ADVANCED_PARSE_PROVIDER,
      `/jobs/${existingBinding.jobId}`,
      undefined,
      existingBinding.baseUrl,
    )
    const statusPayload = await statusResponse.json().catch(() => null) as SuryaJobStatusResponse | null

    if (statusResponse.ok && statusPayload?.job_id) {
      await updateBindingStore((store) => {
        upsertBinding(store, {
          ...existingBinding,
          status: statusPayload.status,
          stage: statusPayload.stage,
          updatedAt: new Date().toISOString(),
        })
      })

      return NextResponse.json({
        success: true,
        job_id: existingBinding.jobId,
        status: statusPayload.status,
        stage: statusPayload.stage,
        reused: true,
      })
    }

    if (statusPayload?.status === 'failed' || statusResponse.status === 404) {
      await updateBindingStore((store) => {
        removeBindingByFingerprint(store, fingerprint)
      })
    }
  }

  const parseResponse = await proxyToSurya(providerId, '/jobs', {
    method: 'POST',
    body: upstreamForm,
  }, baseUrl)

  const payload = await parseResponse.json().catch(() => null)
  if (!parseResponse.ok) {
    return NextResponse.json(
      { error: 'Surya 任务提交失败', detail: payload?.detail || payload?.error || null },
      { status: parseResponse.status },
    )
  }

  if (payload?.job_id && typeof payload.job_id === 'string') {
    const now = new Date().toISOString()
    const nextBinding: SuryaJobBinding = {
      fingerprint,
      jobId: payload.job_id,
      fileName: file.name,
      providerId,
      baseUrl,
      pageRange: normalizedPageRange,
      outputName: normalizedOutputName,
      status: payload.status === 'failed' ? 'failed' : (payload.status || 'queued'),
      stage: payload.stage,
      createdAt: now,
      updatedAt: now,
    }

    await updateBindingStore((store) => {
      upsertBinding(store, nextBinding)
      if (nextBinding.status === 'failed') {
        removeBindingByFingerprint(store, fingerprint)
      }
    })
  }

  return NextResponse.json(payload)
}

async function handleJobResult(request: NextRequest) {
  const body = await request.json() as SuryaResultRequest
  if (!body.jobId) {
    return NextResponse.json({ error: '缺少 jobId' }, { status: 400 })
  }

  const bindingStore = await readBindingStore()
  const bindingFingerprint = bindingStore.byJobId[body.jobId]
  const binding = bindingFingerprint ? bindingStore.byFingerprint[bindingFingerprint] : null
  const providerId = normalizeAdvancedParseProviderId(body.providerId || binding?.providerId)
  const baseUrl = body.baseUrl?.trim() || binding?.baseUrl

  const resultResponse = await proxyToSurya(providerId, `/jobs/${body.jobId}/result`, undefined, baseUrl)
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
    await syncBindingStatusByJobId(body.jobId, payload)
    return NextResponse.json(payload, { status: resultResponse.status })
  }

  await syncBindingStatusByJobId(body.jobId, payload)

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
    const bindingStore = await readBindingStore()
    const bindingFingerprint = bindingStore.byJobId[jobId]
    const binding = bindingFingerprint ? bindingStore.byFingerprint[bindingFingerprint] : null
    const providerId = normalizeAdvancedParseProviderId(
      request.nextUrl.searchParams.get('providerId') || binding?.providerId,
    )
    const baseUrl = request.nextUrl.searchParams.get('baseUrl')?.trim() || binding?.baseUrl
    const response = await proxyToSurya(providerId, upstreamPath, undefined, baseUrl)
    const payload = await response.json().catch(() => null) as SuryaJobStatusResponse | null

    if (!includeResult && payload?.job_id) {
      await syncBindingStatusByJobId(payload.job_id, payload)
    }

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
