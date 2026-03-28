import Dexie, { type EntityTable } from 'dexie'
import type { DocumentVersion } from './types'
import { getJSON, removeItem, setJSON } from './storage/StorageUtils'

const DB_NAME = 'PaperReaderDocumentVersions'
const LEGACY_VERSIONS_KEY = 'document_versions'

export const MAX_DOCUMENT_VERSIONS_PER_DOC = 20

type DocumentVersionDb = Dexie & {
  versions: EntityTable<DocumentVersion, 'id'>
}

let dbInstance: DocumentVersionDb | null = null
let migrationPromise: Promise<void> | null = null

function isBrowser() {
  return typeof window !== 'undefined'
}

function hasIndexedDb() {
  return isBrowser() && typeof indexedDB !== 'undefined'
}

function getDb(): DocumentVersionDb {
  if (!dbInstance) {
    const db = new Dexie(DB_NAME) as DocumentVersionDb
    db.version(1).stores({
      versions: 'id, documentId, createdAt, [documentId+createdAt]',
    })
    dbInstance = db
  }
  return dbInstance
}

function sortVersionsDesc(versions: DocumentVersion[]): DocumentVersion[] {
  return [...versions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

function getLegacyVersions(): DocumentVersion[] {
  if (!isBrowser()) return []
  return getJSON<DocumentVersion[]>(LEGACY_VERSIONS_KEY, [])
}

function setLegacyVersions(versions: DocumentVersion[]): void {
  if (!isBrowser()) return
  setJSON(LEGACY_VERSIONS_KEY, versions)
}

function trimLegacyVersions(allVersions: DocumentVersion[], documentId: string): DocumentVersion[] {
  const docVersions = sortVersionsDesc(allVersions.filter(version => version.documentId === documentId))
  if (docVersions.length <= MAX_DOCUMENT_VERSIONS_PER_DOC) {
    return allVersions
  }

  const keepIds = new Set(docVersions.slice(0, MAX_DOCUMENT_VERSIONS_PER_DOC).map(version => version.id))
  return allVersions.filter(version => version.documentId !== documentId || keepIds.has(version.id))
}

async function trimIndexedDbVersions(documentId: string): Promise<void> {
  const db = getDb()
  const docVersions = await db.versions.where('documentId').equals(documentId).toArray()
  const versionsToDelete = sortVersionsDesc(docVersions).slice(MAX_DOCUMENT_VERSIONS_PER_DOC)
  if (versionsToDelete.length === 0) return
  await db.versions.bulkDelete(versionsToDelete.map(version => version.id))
}

async function migrateLegacyVersionsToIndexedDb(): Promise<void> {
  if (!hasIndexedDb()) return

  const legacyVersions = getLegacyVersions()
  if (legacyVersions.length === 0) return

  const db = getDb()
  await db.transaction('rw', db.versions, async () => {
    await db.versions.bulkPut(legacyVersions)
    const documentIds = Array.from(new Set(legacyVersions.map(version => version.documentId)))
    for (const documentId of documentIds) {
      await trimIndexedDbVersions(documentId)
    }
  })

  removeItem(LEGACY_VERSIONS_KEY)
}

async function ensureReady(): Promise<void> {
  if (!hasIndexedDb()) return

  if (!migrationPromise) {
    migrationPromise = migrateLegacyVersionsToIndexedDb().catch((error) => {
      migrationPromise = null
      throw error
    })
  }

  await migrationPromise
}

export async function getVersionsByDocumentId(documentId: string): Promise<DocumentVersion[]> {
  if (!isBrowser()) return []

  if (!hasIndexedDb()) {
    return sortVersionsDesc(getLegacyVersions().filter(version => version.documentId === documentId))
  }

  await ensureReady()
  const versions = await getDb().versions.where('documentId').equals(documentId).toArray()
  return sortVersionsDesc(versions)
}

export async function getAllDocumentVersions(): Promise<DocumentVersion[]> {
  if (!isBrowser()) return []

  if (!hasIndexedDb()) {
    return sortVersionsDesc(getLegacyVersions())
  }

  await ensureReady()
  const versions = await getDb().versions.toArray()
  return sortVersionsDesc(versions)
}

export async function saveVersion(version: DocumentVersion): Promise<void> {
  if (!isBrowser()) return

  if (!hasIndexedDb()) {
    const allVersions = getLegacyVersions().filter(existing => existing.id !== version.id)
    allVersions.push(version)
    setLegacyVersions(trimLegacyVersions(allVersions, version.documentId))
    return
  }

  await ensureReady()

  const db = getDb()
  await db.transaction('rw', db.versions, async () => {
    await db.versions.put(version)
    await trimIndexedDbVersions(version.documentId)
  })
}

export async function deleteVersion(versionId: string): Promise<void> {
  if (!isBrowser()) return

  if (!hasIndexedDb()) {
    const filtered = getLegacyVersions().filter(version => version.id !== versionId)
    setLegacyVersions(filtered)
    return
  }

  await ensureReady()
  await getDb().versions.delete(versionId)
}

export async function deleteVersionsByDocumentId(documentId: string): Promise<void> {
  if (!isBrowser()) return

  if (!hasIndexedDb()) {
    const filtered = getLegacyVersions().filter(version => version.documentId !== documentId)
    setLegacyVersions(filtered)
    return
  }

  await ensureReady()
  await getDb().versions.where('documentId').equals(documentId).delete()
}

export async function getVersionById(versionId: string): Promise<DocumentVersion | null> {
  if (!isBrowser()) return null

  if (!hasIndexedDb()) {
    return getLegacyVersions().find(version => version.id === versionId) ?? null
  }

  await ensureReady()
  return (await getDb().versions.get(versionId)) ?? null
}
