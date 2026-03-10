import type { AppDocument, AppSettings, KnowledgeItem, ZoteroConfig, Thought } from './types'
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

// 知识库存储
const KNOWLEDGE_KEY = 'paper_reader_knowledge'
const ZOTERO_CONFIG_KEY = 'paper_reader_zotero_config'

export function getKnowledgeItems(): KnowledgeItem[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(KNOWLEDGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as KnowledgeItem[]
  } catch {
    return []
  }
}

export function saveKnowledgeItems(items: KnowledgeItem[]): void {
  if (!isBrowser()) return
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(items))
}

export function addKnowledgeItem(item: KnowledgeItem): void {
  const items = getKnowledgeItems()
  const existing = items.find(i => i.id === item.id || (i.sourceId && i.sourceId === item.sourceId))
  if (existing) {
    Object.assign(existing, item, { updatedAt: new Date().toISOString() })
  } else {
    items.unshift(item)
  }
  saveKnowledgeItems(items)
}

export function updateKnowledgeItem(id: string, updates: Partial<KnowledgeItem>): void {
  const items = getKnowledgeItems()
  const idx = items.findIndex(i => i.id === id)
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...updates, updatedAt: new Date().toISOString() }
    saveKnowledgeItems(items)
  }
}

export function deleteKnowledgeItem(id: string): void {
  saveKnowledgeItems(getKnowledgeItems().filter(i => i.id !== id))
}

export function getZoteroConfig(): ZoteroConfig | null {
  if (!isBrowser()) return null
  try {
    const raw = localStorage.getItem(ZOTERO_CONFIG_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ZoteroConfig
  } catch {
    return null
  }
}

export function saveZoteroConfig(config: ZoteroConfig): void {
  if (!isBrowser()) return
  localStorage.setItem(ZOTERO_CONFIG_KEY, JSON.stringify(config))
}

export function clearZoteroConfig(): void {
  if (!isBrowser()) return
  localStorage.removeItem(ZOTERO_CONFIG_KEY)
}

// 随记想法存储
const THOUGHTS_KEY = 'paper_reader_thoughts'

export function getThoughts(): Thought[] {
  if (!isBrowser()) return []
  try {
    const raw = localStorage.getItem(THOUGHTS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Thought[]
  } catch {
    return []
  }
}

export function saveThoughts(thoughts: Thought[]): void {
  if (!isBrowser()) return
  localStorage.setItem(THOUGHTS_KEY, JSON.stringify(thoughts))
}

export function getThought(id: string): Thought | null {
  return getThoughts().find(t => t.id === id) ?? null
}

export function saveThought(thought: Thought): void {
  const thoughts = getThoughts()
  const idx = thoughts.findIndex(t => t.id === thought.id)
  if (idx >= 0) {
    thoughts[idx] = thought
  } else {
    thoughts.unshift(thought)
  }
  saveThoughts(thoughts)
}

export function deleteThought(id: string): void {
  saveThoughts(getThoughts().filter(t => t.id !== id))
}
