import type { AdvancedParseProviderId } from '@/lib/types'
import { DEFAULT_ADVANCED_PARSE_PROVIDER, isAdvancedParseProviderId } from '@/lib/documentParseProviders'

const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8765'
const DEFAULT_MINERU_URL = 'https://mineru.net'

function trimUrl(value: string | undefined) {
  return value?.trim().replace(/\/$/, '') || ''
}

export function normalizeAdvancedParseProviderId(value: string | null | undefined): AdvancedParseProviderId {
  if (isAdvancedParseProviderId(value)) return value
  return DEFAULT_ADVANCED_PARSE_PROVIDER
}

export function getAdvancedParseServiceUrl(providerId: AdvancedParseProviderId, explicitBaseUrl?: string | null) {
  const explicit = trimUrl(explicitBaseUrl || undefined)
  if (explicit) return explicit

  if (providerId === 'surya-modal') {
    return (
      trimUrl(process.env.SURYA_MODAL_SERVICE_URL) ||
      trimUrl(process.env.SURYA_SERVICE_URL) ||
      trimUrl(process.env.SURYA_OCR_SERVICE_URL) ||
      DEFAULT_LOCAL_URL
    )
  }

  if (providerId === 'mineru') {
    return (
      trimUrl(process.env.MINERU_SERVICE_URL) ||
      trimUrl(process.env.MINERU_API_BASE_URL) ||
      DEFAULT_MINERU_URL
    )
  }

  return (
    trimUrl(process.env.SURYA_LOCAL_SERVICE_URL) ||
    trimUrl(process.env.SURYA_OCR_SERVICE_URL) ||
    trimUrl(process.env.SURYA_SERVICE_URL) ||
    DEFAULT_LOCAL_URL
  )
}
