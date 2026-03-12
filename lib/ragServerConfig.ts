import type { ModelConfig } from '@/lib/types'

type PartialModelConfig = Partial<ModelConfig> | null | undefined

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

export function resolveEmbeddingProvider(modelConfig?: PartialModelConfig) {
  const apiKey = getEnvValue('api_key', 'API_KEY') || modelConfig?.apiKey?.trim()
  const modelName = getEnvValue('embedding_name', 'EMBEDDING_NAME') || modelConfig?.modelName?.trim() || 'text-embedding-3-small'
  const baseUrl = normalizeEndpoint(
    getEnvValue('base_url', 'BASE_URL') || modelConfig?.baseUrl?.trim() || 'https://api.openai.com/v1',
    'embeddings',
  )

  return {
    apiKey,
    modelName,
    baseUrl,
  }
}

export function resolveRerankProvider() {
  const apiKey = getEnvValue('api_key', 'API_KEY')
  const modelName = getEnvValue('reranker_name', 'RERANKER_NAME')
  const rawBaseUrl = getEnvValue('rerank_base_url', 'RERANK_BASE_URL', 'base_url', 'BASE_URL')

  if (!apiKey || !modelName || !rawBaseUrl) {
    return null
  }

  return {
    apiKey,
    modelName,
    baseUrl: normalizeEndpoint(rawBaseUrl, 'rerank'),
  }
}