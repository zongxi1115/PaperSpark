import { spawn } from 'node:child_process'
import type { LiteratureProviderConfig, LiteratureProviderDiscoveredTool } from './literatureProviders'
import { parseCommandLine } from './literatureProviders'

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  jsonrpc: '2.0'
  id?: number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

type McpSessionInfo = {
  serverInfo?: {
    name?: string
    version?: string
  }
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

function encodeMessage(payload: JsonRpcRequest | JsonRpcNotification) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8')
  return Buffer.concat([header, body])
}

function extractMessages(buffer: Buffer) {
  const messages: JsonRpcResponse[] = []
  let rest: Buffer = buffer

  while (rest.length > 0) {
    const headerEnd = rest.indexOf('\r\n\r\n')
    if (headerEnd < 0) break

    const headerText = rest.subarray(0, headerEnd).toString('utf8')
    const lengthMatch = headerText.match(/content-length:\s*(\d+)/iu)
    if (!lengthMatch) {
      throw new Error('MCP 响应缺少 Content-Length')
    }

    const bodyLength = Number(lengthMatch[1])
    const bodyStart = headerEnd + 4
    const totalLength = bodyStart + bodyLength
    if (rest.length < totalLength) break

    const rawBody = rest.subarray(bodyStart, totalLength).toString('utf8')
    rest = rest.subarray(totalLength)
    messages.push(JSON.parse(rawBody) as JsonRpcResponse)
  }

  return {
    rest,
    messages,
  }
}

async function withMcpProcess<T>(
  provider: LiteratureProviderConfig,
  runner: (client: {
    request: <TResult>(method: string, params?: unknown) => Promise<TResult>
    notify: (method: string, params?: unknown) => void
  }) => Promise<T>,
) {
  if (!provider.command?.trim()) {
    throw new Error('MCP 命令为空')
  }

  const segments = parseCommandLine(provider.command)
  const executable = segments[0]
  const args = segments.slice(1)

  if (!executable) {
    throw new Error('MCP 命令无效')
  }

  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    windowsHide: true,
  })

  let stdoutBuffer: Buffer = Buffer.alloc(0)
  let stderrBuffer = ''
  let nextId = 1
  const pending = new Map<number, PendingRequest>()
  const timeoutMs = 15000

  const request = <TResult>(method: string, params?: unknown) =>
    new Promise<TResult>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      child.stdin.write(encodeMessage({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }))
    })

  const notify = (method: string, params?: unknown) => {
    child.stdin.write(encodeMessage({
      jsonrpc: '2.0',
      method,
      params,
    }))
  }

  child.stdout.on('data', chunk => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, Buffer.from(chunk)])

    try {
      const parsed = extractMessages(stdoutBuffer)
      stdoutBuffer = parsed.rest

      for (const message of parsed.messages) {
        if (typeof message.id !== 'number') continue
        const current = pending.get(message.id)
        if (!current) continue
        pending.delete(message.id)

        if (message.error) {
          current.reject(new Error(message.error.message || 'MCP 调用失败'))
        } else {
          current.resolve(message.result)
        }
      }
    } catch (error) {
      for (const current of pending.values()) {
        current.reject(error)
      }
      pending.clear()
      if (!child.killed) {
        child.kill()
      }
    }
  })

  child.stderr.on('data', chunk => {
    stderrBuffer += Buffer.from(chunk).toString('utf8')
  })

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('MCP 连接超时'))
      if (!child.killed) {
        child.kill()
      }
    }, timeoutMs)

    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', code => {
      if (pending.size > 0) {
        const message = stderrBuffer.trim() || `MCP 进程已退出 (${code ?? 'unknown'})`
        for (const current of pending.values()) {
          current.reject(new Error(message))
        }
        pending.clear()
      }
    })

    ;(async () => {
      try {
        const result = await runner({ request, notify })
        clearTimeout(timer)
        resolve(result)
      } catch (error) {
        clearTimeout(timer)
        const suffix = stderrBuffer.trim()
        if (error instanceof Error && suffix && !error.message.includes(suffix)) {
          reject(new Error(`${error.message} | ${suffix}`))
        } else {
          reject(error)
        }
      } finally {
        if (!child.killed) {
          child.kill()
        }
      }
    })()
  })
}

async function initialize(client: {
  request: <TResult>(method: string, params?: unknown) => Promise<TResult>
  notify: (method: string, params?: unknown) => void
}) {
  const result = await client.request<McpSessionInfo>('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'PaperSpark',
      version: '1.0.0',
    },
  })

  client.notify('notifications/initialized')
  return result
}

export async function listMcpTools(provider: LiteratureProviderConfig) {
  return await withMcpProcess(provider, async client => {
    const session = await initialize(client)
    const response = await client.request<{
      tools?: Array<{
        name: string
        description?: string
      }>
    }>('tools/list', {})

    return {
      serverInfo: session.serverInfo,
      tools: (response?.tools || []).map<LiteratureProviderDiscoveredTool>(tool => ({
        name: tool.name,
        description: tool.description,
      })),
    }
  })
}

export async function callMcpTool(
  provider: LiteratureProviderConfig,
  toolName: string,
  args: Record<string, unknown>,
) {
  return await withMcpProcess(provider, async client => {
    await initialize(client)
    return await client.request<{
      structuredContent?: unknown
      content?: Array<{
        type?: string
        text?: string
      }>
      isError?: boolean
    }>('tools/call', {
      name: toolName,
      arguments: args,
    })
  })
}

export function unwrapMcpToolResult(result: unknown) {
  if (!result || typeof result !== 'object') return result

  const payload = result as {
    structuredContent?: unknown
    content?: Array<{ text?: string }>
    isError?: boolean
  }

  if (payload.isError) {
    const message = payload.content?.map(item => item.text).filter(Boolean).join('\n') || 'MCP 工具调用失败'
    throw new Error(message)
  }

  if (payload.structuredContent !== undefined) {
    return payload.structuredContent
  }

  const text = payload.content?.map(item => item.text).filter(Boolean).join('\n')
  if (!text) return result

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
