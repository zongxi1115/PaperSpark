'use client'

const DB_NAME = 'paper_reader_uploads'
const DB_VERSION = 1
const STORE_NAME = 'files'

export const LOCAL_FILE_URL_PREFIX = 'paperfile:'

type StoredFileRecord = {
  id: string
  name: string
  type: string
  size: number
  lastModified: number
  blob: Blob
}

const objectUrlCache = new Map<string, string>()

function isBrowser() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function openDb(): Promise<IDBDatabase> {
  if (!isBrowser()) {
    return Promise.reject(new Error('IndexedDB not available'))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

export function toLocalFileUrl(id: string) {
  return `${LOCAL_FILE_URL_PREFIX}${id}`
}

export function isLocalFileUrl(url: string) {
  return url.startsWith(LOCAL_FILE_URL_PREFIX)
}

export async function storeFile(file: File): Promise<{ url: string; id: string }> {
  const db = await openDb()
  const id = createId()
  const record: StoredFileRecord = {
    id,
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
    blob: file,
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to store file'))
    tx.objectStore(STORE_NAME).put(record)
  })

  return { id, url: toLocalFileUrl(id) }
}

export async function getStoredFile(id: string): Promise<StoredFileRecord | null> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve((req.result as StoredFileRecord | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('Failed to read file'))
  })
}

export async function resolveLocalFileUrl(url: string): Promise<string> {
  if (!isLocalFileUrl(url)) return url

  const id = url.slice(LOCAL_FILE_URL_PREFIX.length)
  const cached = objectUrlCache.get(id)
  if (cached) return cached

  const record = await getStoredFile(id)
  if (!record) return ''

  const objectUrl = URL.createObjectURL(record.blob)
  objectUrlCache.set(id, objectUrl)
  return objectUrl
}

