/**
 * IndexedDB 存储适配器
 * 使用内存快照提供同步读能力，后台异步持久化到 IndexedDB
 */

import type { EventfulStorageProvider, StorageEventListener } from './StorageProvider'
import { LOCAL_STORAGE_ONLY_KEYS, STORAGE_PREFIX } from '../storageKeys'

const DB_NAME = 'paper_reader_workspace'
const DB_VERSION = 1
const STORE_NAME = 'records'

type StorageRecord = {
  key: string
  value: string
  updatedAt: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function isBrowser() {
  return typeof window !== 'undefined'
}

function hasIndexedDb() {
  return isBrowser() && typeof indexedDB !== 'undefined'
}

function hasLocalStorage() {
  return isBrowser() && typeof localStorage !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  if (!hasIndexedDb()) {
    return Promise.reject(new Error('IndexedDB not available'))
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    })
  }

  return dbPromise
}

async function readAllRecords(): Promise<StorageRecord[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve((request.result as StorageRecord[] | undefined) ?? [])
    request.onerror = () => reject(request.error ?? new Error('Failed to read IndexedDB records'))
  })
}

async function putRecord(record: StorageRecord): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write IndexedDB record'))
    tx.objectStore(STORE_NAME).put(record)
  })
}

async function putRecords(records: StorageRecord[]): Promise<void> {
  if (records.length === 0) return

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to write IndexedDB records'))
    const store = tx.objectStore(STORE_NAME)
    records.forEach(record => store.put(record))
  })
}

async function deleteRecord(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to delete IndexedDB record'))
    tx.objectStore(STORE_NAME).delete(key)
  })
}

async function clearStore(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Failed to clear IndexedDB store'))
    tx.objectStore(STORE_NAME).clear()
  })
}

export class IndexedDBStorageAdapter implements EventfulStorageProvider {
  private prefix: string
  private cache = new Map<string, string>()
  private listeners: Set<StorageEventListener> = new Set()
  private readyPromise: Promise<void> | null = null
  private hydrated = false

  constructor(prefix: string = STORAGE_PREFIX) {
    this.prefix = prefix
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`
  }

  private getOriginalKey(fullKey: string): string {
    if (fullKey.startsWith(this.prefix)) {
      return fullKey.slice(this.prefix.length)
    }
    return fullKey
  }

  private isManagedLegacyLocalStorageKey(fullKey: string): boolean {
    if (!fullKey.startsWith(this.prefix)) return false
    return !LOCAL_STORAGE_ONLY_KEYS.has(this.getOriginalKey(fullKey))
  }

  private notifyListeners(key: string, newValue: string | null, oldValue: string | null): void {
    this.listeners.forEach(listener => {
      try {
        listener(key, newValue, oldValue)
      } catch (error) {
        console.error('IndexedDB storage listener error:', error)
      }
    })
  }

  private loadLocalStorageFallback(): void {
    if (!hasLocalStorage()) return

    const nextCache = new Map<string, string>()
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !this.isManagedLegacyLocalStorageKey(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) {
        nextCache.set(this.getOriginalKey(key), value)
      }
    }
    this.cache = nextCache
  }

  private async migrateLegacyLocalStorage(): Promise<void> {
    if (!hasIndexedDb() || !hasLocalStorage()) return

    const recordsToMigrate: StorageRecord[] = []
    const keysToRemove: string[] = []

    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i)
      if (!fullKey || !this.isManagedLegacyLocalStorageKey(fullKey)) continue

      keysToRemove.push(fullKey)

      const key = this.getOriginalKey(fullKey)
      const value = localStorage.getItem(fullKey)
      if (value === null || this.cache.has(key)) continue

      this.cache.set(key, value)
      recordsToMigrate.push({
        key,
        value,
        updatedAt: new Date().toISOString(),
      })
    }

    if (recordsToMigrate.length > 0) {
      await putRecords(recordsToMigrate)
    }

    keysToRemove.forEach(key => {
      localStorage.removeItem(key)
    })
  }

  async ready(): Promise<void> {
    if (this.hydrated || !isBrowser()) {
      return
    }

    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        if (!hasIndexedDb()) {
          this.loadLocalStorageFallback()
          this.hydrated = true
          return
        }

        const records = await readAllRecords()
        const nextCache = new Map(records.map(record => [record.key, record.value]))

        for (const [key, value] of this.cache.entries()) {
          nextCache.set(key, value)
        }

        this.cache = nextCache
        await this.migrateLegacyLocalStorage()
        this.hydrated = true
      })().catch((error) => {
        this.readyPromise = null
        console.error('Failed to initialize IndexedDB storage:', error)
        throw error
      })
    }

    await this.readyPromise
  }

  getItem(key: string): string | null {
    return this.cache.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    const oldValue = this.cache.get(key) ?? null
    this.cache.set(key, value)

    if (hasIndexedDb()) {
      void this.ready()
        .then(() => putRecord({ key, value, updatedAt: new Date().toISOString() }))
        .catch((error) => {
          console.error('IndexedDB setItem error:', error)
        })
    } else if (hasLocalStorage()) {
      try {
        localStorage.setItem(this.getFullKey(key), value)
      } catch (error) {
        console.error('LocalStorage fallback setItem error:', error)
      }
    }

    this.notifyListeners(key, value, oldValue)
  }

  removeItem(key: string): void {
    const oldValue = this.cache.get(key) ?? null
    this.cache.delete(key)

    if (hasIndexedDb()) {
      void this.ready()
        .then(() => deleteRecord(key))
        .catch((error) => {
          console.error('IndexedDB removeItem error:', error)
        })
    } else if (hasLocalStorage()) {
      try {
        localStorage.removeItem(this.getFullKey(key))
      } catch (error) {
        console.error('LocalStorage fallback removeItem error:', error)
      }
    }

    this.notifyListeners(key, null, oldValue)
  }

  clear(): void {
    const removedKeys = Array.from(this.cache.keys())
    this.cache.clear()

    if (hasIndexedDb()) {
      void this.ready()
        .then(() => clearStore())
        .catch((error) => {
          console.error('IndexedDB clear error:', error)
        })
    } else if (hasLocalStorage()) {
      try {
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && this.isManagedLegacyLocalStorageKey(key)) {
            keysToRemove.push(key)
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key))
      } catch (error) {
        console.error('LocalStorage fallback clear error:', error)
      }
    }

    removedKeys.forEach(key => this.notifyListeners(key, null, null))
  }

  getAllKeys(): string[] {
    return Array.from(this.cache.keys())
  }

  hasKey(key: string): boolean {
    return this.cache.has(key)
  }

  getLength(): number {
    return this.cache.size
  }

  getMultiple(keys: string[]): Record<string, string | null> {
    const result: Record<string, string | null> = {}
    keys.forEach(key => {
      result[key] = this.getItem(key)
    })
    return result
  }

  setMultiple(items: Record<string, string>): void {
    Object.entries(items).forEach(([key, value]) => {
      this.setItem(key, value)
    })
  }

  removeMultiple(keys: string[]): void {
    keys.forEach(key => {
      this.removeItem(key)
    })
  }

  addListener(listener: StorageEventListener): () => void {
    this.listeners.add(listener)
    return () => this.removeListener(listener)
  }

  removeListener(listener: StorageEventListener): void {
    this.listeners.delete(listener)
  }

  destroy(): void {
    this.listeners.clear()
  }
}
