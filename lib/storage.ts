import type { AppDocument, AppSettings } from './types'
import { defaultSettings } from './types'

const DOCUMENTS_KEY = 'paper_reader_documents'
const SETTINGS_KEY = 'paper_reader_settings'
const LAST_DOC_KEY = 'paper_reader_last_doc'

function isBrowser() {
  return typeof window !== 'undefined'
}

export function getDocuments(): AppDocument[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(DOCUMENTS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AppDocument[]
  } catch {
    return []
  }
}

export function saveDocuments(docs: AppDocument[]): void {
  if (!isBrowser()) return
  localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(docs))
}

export function getDocument(id: string): AppDocument | null {
  return getDocuments().find(d => d.id === id) ?? null
}

export function saveDocument(doc: AppDocument): void {
  const docs = getDocuments()
  const idx = docs.findIndex(d => d.id === doc.id)
  if (idx >= 0) {
    docs[idx] = doc
  } else {
    docs.unshift(doc)
  }
  saveDocuments(docs)
}

export function deleteDocument(id: string): void {
  saveDocuments(getDocuments().filter(d => d.id !== id))
}

export function getSettings(): AppSettings {
  if (!isBrowser()) return defaultSettings
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return defaultSettings
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) }
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: AppSettings): void {
  if (!isBrowser()) return
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function getLastDocId(): string | null {
  if (!isBrowser()) return null
  return localStorage.getItem(LAST_DOC_KEY)
}

export function setLastDocId(id: string): void {
  if (!isBrowser()) return
  localStorage.setItem(LAST_DOC_KEY, id)
}

export const generateId = () => Math.random().toString(36).substring(2, 9)

export const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
