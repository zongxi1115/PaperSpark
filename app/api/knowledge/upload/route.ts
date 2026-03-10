import { NextRequest, NextResponse } from 'next/server'

// 文件上传处理 - 将文件存储到临时位置并返回元数据
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
        const response = await fetch(url)
        if (!response.ok) {
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

        const arrayBuffer = await response.arrayBuffer()
        const base64 = Buffer.from(arrayBuffer).toString('base64')

        return NextResponse.json({
          success: true,
          fileName: filename,
          fileType: 'pdf',
          fileSize: arrayBuffer.byteLength,
          url,
          content: base64, // 返回 base64 编码的文件内容
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
      const isWord = fileName.endsWith('.docx') || fileName.endsWith('.doc')

      if (!isPdf && !isWord) {
        return NextResponse.json({ error: 'Only PDF and Word files are supported' }, { status: 400 })
      }

      const arrayBuffer = await file.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')

      return NextResponse.json({
        success: true,
        fileName: file.name,
        fileType: isPdf ? 'pdf' : 'docx',
        fileSize: file.size,
        content: base64,
      })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
