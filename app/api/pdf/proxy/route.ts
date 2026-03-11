import { NextRequest, NextResponse } from 'next/server'

// 代理获取远程 PDF 文件，绕过 CORS 限制
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  
  if (!url) {
    return NextResponse.json({ error: '缺少 url 参数' }, { status: 400 })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `获取 PDF 失败: ${response.statusText}` },
        { status: response.status }
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    
    // 转换为 base64
    const uint8Array = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i])
    }
    const base64 = btoa(binary)

    return NextResponse.json({
      base64,
      contentType: response.headers.get('content-type') || 'application/pdf',
      size: arrayBuffer.byteLength,
    })
  } catch (error) {
    console.error('PDF proxy error:', error)
    const message = error instanceof Error ? error.message : '获取 PDF 失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
