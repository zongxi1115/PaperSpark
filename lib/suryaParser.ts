import type { AdvancedParseProviderId, ModelConfig, PDFMetadata, PDFPageCache, TextBlock, TextBlockType, TextStyle } from './types'

export interface StructuredLayoutRegion {
  label: string
  confidence?: number
  position: number
  bbox: number[]
  polygon: number[][]
  line_count: number
  text: string
}

export interface StructuredParsedPage {
  page: number
  image_bbox: number[]
  full_text: string
  structure_counts: Record<string, number>
  layout_regions: StructuredLayoutRegion[]
}

export interface StructuredParsedDocument {
  document_name: string
  page_count: number
  full_text: string
  structure_counts: Record<string, number>
  pages: StructuredParsedPage[]
  artifacts?: Record<string, string>
}

interface SuryaProxyResponse {
  success: boolean
  parsed: StructuredParsedDocument
  metadata?: {
    success: boolean
    metadata?: PDFMetadata
  }
}

interface SuryaJobSubmissionResponse {
  success: boolean
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage: string
}

interface SuryaJobStatusResponse {
  success: boolean
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage: string
  error?: string
}

export interface SuryaParseResult {
  pages: PDFPageCache[]
  metadata: Partial<PDFMetadata>
  fullText: string
  structureCounts: Record<string, number>
}

const SURYA_POLL_INTERVAL_MS = 5000
const SURYA_JOB_TIMEOUT_MS = 15 * 60 * 1000
const SURYA_RETRY_BASE_DELAY_MS = 500
const SURYA_RETRY_MAX_DELAY_MS = 5000
const SURYA_RETRY_MAX_ATTEMPTS = 5

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function inferTypeFromText(text: string): TextBlockType {
  if (/^(Figure|Table|图|表|Fig\.|Tab\.)\s*\d+/i.test(text)) return 'caption'
  if (/^\[\d+\]/.test(text) || /\(\d{4}\)/.test(text)) return 'reference'
  if (/^(\d+\.|\d+\)|[•●○\-])\s+/.test(text)) return 'list'
  if (/[=+\-*/^∑∏∫√∞≈≠≤≥]/.test(text)) return 'formula'
  return 'paragraph'
}

function mapSuryaLabelToTextBlockType(label: string, text: string, pageNum: number, position: number): TextBlockType {
  switch (label) {
    case 'PageHeader':
      return 'header'
    case 'PageFooter':
      return 'footer'
    case 'SectionHeader':
      return pageNum === 1 && position <= 2 ? 'title' : 'subtitle'
    case 'Caption':
      return 'caption'
    case 'ListItem':
      return 'list'
    case 'Footnote':
      return 'reference'
    case 'Formula':
    case 'Code':
      return 'formula'
    case 'Table':
    case 'Form':
      return 'table'
    default:
      return inferTypeFromText(text)
  }
}

function buildStyle(region: StructuredLayoutRegion, blockType: TextBlockType): TextStyle {
  const bboxHeight = Math.max(12, region.bbox[3] - region.bbox[1])
  const lineCount = Math.max(region.line_count || 1, 1)
  const estimatedLineHeight = bboxHeight / lineCount
  const fontSize = clamp(estimatedLineHeight * 0.72, 10, blockType === 'title' ? 32 : 24)

  return {
    fontSize,
    fontFamily: 'serif',
    isBold: blockType === 'title' || blockType === 'subtitle',
    isItalic: false,
  }
}

function regionToBlock(
  documentId: string,
  pageNum: number,
  pageWidth: number,
  pageHeight: number,
  region: StructuredLayoutRegion,
): TextBlock | null {
  const text = normalizeText(region.text)
  const isPictureRegion = region.label === 'Picture'
  if (!text && !isPictureRegion) return null

  const blockType = mapSuryaLabelToTextBlockType(region.label, text, pageNum, region.position)
  const [x1, y1, x2, y2] = region.bbox

  return {
    id: `${documentId}_p${pageNum}_r${region.position}`,
    type: blockType,
    text,
    bbox: {
      x: x1,
      y: y1,
      width: Math.max(0, x2 - x1),
      height: Math.max(0, y2 - y1),
    },
    style: buildStyle(region, blockType),
    pageNum,
    itemIds: [],
    sourceLabel: region.label,
    confidence: region.confidence,
    lineCount: region.line_count,
    order: region.position,
    sourcePageWidth: pageWidth,
    sourcePageHeight: pageHeight,
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getRetryDelay(attempt: number) {
  const exponentialDelay = SURYA_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1))
  const boundedDelay = Math.min(exponentialDelay, SURYA_RETRY_MAX_DELAY_MS)
  // Add jitter to avoid synchronized retries from multiple clients.
  const jitter = Math.floor(Math.random() * 250)
  return boundedDelay + jitter
}

async function fetchWithExponentialBackoff(
  input: RequestInfo | URL,
  init: RequestInit,
  operationName: string,
) {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= SURYA_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(input, init)
      if (
        response.ok ||
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        attempt === SURYA_RETRY_MAX_ATTEMPTS
      ) {
        return response
      }
    } catch (error) {
      lastError = error
      if (attempt === SURYA_RETRY_MAX_ATTEMPTS) {
        break
      }
    }

    await sleep(getRetryDelay(attempt))
  }

  const suffix = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`${operationName} 请求重试失败${suffix}`)
}

async function submitSuryaJob(form: FormData) {
  const response = await fetchWithExponentialBackoff(
    '/api/pdf/advanced',
    {
      method: 'POST',
      body: form,
    },
    'Surya 任务提交',
  )

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error || payload?.detail || 'Surya 任务提交失败')
  }

  return await response.json() as SuryaJobSubmissionResponse
}

async function pollSuryaJob(params: {
  jobId: string
  providerId?: AdvancedParseProviderId
  baseUrl?: string
  apiKey?: string
  modelVersion?: string
}) {
  const startedAt = Date.now()

  while (true) {
    const searchParams = new URLSearchParams({
      jobId: params.jobId,
    })
    if (params.providerId) searchParams.set('providerId', params.providerId)
    if (params.baseUrl?.trim()) searchParams.set('baseUrl', params.baseUrl.trim())
    if (params.apiKey?.trim()) searchParams.set('apiKey', params.apiKey.trim())
    if (params.modelVersion?.trim()) searchParams.set('modelVersion', params.modelVersion.trim())

    const response = await fetchWithExponentialBackoff(
      `/api/pdf/advanced?${searchParams.toString()}`,
      {
        cache: 'no-store',
      },
      'Surya 状态轮询',
    )

    const payload = await response.json().catch(() => null) as SuryaJobStatusResponse | null
    if (!response.ok) {
      throw new Error(payload?.error || 'Surya 状态轮询失败')
    }

    if (!payload) {
      throw new Error('Surya 状态为空')
    }

    if (payload.status === 'completed') {
      return payload
    }

    if (payload.status === 'failed') {
      throw new Error(payload.error || 'Surya 解析失败')
    }

    if (Date.now() - startedAt > SURYA_JOB_TIMEOUT_MS) {
      throw new Error('Surya 解析超时')
    }

    await sleep(SURYA_POLL_INTERVAL_MS)
  }
}

async function fetchSuryaResult(params: {
  jobId: string
  providerId?: AdvancedParseProviderId
  baseUrl?: string
  apiKey?: string
  modelVersion?: string
  includeMetadata?: boolean
  includeSummary?: boolean
  modelConfig?: ModelConfig
  fileName: string
}) {
  const response = await fetchWithExponentialBackoff(
    '/api/pdf/advanced',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId: params.jobId,
        providerId: params.providerId,
        baseUrl: params.baseUrl,
        apiKey: params.apiKey,
        modelVersion: params.modelVersion,
        includeMetadata: params.includeMetadata,
        includeSummary: params.includeSummary,
        modelConfig: params.modelConfig,
        fileName: params.fileName,
      }),
    },
    'Surya 结果获取',
  )

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error || payload?.detail || 'Surya 结果获取失败')
  }

  if (!payload?.parsed) {
    throw new Error('Surya 未返回解析结果')
  }

  return payload as SuryaProxyResponse
}

export function normalizeSuryaParseResult(
  documentId: string,
  parsed: StructuredParsedDocument,
  metadata?: Partial<PDFMetadata>,
): SuryaParseResult {
  const pages: PDFPageCache[] = parsed.pages.map(page => {
    const imageBox = page.image_bbox || [0, 0, 0, 0]
    const pageWidth = Math.max(0, imageBox[2] - imageBox[0])
    const pageHeight = Math.max(0, imageBox[3] - imageBox[1])
    const blocks = page.layout_regions
      .map(region => regionToBlock(documentId, page.page, pageWidth, pageHeight, region))
      .filter((block): block is TextBlock => block !== null)

    return {
      id: `${documentId}_page_${page.page}`,
      documentId,
      pageNum: page.page,
      width: pageWidth,
      height: pageHeight,
      blocks,
      fullText: normalizeText(page.full_text || blocks.map(block => block.text).join('\n\n')),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  })

  return {
    pages,
    metadata: metadata || {},
    fullText: normalizeText(parsed.full_text || pages.map(page => page.fullText || '').join('\n\n')),
    structureCounts: parsed.structure_counts || {},
  }
}

export async function parsePDFWithAdvancedProvider(params: {
  documentId: string
  fileBlob: Blob
  fileName: string
  providerId: AdvancedParseProviderId
  baseUrl?: string
  apiKey?: string
  modelVersion?: string
  pageRange?: string
  keepOutputs?: boolean
  includeMetadata?: boolean
  includeSummary?: boolean
  modelConfig?: ModelConfig
}): Promise<SuryaParseResult> {
  const form = new FormData()
  const file = params.fileBlob instanceof File
    ? params.fileBlob
    : new File([params.fileBlob], params.fileName, { type: 'application/pdf' })

  form.set('file', file)
  form.set('outputName', params.documentId)
  form.set('keepOutputs', params.keepOutputs ? 'true' : 'false')
  form.set('providerId', params.providerId)

  if (params.baseUrl?.trim()) {
    form.set('baseUrl', params.baseUrl.trim())
  }
  if (params.apiKey?.trim()) {
    form.set('apiKey', params.apiKey.trim())
  }
  if (params.modelVersion?.trim()) {
    form.set('modelVersion', params.modelVersion.trim())
  }

  if (params.pageRange) {
    form.set('pageRange', params.pageRange)
  }

  const submitted = await submitSuryaJob(form)
  await pollSuryaJob({
    jobId: submitted.job_id,
    providerId: params.providerId,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    modelVersion: params.modelVersion,
  })

  const payload = await fetchSuryaResult({
    jobId: submitted.job_id,
    providerId: params.providerId,
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    modelVersion: params.modelVersion,
    includeMetadata: params.includeMetadata,
    includeSummary: params.includeSummary,
    modelConfig: params.modelConfig,
    fileName: params.fileName,
  })

  return normalizeSuryaParseResult(
    params.documentId,
    payload.parsed,
    payload.metadata?.metadata,
  )
}

export async function parsePDFWithSurya(params: {
  documentId: string
  fileBlob: Blob
  fileName: string
  pageRange?: string
  keepOutputs?: boolean
  includeMetadata?: boolean
  includeSummary?: boolean
  modelConfig?: ModelConfig
}): Promise<SuryaParseResult> {
  return parsePDFWithAdvancedProvider({
    ...params,
    providerId: 'surya-local',
  })
}
