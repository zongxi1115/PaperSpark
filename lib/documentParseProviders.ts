import type {
  AdvancedParseProviderId,
  AppSettings,
  DocumentParseEngine,
  DocumentParseRuntime,
  PDFParserSource,
} from './types'

export interface AdvancedParseProviderDefinition {
  id: AdvancedParseProviderId
  label: string
  description: string
  engine: DocumentParseEngine
  runtime: DocumentParseRuntime
}

export const DEFAULT_ADVANCED_PARSE_PROVIDER: AdvancedParseProviderId = 'surya-local'

export const ADVANCED_PARSE_PROVIDERS: Record<AdvancedParseProviderId, AdvancedParseProviderDefinition> = {
  'surya-local': {
    id: 'surya-local',
    label: 'Surya OCR 本地服务',
    description: '使用本机 Python/服务容器运行的 Surya OCR 解析。',
    engine: 'surya',
    runtime: 'local-python',
  },
  'surya-modal': {
    id: 'surya-modal',
    label: 'Surya OCR Modal 云端',
    description: '使用部署在 Modal 上的 Surya OCR 解析。',
    engine: 'surya',
    runtime: 'modal',
  },
  mineru: {
    id: 'mineru',
    label: 'MinerU 云端解析',
    description: '使用 MinerU 精准 API 执行云端文档解析。',
    engine: 'mineru',
    runtime: 'remote-http',
  },
}

export function isAdvancedParseProviderId(value: string | null | undefined): value is AdvancedParseProviderId {
  return value === 'surya-local' || value === 'surya-modal' || value === 'mineru'
}

export function normalizePDFParserSource(
  source: PDFParserSource | string | null | undefined,
): PDFParserSource | undefined {
  if (!source) return undefined
  if (source === 'surya') return DEFAULT_ADVANCED_PARSE_PROVIDER
  if (source === 'pdfjs' || isAdvancedParseProviderId(source)) return source
  return undefined
}

export function isAdvancedParserSource(source: PDFParserSource | string | null | undefined) {
  const normalized = normalizePDFParserSource(source)
  return normalized !== undefined && normalized !== 'pdfjs'
}

export function getAdvancedParseProviderDefinition(
  providerId: AdvancedParseProviderId,
): AdvancedParseProviderDefinition {
  return ADVANCED_PARSE_PROVIDERS[providerId]
}

export function getDefaultAdvancedParseProvider(settings?: Pick<AppSettings, 'documentParse'> | null): AdvancedParseProviderId {
  const candidate = settings?.documentParse?.defaultAdvancedProvider
  return isAdvancedParseProviderId(candidate) ? candidate : DEFAULT_ADVANCED_PARSE_PROVIDER
}

export function getAdvancedParseProviderBaseUrl(
  settings: Pick<AppSettings, 'documentParse'> | null | undefined,
  providerId: AdvancedParseProviderId,
): string {
  return settings?.documentParse?.providers?.[providerId]?.baseUrl?.trim() || ''
}
