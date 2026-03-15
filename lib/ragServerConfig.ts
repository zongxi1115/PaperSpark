import type { ModelConfig, EmbeddingModelConfig, RerankModelConfig } from '@/lib/types'

type PartialModelConfig = Partial<ModelConfig> | null | undefined
type PartialEmbeddingConfig = Partial<EmbeddingModelConfig> | null | undefined
type PartialRerankConfig = Partial<RerankModelConfig> | null | undefined

function getEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function normalizeEndpoint(baseUrl: string, fallbackPath: 'embeddings' | 'rerank') {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  if (trimmed.endsWith('/embeddings') || trimmed.endsWith('/rerank')) {
    return trimmed
  }

  return `${trimmed}/${fallbackPath}`
}

export function resolveEmbeddingProvider(
  modelConfig?: PartialModelConfig,
  embeddingConfig?: PartialEmbeddingConfig
) {
  // 优先使用前端传入的嵌入模型配置
  const apiKey = embeddingConfig?.apiKey?.trim() || getEnvValue('api_key', 'API_KEY') || modelConfig?.apiKey?.trim()
  const modelName = embeddingConfig?.modelName?.trim() || getEnvValue('embedding_name', 'EMBEDDING_NAME') || modelConfig?.modelName?.trim() || 'text-embedding-3-small'
  const baseUrl = normalizeEndpoint(
    embeddingConfig?.baseUrl?.trim() || getEnvValue('base_url', 'BASE_URL') || modelConfig?.baseUrl?.trim() || 'https://api.openai.com/v1',
    'embeddings',
  )

  return {
    apiKey,
    modelName,
    baseUrl,
  }
}

export function resolveRerankProvider(rerankConfig?: PartialRerankConfig) {
  // 优先使用前端传入的重排序模型配置
  const apiKey = rerankConfig?.apiKey?.trim() || getEnvValue('api_key', 'API_KEY')
  const modelName = rerankConfig?.modelName?.trim() || getEnvValue('reranker_name', 'RERANKER_NAME')
  const rawBaseUrl = rerankConfig?.baseUrl?.trim() || getEnvValue('rerank_base_url', 'RERANK_BASE_URL', 'base_url', 'BASE_URL')

  if (!apiKey || !modelName || !rawBaseUrl) {
    return null
  }

  return {
    apiKey,
    modelName,
    baseUrl: normalizeEndpoint(rawBaseUrl, 'rerank'),
  }
}