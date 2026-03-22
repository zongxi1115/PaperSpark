import type { KnowledgeItem, AutoGraphAnalysis } from './types'
import { getSettings, getSelectedSmallModel, updateKnowledgeItem } from './storage'
import { buildKnowledgeGraphFromAnalysis } from './knowledgeGraph'
import { getJSON, setJSON } from './storage/StorageUtils'

const AUTO_GRAPH_FINGERPRINT_KEY = 'graph_build_fingerprints'
const AUTO_GRAPH_ANALYZED_ONCE_KEY = 'graph_analyzed_once'

function getBuildFingerprints(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  return getJSON<Record<string, string>>(AUTO_GRAPH_FINGERPRINT_KEY, {})
}

function saveBuildFingerprints(fingerprints: Record<string, string>): void {
  if (typeof window === 'undefined') return
  setJSON(AUTO_GRAPH_FINGERPRINT_KEY, fingerprints)
}

function getAnalyzedOnceMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  return getJSON<Record<string, string>>(AUTO_GRAPH_ANALYZED_ONCE_KEY, {})
}

function saveAnalyzedOnceMap(map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  setJSON(AUTO_GRAPH_ANALYZED_ONCE_KEY, map)
}

function buildContentFingerprint(knowledgeItem: KnowledgeItem, fullText?: string): string {
  const normalized = [
    knowledgeItem.title,
    knowledgeItem.abstract || '',
    knowledgeItem.authors.join('|'),
    (knowledgeItem.tags || []).join('|'),
    fullText?.slice(0, 3000) || '',
  ]
    .join('::')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  return normalized
}

/**
 * 自动构建知识图谱
 * 在沉浸式阅读时自动调用，使用小参数模型分析论文并构建图谱
 */
export async function autoGraphBuild(
  knowledgeItem: KnowledgeItem,
  fullText?: string
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  try {
    const settings = getSettings()
    const modelConfig = getSelectedSmallModel(settings)

    if (!modelConfig) {
      console.warn('No model configured for auto graph build')
      return { success: false, error: 'No model configured' }
    }

    // 用户期望：每篇文档只分析/构建一次（避免重复消耗）。
    const analyzedOnce = getAnalyzedOnceMap()
    if (analyzedOnce[knowledgeItem.id]) {
      return { success: true, skipped: true }
    }

    const fingerprint = buildContentFingerprint(knowledgeItem, fullText)
    const fingerprints = getBuildFingerprints()
    // 兼容旧逻辑：历史上如果写过 fingerprint，就视为已完成一次构建，后续不再重复 analyze。
    if (fingerprints[knowledgeItem.id]) {
      return { success: true, skipped: true }
    }

    // 1. 分析论文，提取概念、方法、标签和关联
    const analysisResponse = await fetch('/api/knowledge-graph/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledgeItemId: knowledgeItem.id,
        title: knowledgeItem.title,
      abstract: knowledgeItem.abstract || '',
        authors: knowledgeItem.authors,
      keywords: knowledgeItem.tags || [],
        fullText: fullText?.slice(0, 3000), // 只发送前3000字符
        modelConfig,
      }),
    })

    if (!analysisResponse.ok) {
      throw new Error('Analysis failed')
    }

    const analysisResult = await analysisResponse.json()
    if (!analysisResult.success || !analysisResult.analysis) {
      throw new Error(analysisResult.error || 'Analysis failed')
    }

    const analysis: AutoGraphAnalysis = analysisResult.analysis

    // 2. 在前端本地增量融合到已有图谱（localStorage）
    const buildResult = buildKnowledgeGraphFromAnalysis({
      knowledgeItemId: knowledgeItem.id,
      title: knowledgeItem.title,
      authors: knowledgeItem.authors,
      analysis,
    })

    console.log(
      `[AutoGraph] Built graph for "${knowledgeItem.title}": ${buildResult.nodesCreated} nodes, ${buildResult.edgesCreated} edges`
    )

    // 标记“已完成一次分析/构建”（无论是否降级），确保后续不会重复调用 /analyze。
    fingerprints[knowledgeItem.id] = fingerprint
    saveBuildFingerprints(fingerprints)
    analyzedOnce[knowledgeItem.id] = new Date().toISOString()
    saveAnalyzedOnceMap(analyzedOnce)

    // 3. 标记知识库条目已构建图谱
    updateKnowledgeItem(knowledgeItem.id, {
      updatedAt: new Date().toISOString(),
    })

    return { success: true }
  } catch (error) {
    console.error('[AutoGraph] Build error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * 检查是否应该自动构建图谱
 * 避免重复构建
 */
export function shouldAutoGraphBuild(knowledgeItem: KnowledgeItem): boolean {
  // 如果没有摘要和全文，不构建
  if (!knowledgeItem.abstract && !knowledgeItem.hasImmersiveCache) {
    return false
  }

  // 可以添加更多条件，比如检查是否已经构建过
  // 这里简单返回 true，每次阅读都会尝试更新图谱
  return true
}
