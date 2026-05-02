import fs from 'node:fs/promises'
import path from 'node:path'
import { extractMetadata } from '@/lib/ai'
import { resolveRuntimeOutPath } from '@/lib/server/runtimePaths'
import { normalizeSuryaParseResult } from '@/lib/suryaParser'
import type { KnowledgeItem, ModelConfig, PDFDocumentCache, PDFMetadata, PDFPageCache } from '@/lib/types'

const SURYA_SERVICE_URL =
  process.env.SURYA_OCR_SERVICE_URL ||
  process.env.SURYA_SERVICE_URL ||
  'http://127.0.0.1:8765'
const QUEUE_DIR = resolveRuntimeOutPath('knowledge-parse-queue')
const QUEUE_STORE_FILE = path.join(QUEUE_DIR, 'queue.json')
const QUEUE_FILES_DIR = path.join(QUEUE_DIR, 'files')
const QUEUE_RESULTS_DIR = path.join(QUEUE_DIR, 'results')

export type KnowledgeParseTaskStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
export type KnowledgeParseClientSyncStatus = 'pending' | 'synced' | 'failed'

export interface KnowledgeParseTaskSummary {
  id: string
  knowledgeItemId: string
  title: string
  fileName: string
  sourceType: KnowledgeItem['sourceType']
  status: KnowledgeParseTaskStatus
  stage?: string
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  position?: number
  resultAvailable: boolean
  clientSyncStatus: KnowledgeParseClientSyncStatus
  clientSyncedAt?: string
  clientSyncError?: string
}

interface KnowledgeParseTaskStored extends KnowledgeParseTaskSummary {
  remoteUrl?: string
  localFilePath?: string
  metadataModelConfig?: ModelConfig | null
  itemSnapshot: Pick<KnowledgeItem, 'id' | 'title' | 'authors' | 'abstract' | 'year' | 'journal'>
}

interface KnowledgeParseQueueStore {
  version: 1
  updatedAt: string
  tasks: Record<string, KnowledgeParseTaskStored>
}

interface EnqueueTaskInput {
  taskId: string
  title: string
  fileName: string
  sourceType: KnowledgeItem['sourceType']
  remoteUrl?: string
  file?: File
  metadataModelConfig?: ModelConfig | null
  itemSnapshot: Pick<KnowledgeItem, 'id' | 'title' | 'authors' | 'abstract' | 'year' | 'journal'>
}

interface TaskResultPayload {
  document: PDFDocumentCache
  pages: PDFPageCache[]
  knowledgeUpdates: Partial<KnowledgeItem>
}

type SuryaJobStatusResponse = {
  success?: boolean
  job_id?: string
  status?: 'queued' | 'processing' | 'completed' | 'failed'
  stage?: string
  error?: string
}

type SuryaJobResultResponse = SuryaJobStatusResponse & {
  parsed?: Parameters<typeof normalizeSuryaParseResult>[1]
}

const PROCESSING_STATE_KEY = Symbol.for('paper_reader.knowledge_parse_queue.processing')

type GlobalWithQueueState = typeof globalThis & {
  [PROCESSING_STATE_KEY]?: { running: boolean }
}

function getGlobalProcessingState() {
  const target = globalThis as GlobalWithQueueState
  if (!target[PROCESSING_STATE_KEY]) {
    target[PROCESSING_STATE_KEY] = { running: false }
  }
  return target[PROCESSING_STATE_KEY]
}

function nowIso() {
  return new Date().toISOString()
}

function createEmptyStore(): KnowledgeParseQueueStore {
  return {
    version: 1,
    updatedAt: nowIso(),
    tasks: {},
  }
}

async function ensureQueueDirs() {
  await fs.mkdir(QUEUE_FILES_DIR, { recursive: true })
  await fs.mkdir(QUEUE_RESULTS_DIR, { recursive: true })
}

async function readQueueStore() {
  try {
    const raw = await fs.readFile(QUEUE_STORE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<KnowledgeParseQueueStore>
    if (parsed.version === 1 && parsed.tasks && typeof parsed.tasks === 'object') {
      return parsed as KnowledgeParseQueueStore
    }
    return createEmptyStore()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ENOENT') return createEmptyStore()
    throw error
  }
}

async function writeQueueStore(store: KnowledgeParseQueueStore) {
  await ensureQueueDirs()
  const nextStore: KnowledgeParseQueueStore = {
    ...store,
    updatedAt: nowIso(),
  }
  await fs.writeFile(QUEUE_STORE_FILE, JSON.stringify(nextStore, null, 2), 'utf8')
}

async function updateQueueStore(mutator: (store: KnowledgeParseQueueStore) => void) {
  const store = await readQueueStore()
  mutator(store)
  await writeQueueStore(store)
}

function toSummary(task: KnowledgeParseTaskStored): KnowledgeParseTaskSummary {
  return {
    id: task.id,
    knowledgeItemId: task.knowledgeItemId,
    title: task.title,
    fileName: task.fileName,
    sourceType: task.sourceType,
    status: task.status,
    stage: task.stage,
    error: task.error,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    resultAvailable: task.resultAvailable,
    clientSyncStatus: task.clientSyncStatus,
    clientSyncedAt: task.clientSyncedAt,
    clientSyncError: task.clientSyncError,
  }
}

function compareTaskOrder(a: KnowledgeParseTaskStored, b: KnowledgeParseTaskStored) {
  const aTime = new Date(a.createdAt).getTime()
  const bTime = new Date(b.createdAt).getTime()
  if (aTime !== bTime) return bTime - aTime
  return b.id.localeCompare(a.id)
}

function dedupeStrings(values?: string[]) {
  if (!values || values.length === 0) return []
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)))
}

function buildResultPath(taskId: string) {
  return path.join(QUEUE_RESULTS_DIR, `${taskId}.json`)
}

function buildUploadPath(taskId: string, fileName: string) {
  const ext = path.extname(fileName) || '.pdf'
  return path.join(QUEUE_FILES_DIR, `${taskId}${ext}`)
}

async function resolvePdfBuffer(task: KnowledgeParseTaskStored) {
  if (task.localFilePath) {
    const buffer = await fs.readFile(task.localFilePath)
    return { buffer, fileName: task.fileName }
  }

  if (!task.remoteUrl) {
    throw new Error('缺少 PDF 来源')
  }

  const response = await fetch(task.remoteUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`获取 PDF 失败: ${response.status}`)
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    fileName: task.fileName,
  }
}

async function proxyToSurya(pathname: string, init?: RequestInit) {
  return fetch(`${SURYA_SERVICE_URL}${pathname}`, {
    cache: 'no-store',
    ...init,
  })
}

async function updateTask(taskId: string, updates: Partial<KnowledgeParseTaskStored>) {
  await updateQueueStore((store) => {
    const existing = store.tasks[taskId]
    if (!existing) return
    store.tasks[taskId] = {
      ...existing,
      ...updates,
      updatedAt: nowIso(),
    }
  })
}

async function submitToSurya(task: KnowledgeParseTaskStored, fileBuffer: Buffer) {
  const form = new FormData()
  const file = new File([new Uint8Array(fileBuffer)], task.fileName, { type: 'application/pdf' })
  form.set('file', file)
  form.set('output_name', task.knowledgeItemId)
  form.set('keep_outputs', 'false')

  const response = await proxyToSurya('/jobs', {
    method: 'POST',
    body: form,
  })

  const payload = await response.json().catch(() => null) as SuryaJobStatusResponse | null
  if (!response.ok || !payload?.job_id) {
    throw new Error(payload?.error || '提交 Surya 任务失败')
  }

  return payload
}

async function pollSuryaTask(taskId: string, jobId: string) {
  while (true) {
    const response = await proxyToSurya(`/jobs/${jobId}`)
    const payload = await response.json().catch(() => null) as SuryaJobStatusResponse | null
    if (!response.ok || !payload?.status) {
      throw new Error(payload?.error || '轮询解析状态失败')
    }

    await updateTask(taskId, {
      status: payload.status === 'failed' ? 'failed' : 'processing',
      stage: payload.stage || '解析中',
      error: payload.status === 'failed' ? payload.error : undefined,
    })

    if (payload.status === 'completed') {
      return payload
    }

    if (payload.status === 'failed') {
      throw new Error(payload.error || '解析失败')
    }

    await new Promise(resolve => setTimeout(resolve, 1500))
  }
}

async function fetchSuryaResult(jobId: string) {
  const response = await proxyToSurya(`/jobs/${jobId}/result`)
  const payload = await response.json().catch(() => null) as SuryaJobResultResponse | null
  if (!response.ok || payload?.status === 'failed') {
    throw new Error(payload?.error || '获取解析结果失败')
  }
  if (!payload?.parsed) {
    throw new Error('未获取到解析结果')
  }
  return payload
}

async function processTask(task: KnowledgeParseTaskStored) {
  const startedAt = nowIso()
  await updateTask(task.id, {
    status: 'processing',
    stage: '准备 PDF',
    startedAt,
    error: undefined,
    clientSyncStatus: 'pending',
    clientSyncError: undefined,
  })

  const { buffer, fileName } = await resolvePdfBuffer(task)
  await updateTask(task.id, { stage: '提交解析任务' })

  const submitPayload = await submitToSurya(task, buffer)
  await updateTask(task.id, { stage: submitPayload.stage || '排队解析' })
  await pollSuryaTask(task.id, submitPayload.job_id as string)

  await updateTask(task.id, { stage: '整理解析结果' })
  const resultPayload = await fetchSuryaResult(submitPayload.job_id as string)
  const metadataResult = task.metadataModelConfig
    ? await extractMetadata(resultPayload.parsed.full_text || '', task.metadataModelConfig, fileName)
    : { success: false, metadata: undefined }

  const parseResult = normalizeSuryaParseResult(
    task.knowledgeItemId,
    resultPayload.parsed,
    metadataResult.metadata,
  )

  const mergedMetadata: PDFMetadata = {
    title: metadataResult.metadata?.title || task.itemSnapshot.title,
    authors: metadataResult.metadata?.authors?.length ? metadataResult.metadata.authors : (task.itemSnapshot.authors || []),
    abstract: metadataResult.metadata?.abstract || task.itemSnapshot.abstract || '',
    year: metadataResult.metadata?.year || task.itemSnapshot.year || '',
    journal: metadataResult.metadata?.journal || task.itemSnapshot.journal || '',
    keywords: dedupeStrings(metadataResult.metadata?.keywords),
    references: dedupeStrings(metadataResult.metadata?.references),
  }

  const parsedAt = nowIso()
  const payload: TaskResultPayload = {
    document: {
      id: task.knowledgeItemId,
      knowledgeItemId: task.knowledgeItemId,
      fileName,
      pageCount: parseResult.pages.length,
      metadata: mergedMetadata,
      parser: 'surya',
      parseStatus: 'completed',
      parseError: '',
      fullText: parseResult.fullText,
      structureCounts: parseResult.structureCounts,
      parsedAt,
      updatedAt: parsedAt,
    },
    pages: parseResult.pages,
    knowledgeUpdates: {
      hasImmersiveCache: true,
      immersiveCacheAt: parsedAt,
      extractedMetadata: mergedMetadata,
      ragStatus: 'indexing',
      ragError: '',
    },
  }

  await ensureQueueDirs()
  await fs.writeFile(buildResultPath(task.id), JSON.stringify(payload), 'utf8')

  await updateTask(task.id, {
    status: 'completed',
    stage: '解析完成',
    completedAt: parsedAt,
    resultAvailable: true,
    clientSyncStatus: 'pending',
    clientSyncError: undefined,
  })
}

async function processQueueLoop() {
  const processingState = getGlobalProcessingState()
  if (processingState.running) return

  processingState.running = true
  try {
    while (true) {
      const store = await readQueueStore()
      const nextTask = Object.values(store.tasks)
        .filter(task => task.status === 'queued')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0]

      if (!nextTask) break

      try {
        await processTask(nextTask)
      } catch (error) {
        const message = error instanceof Error ? error.message : '解析失败'
        await updateTask(nextTask.id, {
          status: 'failed',
          stage: '失败',
          error: message,
          completedAt: nowIso(),
        })
      }
    }
  } finally {
    processingState.running = false
  }
}

export function ensureKnowledgeParseQueueProcessing() {
  void processQueueLoop()
}

export async function enqueueKnowledgeParseTask(input: EnqueueTaskInput) {
  await ensureQueueDirs()

  const store = await readQueueStore()
  const existing = Object.values(store.tasks).find(task => {
    if (task.knowledgeItemId !== input.itemSnapshot.id) return false
    return task.status === 'queued' || task.status === 'processing'
  })

  if (existing) {
    ensureKnowledgeParseQueueProcessing()
    return toSummary(existing)
  }

  let localFilePath: string | undefined
  if (input.file) {
    localFilePath = buildUploadPath(input.taskId, input.fileName)
    const buffer = Buffer.from(await input.file.arrayBuffer())
    await fs.writeFile(localFilePath, buffer)
  }

  const createdAt = nowIso()
  const task: KnowledgeParseTaskStored = {
    id: input.taskId,
    knowledgeItemId: input.itemSnapshot.id,
    title: input.title,
    fileName: input.fileName,
    sourceType: input.sourceType,
    remoteUrl: input.remoteUrl,
    localFilePath,
    metadataModelConfig: input.metadataModelConfig,
    itemSnapshot: input.itemSnapshot,
    status: 'queued',
    stage: '排队中',
    createdAt,
    updatedAt: createdAt,
    resultAvailable: false,
    clientSyncStatus: 'pending',
  }

  store.tasks[task.id] = task
  await writeQueueStore(store)
  ensureKnowledgeParseQueueProcessing()
  return toSummary(task)
}

export async function listKnowledgeParseTasks() {
  const store = await readQueueStore()
  const processingTask = Object.values(store.tasks).find(task => task.status === 'processing')
  const queuedIds = Object.values(store.tasks)
    .filter(task => task.status === 'queued')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(task => task.id)

  return Object.values(store.tasks)
    .sort(compareTaskOrder)
    .map(task => {
      const summary = toSummary(task)
      if (task.status === 'processing') {
        summary.position = 1
      } else if (task.status === 'queued') {
        const position = queuedIds.indexOf(task.id)
        summary.position = position >= 0 ? position + (processingTask ? 2 : 1) : undefined
      }
      return summary
    })
}

export async function getKnowledgeParseTaskResult(taskId: string) {
  const store = await readQueueStore()
  const task = store.tasks[taskId]
  if (!task) return null
  if (!task.resultAvailable) return { task: toSummary(task), result: null }

  const raw = await fs.readFile(buildResultPath(taskId), 'utf8')
  return {
    task: toSummary(task),
    result: JSON.parse(raw) as TaskResultPayload,
  }
}

export async function cancelKnowledgeParseTask(taskId: string) {
  let nextSummary: KnowledgeParseTaskSummary | null = null
  await updateQueueStore((store) => {
    const task = store.tasks[taskId]
    if (!task) return
    if (task.status !== 'queued') {
      throw new Error('只能暂停未开始的任务')
    }
    task.status = 'cancelled'
    task.stage = '已暂停'
    task.updatedAt = nowIso()
    task.completedAt = nowIso()
    nextSummary = toSummary(task)
  })
  return nextSummary
}

export async function acknowledgeKnowledgeParseTask(taskId: string, success: boolean, error?: string) {
  let nextSummary: KnowledgeParseTaskSummary | null = null
  await updateQueueStore((store) => {
    const task = store.tasks[taskId]
    if (!task) return
    task.clientSyncStatus = success ? 'synced' : 'failed'
    task.clientSyncedAt = success ? nowIso() : undefined
    task.clientSyncError = success ? undefined : (error || '同步到本地失败')
    task.updatedAt = nowIso()
    nextSummary = toSummary(task)
  })
  return nextSummary
}
