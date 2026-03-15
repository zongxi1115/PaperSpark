import { NextRequest, NextResponse } from 'next/server'

// 文件上传/URL 导入：仅做校验并返回元数据（不下载、不存储文件内容）
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const url = formData.get('url') as string | null

    if (!file && !url) {
      return NextResponse.json({ error: 'No file or URL provided' }, { status: 400 })
    }

    // 处理 URL 导入
    if (url && !file) {
      try {
        const requestOnce = async (init: RequestInit) => {
          return await fetch(url, {
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              ...(init.headers || {}),
            },
            ...init,
          })
        }

        // 优先 HEAD，失败则用 Range GET 探测
        let response = await requestOnce({ method: 'HEAD' })
        if (!response.ok) {
          response = await requestOnce({ method: 'GET', headers: { Range: 'bytes=0-0' } })
        }

        if (!response.ok && response.status !== 206) {
          return NextResponse.json({ error: 'Failed to fetch URL' }, { status: 400 })
        }

        const contentType = response.headers.get('content-type') || ''
        const contentDisposition = response.headers.get('content-disposition') || ''
        
        // 从 content-disposition 提取文件名
        let filename = 'downloaded_file'
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '')
        }

        // 从 URL 提取文件名
        if (filename === 'downloaded_file') {
          const urlPath = new URL(url).pathname
          filename = urlPath.split('/').pop() || 'downloaded_file'
        }

        // 检查是否为 PDF
        const isPdf = contentType.includes('pdf') || filename.toLowerCase().endsWith('.pdf')
        
        if (!isPdf) {
          return NextResponse.json({ error: 'URL must point to a PDF file' }, { status: 400 })
        }

        let fileSize: number | undefined
        const contentLength = response.headers.get('content-length')
        if (contentLength) {
          const parsed = Number.parseInt(contentLength, 10)
          if (Number.isFinite(parsed) && parsed > 0) fileSize = parsed
        }

        const contentRange = response.headers.get('content-range')
        if (!fileSize && contentRange) {
          const match = contentRange.match(/\/(\d+)\s*$/)
          if (match?.[1]) {
            const parsed = Number.parseInt(match[1], 10)
            if (Number.isFinite(parsed) && parsed > 0) fileSize = parsed
          }
        }

        return NextResponse.json({
          success: true,
          fileName: filename,
          fileType: 'pdf',
          fileSize,
          url,
        })
      } catch (error) {
        console.error('URL fetch error:', error)
        return NextResponse.json({ error: 'Failed to fetch file from URL' }, { status: 400 })
      }
    }

    // 处理文件上传
    if (file) {
      const fileName = file.name.toLowerCase()
      const isPdf = fileName.endsWith('.pdf')
      const isDocx = fileName.endsWith('.docx')
      const isDoc = fileName.endsWith('.doc')
      const isWord = isDocx || isDoc

      if (!isPdf && !isWord) {
        return NextResponse.json({ error: 'Only PDF and Word files are supported' }, { status: 400 })
      }

      return NextResponse.json({
        success: true,
        fileName: file.name,
        fileType: isPdf ? 'pdf' : isDoc ? 'doc' : 'docx',
        fileSize: file.size,
      })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
