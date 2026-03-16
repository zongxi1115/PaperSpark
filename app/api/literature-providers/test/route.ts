import { NextRequest } from 'next/server'
import { listMcpTools } from '@/lib/mcpStdioClient'
import { createDefaultLiteratureProviders } from '@/lib/literatureProviders'
import type { LiteratureProviderConfig, LiteratureProviderTestResult } from '@/lib/literatureProviders'
import { searchWorksOnOpenAlex } from '@/lib/openalex'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const body = await req.json().catch(() => null) as { provider?: LiteratureProviderConfig } | null
  const provider = body?.provider || createDefaultLiteratureProviders()[0]

  try {
    if (provider.kind === 'openalex') {
      const probe = await searchWorksOnOpenAlex('retrieval augmented generation', {
        maxResults: 1,
      })

      const payload: LiteratureProviderTestResult = {
        ok: true,
        providerId: provider.id,
        providerName: provider.name,
        transport: provider.transport,
        latencyMs: Date.now() - startedAt,
        testedAt: new Date().toISOString(),
        message: probe.works.length > 0
          ? 'OpenAlex 连通正常，示例查询已返回结果。'
          : 'OpenAlex 连通正常，但示例查询没有返回结果。',
        serverInfo: {
          name: 'OpenAlex',
        },
        tools: [
          { name: 'searchWorks', description: '搜索 works' },
          { name: 'getConceptTree', description: '查询概念树' },
          { name: 'getRelatedWorks', description: '扩展相关文献' },
          { name: 'getAuthorWorks', description: '查询作者作品' },
        ],
      }

      return Response.json(payload)
    }

    const discovered = await listMcpTools(provider)
    const payload: LiteratureProviderTestResult = {
      ok: true,
      providerId: provider.id,
      providerName: provider.name,
      transport: provider.transport,
      latencyMs: Date.now() - startedAt,
      testedAt: new Date().toISOString(),
      message: discovered.tools.length > 0
        ? `已发现 ${discovered.tools.length} 个 MCP 工具。`
        : 'MCP 可连接，但没有发现工具。',
      serverInfo: discovered.serverInfo,
      tools: discovered.tools,
    }

    return Response.json(payload)
  } catch (error) {
    const payload: LiteratureProviderTestResult = {
      ok: false,
      providerId: provider.id,
      providerName: provider.name,
      transport: provider.transport,
      latencyMs: Date.now() - startedAt,
      testedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : '连接测试失败',
      tools: [],
    }

    return Response.json(payload, { status: 500 })
  }
}
