import type { KnowledgeItem, ModelConfig, AutoGraphAnalysis } from './types'
import { getSettings, getSelectedSmallModel, updateKnowledgeItem, getSelectedLargeModel } from './storage'

/**
 * 自动构建知识图谱
 * 在沉浸式阅读时自动调用，使用小参数模型分析论文并构建图谱
 */
export async function autoGraphBuild(
  knowledgeItem: KnowledgeItem,
  fullText?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const settings = getSettings()
    const modelConfig = getSelectedLargeModel(settings)

    if (!modelConfig) {
      console.warn('No small model configured for auto graph build')
      return { success: false, error: 'No model configured' }
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

    // 2. 构建图谱节点和边
    const buildResponse = await fetch('/api/knowledge-graph/build', {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        knowledgeItemId: knowledgeItem.id,
        title: knowledgeItem.title,
        authors: knowledgeItem.authors,
        analysis,
      }),
    })

    if (!buildResponse.ok) {
      throw new Error('Build failed')
    }

    const buildResult = await buildResponse.json()
    if (!buildResult.success) {
      throw new Error(buildResult.error || 'Build failed')
    }

    console.log(
      `[AutoGraph] Built graph for "${knowledgeItem.title}": ${buildResult.nodesCreated} nodes, ${buildResult.edgesCreated} edges`
    )

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