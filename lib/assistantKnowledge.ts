'use client'

import { getKnowledgeItems } from '@/lib/storage'
import { getVectorDocumentsByDocumentId } from '@/lib/pdfCache'
import { indexKnowledgeForRAG } from '@/lib/rag'
import type { AssistantCitation, KnowledgeItem, RAGSearchResult, TextBlock, VectorDocument, EmbeddingModelConfig, RerankModelConfig } from '@/lib/types'

type CandidateHit = AssistantCitation

function tokenize(query: string) {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2)
}

function buildOverviewText(item: KnowledgeItem) {
  return [
    item.title ? `标题：${item.title}` : '',
    item.authors?.length ? `作者：${item.authors.join('、')}` : '',
    item.year ? `年份：${item.year}` : '',
    item.journal ? `期刊：${item.journal}` : '',
    item.abstract ? `摘要：${item.abstract}` : '',
    item.cachedSummary ? `总结：${item.cachedSummary}` : '',
    item.tags?.length ? `标签：${item.tags.join('、')}` : '',
  ].filter(Boolean).join('\n')
}

function buildOverviewBlocks(item: KnowledgeItem): TextBlock[] {
  return [{
    id: `overview-${item.id}`,
    type: 'paragraph',
    text: buildOverviewText(item),
    bbox: { x: 0, y: 0, width: 0, height: 0 },
    style: { fontSize: 12, fontFamily: 'system-ui', isBold: false, isItalic: false },
    pageNum: 0,
    itemIds: [],
  }]
}

function getKeywordScore(query: string, item: KnowledgeItem) {
  const haystack = [
    item.title,
    item.abstract,
    item.cachedSummary,
    item.journal,
    item.year,
    ...(item.authors || []),
    ...(item.tags || []),
  ].filter(Boolean).join('\n').toLowerCase()

  const tokens = tokenize(query)
  if (tokens.length === 0) return 0

  let score = 0
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += token.length > 4 ? 1.4 : 1
    }
  }

  return score / tokens.length
}

async function ensureOverviewVectors(item: KnowledgeItem, embeddingConfig?: EmbeddingModelConfig | null) {
  const documentId = `knowledge-overview:${item.id}`
  const existingVectors = await getVectorDocumentsByDocumentId(documentId)
  if (existingVectors.length > 0) {
    return existingVectors
  }

  const indexResult = await indexKnowledgeForRAG({
    documentId,
    blocks: buildOverviewBlocks(item),
    embeddingConfig,
    forceLocal: true,
  })

  if (!indexResult.success) {
    return []
  }

  return await getVectorDocumentsByDocumentId(documentId)
}

async function searchOverview(
  item: KnowledgeItem,
  query: string,
  embeddingConfig?: EmbeddingModelConfig | null
): Promise<CandidateHit | null> {
  const localVectors = await ensureOverviewVectors(item, embeddingConfig)
  const keywordScore = getKeywordScore(query, item)
  if (localVectors.length === 0 && keywordScore <= 0) {
    return null
  }

  let ragScore = 0
  try {
    if (localVectors.length > 0) {
      const response = await fetch('/api/rag/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          topK: 1,
          localVectors,
          embeddingConfig,
        }),
      })

      if (response.ok) {
        const payload = await response.json()
        const first = Array.isArray(payload.results) ? payload.results[0] as RAGSearchResult | undefined : undefined
        ragScore = first?.score || 0
      }
    }
  } catch (error) {
    console.error('Overview search failed:', error)
  }

  const finalScore = ragScore * 0.7 + keywordScore * 0.3
  if (finalScore <= 0) {
    return null
  }

  return {
    id: '',
    knowledgeItemId: item.id,
    title: item.title,
    excerpt: item.cachedSummary || item.abstract || buildOverviewText(item),
    sourceKind: 'overview',
    score: finalScore,
    year: item.year,
    journal: item.journal,
    authors: item.authors,
  }
}

async function searchFullText(
  item: KnowledgeItem,
  query: string,
  embeddingConfig?: EmbeddingModelConfig | null,
  rerankConfig?: RerankModelConfig | null
): Promise<CandidateHit[]> {
  if (!item.hasImmersiveCache || item.ragStatus !== 'indexed') {
    return []
  }

  try {
    const localVectors = item.ragStoredLocally
      ? await getVectorDocumentsByDocumentId(item.id)
      : undefined

    const response = await fetch('/api/rag/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        documentId: item.id,
        query,
        topK: 2,
        localVectors,
        embeddingConfig,
        rerankConfig,
      }),
    })

    if (!response.ok) {
      return []
    }

    const payload = await response.json()
    const results = Array.isArray(payload.results) ? payload.results as RAGSearchResult[] : []

    return results.map(result => ({
      id: '',
      knowledgeItemId: item.id,
      title: item.title,
      excerpt: result.text,
      sourceKind: 'fulltext',
      score: result.score,
      pageNum: result.pageNum,
      year: item.year,
      journal: item.journal,
      authors: item.authors,
    }))
  } catch (error) {
    console.error('Fulltext search failed:', error)
    return []
  }
}

export async function searchMyKnowledgeBase(
  query: string,
  embeddingConfig?: EmbeddingModelConfig | null,
  rerankConfig?: RerankModelConfig | null
): Promise<AssistantCitation[]> {
  const knowledgeItems = getKnowledgeItems()
  if (knowledgeItems.length === 0) {
    return []
  }

  const topKeywordItems = [...knowledgeItems]
    .map(item => ({ item, keywordScore: getKeywordScore(query, item) }))
    .filter(entry => entry.keywordScore > 0 || entry.item.hasImmersiveCache)
    .sort((left, right) => right.keywordScore - left.keywordScore)
    .slice(0, 6)
    .map(entry => entry.item)

  const overviewHits = (await Promise.all(topKeywordItems.map(item => searchOverview(item, query, embeddingConfig))))
    .filter((item): item is CandidateHit => Boolean(item))

  const fulltextHits = (await Promise.all(topKeywordItems.map(item => searchFullText(item, query, embeddingConfig, rerankConfig))))
    .flat()

  // 去重逻辑：同一篇文章只保留得分最高的一条结果
  const seenKnowledgeIds = new Set<string>()
  const deduped: CandidateHit[] = []

  const sorted = [...overviewHits, ...fulltextHits].sort((left, right) => right.score - left.score)

  for (const hit of sorted) {
    // 如果这篇文章还没有结果，添加它
    if (!seenKnowledgeIds.has(hit.knowledgeItemId)) {
      seenKnowledgeIds.add(hit.knowledgeItemId)
      deduped.push(hit)
    }
    // 已经有这篇文章的结果了，跳过（保留得分更高的）
    if (deduped.length >= 8) break
  }

  return deduped.map((hit, index) => ({
    ...hit,
    id: `K${index + 1}`,
  }))
}