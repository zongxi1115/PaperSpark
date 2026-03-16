import { NextRequest, NextResponse } from 'next/server'

// 代理获取远程 PDF 文件，绕过 CORS 限制（不落盘、不做 base64）
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  const download = req.nextUrl.searchParams.get('download') === '1'
  const requestedFilename = req.nextUrl.searchParams.get('filename')
  
  if (!url) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 })
  }

  try {
    const target = new URL(url)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return NextResponse.json({ error: '仅支持 http/https URL' }, { status: 400 })
    }

    // 基础 SSRF 防护：禁止显式本地地址（域名解析到内网的情况无法在此处可靠判断）
    const hostname = target.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return NextResponse.json({ error: '不允许代理本地地址' }, { status: 400 })
    }

    const range = req.headers.get('range')

    const response = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
        ...(range ? { Range: range } : {}),
      },
      redirect: 'follow',
    })

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: `获取 PDF 失败: ${response.statusText}` },
        { status: response.status }
      )
    }

    const headers = new Headers()
    headers.set('Content-Type', response.headers.get('content-type') || 'application/pdf')
    headers.set('Cache-Control', 'private, no-store')

    const passthroughHeaders = [
      'content-length',
      'content-range',
      'accept-ranges',
      'etag',
      'last-modified',
    ]

    passthroughHeaders.forEach(key => {
      const value = response.headers.get(key)
      if (value) headers.set(key, value)
    })

    // RFC 5987: 处理非 ASCII 文件名，返回 ASCII 安全版本和 UTF-8 编码版本
    const safeFilename = (value: string): { ascii: string; utf8: string } => {
      // 移除文件系统禁用字符
      const cleaned = value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'document.pdf'

      // 生成 ASCII 安全版本：非 ASCII 字符替换为下划线
      const ascii = cleaned
        .replace(/[^\x00-\x7F]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'document.pdf'

      // UTF-8 编码版本（用于 RFC 5987）
      const utf8 = encodeURIComponent(cleaned)

      return { ascii, utf8 }
    }

    if (requestedFilename) {
      const { ascii, utf8 } = safeFilename(requestedFilename)
      const disposition = download ? 'attachment' : 'inline'
      // RFC 5987: 同时提供 ASCII 和 UTF-8 编码的文件名，现代浏览器优先使用 UTF-8 版本
      headers.set('Content-Disposition', `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`)
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    })
  } catch (error) {
    console.error('PDF proxy error:', error)
    const message = error instanceof Error ? error.message : '获取 PDF 失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
