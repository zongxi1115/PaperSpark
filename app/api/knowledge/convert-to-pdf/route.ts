import { NextRequest, NextResponse } from 'next/server'

const SURYA_SERVICE_URL =
  process.env.SURYA_OCR_SERVICE_URL ||
  process.env.SURYA_SERVICE_URL ||
  'http://127.0.0.1:8765'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const fileName = file.name.toLowerCase()
    const isWord = fileName.endsWith('.docx') || fileName.endsWith('.doc')

    if (!isWord) {
      return NextResponse.json({ error: 'Only Word files (.doc, .docx) are supported for conversion' }, { status: 400 })
    }

    // 转发给 Python 服务
    const pythonFormData = new FormData()
    pythonFormData.append('file', file)

    const response = await fetch(`${SURYA_SERVICE_URL}/convert/docx-to-pdf`, {
      method: 'POST',
      body: pythonFormData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      let errorMessage = 'Conversion failed'
      try {
        const errorJson = JSON.parse(errorText)
        errorMessage = errorJson.detail || errorMessage
      } catch {
        errorMessage = errorText || errorMessage
      }
      return NextResponse.json(
        { error: errorMessage },
        { status: response.status }
      )
    }

    // 获取转换后的 PDF
    const pdfBuffer = await response.arrayBuffer()
    const pdfFileName = response.headers.get('X-Converted-Filename') 
      || file.name.replace(/\.(docx?|dotx?)$/i, '.pdf')

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(pdfFileName)}"`,
        'X-Original-Filename': encodeURIComponent(file.name),
        'X-Converted-Filename': encodeURIComponent(pdfFileName),
      },
    })
  } catch (error) {
    console.error('Word to PDF conversion error:', error)
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to convert Word to PDF',
        hint: 'Make sure the Python OCR service is running at ' + SURYA_SERVICE_URL,
      },
      { status: 500 }
    )
  }
}
