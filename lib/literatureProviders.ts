export type LiteratureProviderKind = 'openalex' | 'mcp'
export type LiteratureProviderTransport = 'builtin' | 'stdio'

export interface LiteratureProviderConfig {
  id: string
  name: string
  kind: LiteratureProviderKind
  transport: LiteratureProviderTransport
  enabled: boolean
  isBuiltIn?: boolean
  command?: string
  description?: string
  createdAt: string
  updatedAt: string
}

export interface LiteratureProviderDiscoveredTool {
  name: string
  description?: string
}

export interface LiteratureProviderTestResult {
  ok: boolean
  providerId: string
  providerName: string
  transport: LiteratureProviderTransport
  latencyMs: number
  testedAt: string
  message: string
  serverInfo?: {
    name?: string
    version?: string
  }
  tools: LiteratureProviderDiscoveredTool[]
}

export function createDefaultLiteratureProviders(): LiteratureProviderConfig[] {
  const now = new Date().toISOString()

  return [
    {
      id: 'literature-provider-openalex',
      name: 'OpenAlex',
      kind: 'openalex',
      transport: 'builtin',
      enabled: true,
      isBuiltIn: true,
      description: '内置学术检索源，适合稳定的论文发现与引用扩展。',
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function ensureLiteratureProviders(
  providers: LiteratureProviderConfig[] | undefined,
): LiteratureProviderConfig[] {
  const defaults = createDefaultLiteratureProviders()
  const incoming = providers || []

  const mergedDefaults: LiteratureProviderConfig[] = defaults.map(defaultProvider => {
    const saved = incoming.find(provider => provider.id === defaultProvider.id)
    if (!saved) return defaultProvider
    return {
      ...defaultProvider,
      ...saved,
      isBuiltIn: true,
      kind: 'openalex' as const,
      transport: 'builtin' as const,
      enabled: saved.enabled ?? true,
    }
  })

  const customProviders: LiteratureProviderConfig[] = incoming
    .filter(provider => !defaults.some(defaultProvider => defaultProvider.id === provider.id))
    .map(provider => ({
      ...provider,
      kind: provider.kind === 'openalex' ? 'openalex' : 'mcp',
      transport: provider.transport === 'builtin' ? 'builtin' : 'stdio',
      enabled: provider.enabled ?? true,
    }))

  return [...mergedDefaults, ...customProviders]
}

export function getSelectedLiteratureProvider(settings: {
  literatureProviders?: LiteratureProviderConfig[]
  defaultLiteratureProviderId?: string | null
}) {
  const providers = ensureLiteratureProviders(settings.literatureProviders)
  const selected = providers.find(provider => provider.id === settings.defaultLiteratureProviderId)
  if (selected?.enabled) return selected
  return providers.find(provider => provider.enabled) || providers[0] || null
}

export function deriveProviderNameFromCommand(command: string) {
  const trimmed = command.trim()
  if (!trimmed) return 'MCP 数据源'
  const firstToken = trimmed.split(/\s+/)[0] || 'mcp'
  const normalized = firstToken.split(/[\\/]/).pop() || firstToken
  return normalized.replace(/\.[a-z0-9]+$/i, '') || 'MCP 数据源'
}

export function parseCommandLine(command: string) {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return tokens
    .map(token => token.trim())
    .filter(Boolean)
    .map(token => {
      if (
        (token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith('\'') && token.endsWith('\''))
      ) {
        return token.slice(1, -1)
      }
      return token
    })
}
