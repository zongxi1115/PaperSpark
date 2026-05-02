import JSZip from 'jszip'
import type { StructuredLayoutRegion, StructuredParsedDocument } from '@/lib/suryaParser'

const DEFAULT_MINERU_BASE_URL = 'https://mineru.net'
const MINERU_API_PREFIX = '/api/v4'

type MineruFileUrlResponse = {
  code: number
  msg?: string
  data?: {
    batch_id?: string
    file_urls?: string[]
  }
}

type MineruExtractResultItem = {
  file_name?: string
  state?: string
  err_msg?: string
  full_zip_url?: string
}

type MineruBatchStatusResponse = {
  code: number
  msg?: string
  data?: {
    extract_result?: MineruExtractResultItem[] | MineruExtractResultItem
  }
}

type MineruContentBlock = {
  type?: string
  text?: string
  text_level?: number
  page_idx?: number
  bbox?: number[]
  score?: number
  image_caption?: string[]
  image_footnote?: string[]
  chart_caption?: string[]
  chart_footnote?: string[]
  table_caption?: string[]
  table_footnote?: string[]
  table_body?: string
  img_path?: string
  html?: string
  latex?: string
  list_items?: string[]
  code_body?: string
}

type MineruMiddlePage = {
  page_idx?: number
  page_size?: [number, number]
}

type MineruMiddleData = {
  pdf_info?: MineruMiddlePage[]
}

export interface MineruProviderConfig {
  baseUrl?: string
  apiKey: string
  modelVersion?: string
}

export interface MineruJobStatus {
  success: boolean
  job_id: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  stage: string
  error?: string
  parsed?: StructuredParsedDocument
}

export interface MineruJobStatusResponse extends MineruJobStatus {
  raw?: MineruBatchStatusResponse
  result?: MineruExtractResultItem | null
}

export interface MineruJobResultResponse extends MineruJobStatusResponse {
  parsed: StructuredParsedDocument
}

function trimUrl(value: string | undefined) {
  return value?.trim().replace(/\/$/, '') || ''
}

function buildMineruApiUrl(baseUrl: string | undefined, pathname: string) {
  const normalizedBase = trimUrl(baseUrl) || DEFAULT_MINERU_BASE_URL
  if (normalizedBase.includes('/api/v4')) {
    return `${normalizedBase}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
  }
  return `${normalizedBase}${MINERU_API_PREFIX}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

function getAuthHeaders(apiKey: string, contentType = 'application/json') {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  return response.json().catch(() => null) as Promise<T | null>
}

async function assertMineruOk<T extends { code: number; msg?: string }>(response: Response, fallbackMessage: string) {
  const payload = await readJson<T>(response)
  if (!response.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.msg || `${fallbackMessage} (HTTP ${response.status})`)
  }
  return payload
}

async function fetchWithRetry(input: string, init: RequestInit, attempts = 3) {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(input, init)
      if (response.ok || attempt === attempts) {
        return response
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
    }

    await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
  }

  throw lastError instanceof Error ? lastError : new Error('请求失败')
}

function getFirstExtractResult(payload: MineruBatchStatusResponse | null | undefined) {
  const result = payload?.data?.extract_result
  if (!result) return null
  return Array.isArray(result) ? (result[0] || null) : result
}

function mapMineruStateToStatus(state: string | undefined): MineruJobStatus['status'] {
  switch (state) {
    case 'done':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'pending':
    case 'running':
      return 'processing'
    case 'waiting-file':
    default:
      return 'queued'
  }
}

function mapMineruStateToStage(state: string | undefined) {
  switch (state) {
    case 'waiting-file':
      return '等待文件上传'
    case 'pending':
      return '排队解析'
    case 'running':
      return '解析中'
    case 'done':
      return '解析完成'
    case 'failed':
      return '解析失败'
    default:
      return '处理中'
  }
}

function normalizeText(value: string | undefined) {
  return (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getBlockText(block: MineruContentBlock) {
  const primary = normalizeText(block.text)
  if (primary) return primary
  if (block.type === 'list' && Array.isArray(block.list_items)) {
    return normalizeText(block.list_items.join('\n'))
  }
  if (block.type === 'code') {
    return normalizeText(block.code_body || block.html || '')
  }
  if (block.type === 'equation') {
    return normalizeText(block.latex || block.html || '')
  }
  if (block.type === 'table') {
    return normalizeText(block.table_body || block.html || '')
  }
  return ''
}

function mapBlockTypeToLabel(block: MineruContentBlock): string {
  switch (block.type) {
    case 'title':
      return 'SectionHeader'
    case 'image':
    case 'chart':
      return 'Picture'
    case 'image_caption':
    case 'chart_caption':
      return 'Caption'
    case 'table':
      return 'Table'
    case 'table_caption':
      return 'Caption'
    case 'equation':
      return 'Formula'
    case 'list':
      return 'ListItem'
    case 'reference':
      return 'Footnote'
    case 'header':
      return 'PageHeader'
    case 'footer':
    case 'page_number':
      return 'PageFooter'
    case 'page_footnote':
    case 'aside_text':
      return 'Footnote'
    default:
      return 'Text'
  }
}

function shouldPromoteToReference(text: string) {
  return /^\[\d+\]/.test(text) || /\(\d{4}\)/.test(text)
}

function normalizeBlockLabel(block: MineruContentBlock, text: string) {
  if (block.type === 'text' && block.text_level && block.text_level > 0) {
    return 'SectionHeader'
  }
  if (block.type === 'list' && shouldPromoteToReference(text)) {
    return 'Footnote'
  }
  if (block.type === 'text' && shouldPromoteToReference(text)) {
    return 'Footnote'
  }
  return mapBlockTypeToLabel(block)
}

function scaleBbox(bbox: number[] | undefined, pageWidth: number, pageHeight: number) {
  if (!bbox || bbox.length < 4) {
    return [0, 0, pageWidth, pageHeight]
  }

  const [x1, y1, x2, y2] = bbox
  const maxCoord = Math.max(Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2))
  if (maxCoord <= 1.5) {
    return [x1 * pageWidth, y1 * pageHeight, x2 * pageWidth, y2 * pageHeight]
  }
  if (maxCoord <= 1000.5) {
    return [
      (x1 / 1000) * pageWidth,
      (y1 / 1000) * pageHeight,
      (x2 / 1000) * pageWidth,
      (y2 / 1000) * pageHeight,
    ]
  }
  return [x1, y1, x2, y2]
}

function pushRegion(
  target: StructuredLayoutRegion[],
  label: string,
  text: string,
  bbox: number[],
  positionRef: { value: number },
  confidence?: number,
) {
  const normalized = normalizeText(text)
  if (!normalized && label !== 'Picture') return
  positionRef.value += 1
  const [x1, y1, x2, y2] = bbox
  target.push({
    label,
    confidence,
    position: positionRef.value,
    bbox: [x1, y1, x2, y2],
    polygon: [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
    ],
    line_count: normalized ? normalized.split('\n').length : 0,
    text: normalized,
  })
}

function findZipTextFile(zip: JSZip, candidates: string[]) {
  for (const candidate of candidates) {
    const exact = zip.file(candidate)
    if (exact) return exact
  }

  const lowerCandidates = candidates.map(candidate => candidate.toLowerCase())
  const files = Object.values(zip.files)
  for (const file of files) {
    if (file.dir) continue
    const lowerName = file.name.toLowerCase()
    if (lowerCandidates.some(candidate => lowerName.endsWith(candidate.toLowerCase()))) {
      return file
    }
  }

  return null
}

async function loadZipJson<T>(zip: JSZip, candidates: string[]) {
  const file = findZipTextFile(zip, candidates)
  if (!file) return null
  const raw = await file.async('string')
  return JSON.parse(raw) as T
}

async function loadZipText(zip: JSZip, candidates: string[]) {
  const file = findZipTextFile(zip, candidates)
  if (!file) return ''
  return await file.async('string')
}

function buildArtifacts(result: MineruExtractResultItem) {
  return {
    full_zip_url: result.full_zip_url || '',
  }
}

export async function submitMineruJob(params: {
  fileBuffer: Buffer
  fileName: string
  documentId: string
  config: MineruProviderConfig
}) {
  if (!params.config.apiKey.trim()) {
    throw new Error('MinerU API Key 未配置')
  }

  const batchPayload = {
    enable_formula: true,
    files: [
      {
        name: params.fileName,
        data_id: params.documentId,
      },
    ],
    model_version: params.config.modelVersion?.trim() || 'vlm',
  }

  const fileUrlResponse = await fetch(buildMineruApiUrl(params.config.baseUrl, '/file-urls/batch'), {
    method: 'POST',
    headers: getAuthHeaders(params.config.apiKey),
    body: JSON.stringify(batchPayload),
    cache: 'no-store',
  })

  const fileUrlPayload = await assertMineruOk<MineruFileUrlResponse>(fileUrlResponse, '获取 MinerU 上传地址失败')
  const batchId = fileUrlPayload.data?.batch_id
  const uploadUrl = fileUrlPayload.data?.file_urls?.[0]
  if (!batchId || !uploadUrl) {
    throw new Error('MinerU 未返回有效上传地址')
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(params.fileBuffer),
  })

  if (!uploadResponse.ok) {
    const uploadText = await uploadResponse.text().catch(() => '')
    throw new Error(uploadText || `上传 PDF 到 MinerU 失败 (HTTP ${uploadResponse.status})`)
  }

  return {
    success: true,
    job_id: batchId,
    status: 'queued' as const,
    stage: '文件已上传，等待解析',
  }
}

export async function getMineruJobStatus(params: {
  jobId: string
  config: MineruProviderConfig
}): Promise<MineruJobStatusResponse> {
  if (!params.config.apiKey.trim()) {
    throw new Error('MinerU API Key 未配置')
  }

  const response = await fetch(
    buildMineruApiUrl(params.config.baseUrl, `/extract-results/batch/${encodeURIComponent(params.jobId)}`),
    {
      headers: getAuthHeaders(params.config.apiKey, ''),
      cache: 'no-store',
    },
  )

  const payload = await assertMineruOk<MineruBatchStatusResponse>(response, '获取 MinerU 任务状态失败')
  const extractResult = getFirstExtractResult(payload)
  const state = extractResult?.state

  return {
    success: true,
    job_id: params.jobId,
    status: mapMineruStateToStatus(state),
    stage: mapMineruStateToStage(state),
    error: extractResult?.err_msg || undefined,
    raw: payload,
    result: extractResult,
  }
}

export async function fetchMineruResult(params: {
  jobId: string
  fileName: string
  config: MineruProviderConfig
}): Promise<MineruJobStatusResponse | MineruJobResultResponse> {
  const statusPayload = await getMineruJobStatus({
    jobId: params.jobId,
    config: params.config,
  })

  if (statusPayload.status !== 'completed') {
    return statusPayload
  }

  const zipUrl = statusPayload.result?.full_zip_url
  if (!zipUrl) {
    throw new Error('MinerU 未返回解析结果 ZIP 地址')
  }

  const zipResponse = await fetchWithRetry(zipUrl, {
    cache: 'no-store',
  }, 4)
  if (!zipResponse.ok) {
    throw new Error(`下载 MinerU 解析结果失败 (HTTP ${zipResponse.status})`)
  }

  const zipBuffer = Buffer.from(await zipResponse.arrayBuffer())
  const zip = await JSZip.loadAsync(zipBuffer)
  const contentList = await loadZipJson<MineruContentBlock[]>(zip, ['content_list.json', '_content_list.json'])
  const middleData = await loadZipJson<MineruMiddleData>(zip, ['middle.json', '_middle.json'])
  const markdownText = await loadZipText(zip, ['full.md', '.md'])

  if (!contentList || contentList.length === 0) {
    throw new Error('MinerU ZIP 中缺少 content_list.json')
  }

  const pageInfoByIndex = new Map<number, MineruMiddlePage>()
  ;(middleData?.pdf_info || []).forEach(page => {
    const pageIdx = Number(page.page_idx ?? pageInfoByIndex.size)
    pageInfoByIndex.set(pageIdx, page)
  })

  const grouped = new Map<number, MineruContentBlock[]>()
  contentList.forEach((block) => {
    const pageIdx = Number(block.page_idx ?? 0)
    const pageBlocks = grouped.get(pageIdx) || []
    pageBlocks.push(block)
    grouped.set(pageIdx, pageBlocks)
  })

  const pageIndexes = Array.from(grouped.keys()).sort((a, b) => a - b)
  const pages = pageIndexes.map((pageIdx) => {
    const pageInfo = pageInfoByIndex.get(pageIdx)
    const pageWidth = Math.max(1, Number(pageInfo?.page_size?.[0] || 1000))
    const pageHeight = Math.max(1, Number(pageInfo?.page_size?.[1] || 1000))
    const regions: StructuredLayoutRegion[] = []
    const structureCounts: Record<string, number> = {}
    const positionRef = { value: 0 }

    for (const block of grouped.get(pageIdx) || []) {
      const text = getBlockText(block)
      const label = normalizeBlockLabel(block, text)
      const bbox = scaleBbox(block.bbox, pageWidth, pageHeight)
      pushRegion(regions, label, text, bbox, positionRef, block.score)
      structureCounts[label] = (structureCounts[label] || 0) + 1

      if ((block.type === 'image' || block.type === 'chart') && !text) {
        const captions = [
          ...(block.image_caption || []),
          ...(block.image_footnote || []),
          ...(block.chart_caption || []),
          ...(block.chart_footnote || []),
        ]
        captions.forEach((caption) => pushRegion(regions, 'Caption', caption, bbox, positionRef, block.score))
      }

      if (block.type === 'table') {
        const captions = [...(block.table_caption || []), ...(block.table_footnote || [])]
        captions.forEach((caption) => pushRegion(regions, 'Caption', caption, bbox, positionRef, block.score))
      }
    }

    const fullText = normalizeText(
      regions
        .map(region => region.text)
        .filter(Boolean)
        .join('\n\n'),
    )

    return {
      page: pageIdx + 1,
      image_bbox: [0, 0, pageWidth, pageHeight],
      full_text: fullText,
      structure_counts: structureCounts,
      layout_regions: regions,
    }
  })

  const structureCounts: Record<string, number> = {}
  pages.forEach((page) => {
    Object.entries(page.structure_counts).forEach(([key, value]) => {
      structureCounts[key] = (structureCounts[key] || 0) + value
    })
  })

  const parsed: StructuredParsedDocument = {
    document_name: params.fileName.replace(/\.pdf$/i, ''),
    page_count: pages.length,
    full_text: normalizeText(markdownText || pages.map(page => page.full_text).join('\n\n')),
    structure_counts: structureCounts,
    pages,
    artifacts: buildArtifacts(statusPayload.result || {}),
  }

  return {
    ...statusPayload,
    parsed,
  }
}
