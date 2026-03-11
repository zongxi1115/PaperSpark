import { NextRequest, NextResponse } from 'next/server'
import { extractMetadata, generateSummary } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

export const runtime = 'nodejs'

const SURYA_SERVICE_URL = process.env.SURYA_OCR_SERVICE_URL || 'http://127.0.0.1:8765'

interface SuryaParseResponse {
  document_name: string
  page_count: number
  full_text: string
  structure_counts: Record<string, number>
  pages: Array<{
    page: number
    image_bbox: number[]
    full_text: string
    structure_counts: Record<string, number>
    layout_regions: Array<{
      label: string
      confidence?: number
      position: number
      bbox: number[]
      polygon: number[][]
      line_count: number
      text: string
    }>
  }>
  artifacts?: Record<string, string>
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const file = form.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少 PDF 文件' }, { status: 400 })
    }

    const upstreamForm = new FormData()
    upstreamForm.set('file', file)

    const pageRange = form.get('pageRange')
    if (typeof pageRange === 'string' && pageRange.trim()) {
      upstreamForm.set('page_range', pageRange)
    }

    const keepOutputs = form.get('keepOutputs')
    if (typeof keepOutputs === 'string') {
      upstreamForm.set('keep_outputs', keepOutputs)
    }

    const outputName = form.get('outputName')
    if (typeof outputName === 'string' && outputName.trim()) {
      upstreamForm.set('output_name', outputName)
    }

    const parseResponse = await fetch(`${SURYA_SERVICE_URL}/parse`, {
      method: 'POST',
      body: upstreamForm,
    })

    if (!parseResponse.ok) {
      const detail = await parseResponse.text()
      return NextResponse.json(
        { error: 'Surya 服务解析失败', detail },
        { status: parseResponse.status },
      )
    }

    const parsed = await parseResponse.json() as SuryaParseResponse
    const responsePayload: Record<string, unknown> = {
      success: true,
      parsed,
    }

    const includeSummary = form.get('includeSummary') === 'true'
    const includeMetadata = form.get('includeMetadata') === 'true'
    const modelConfigRaw = form.get('modelConfig')

    if ((includeSummary || includeMetadata) && typeof modelConfigRaw === 'string') {
      const modelConfig = JSON.parse(modelConfigRaw) as ModelConfig

      if (includeSummary) {
        const summary = await generateSummary(parsed.full_text, modelConfig, {
          maxLength: 500,
          language: '中文',
        })
        responsePayload.summary = summary
      }

      if (includeMetadata) {
        const metadata = await extractMetadata(parsed.full_text, modelConfig, file.name)
        responsePayload.metadata = metadata
      }
    }

    return NextResponse.json(responsePayload)
  } catch (error) {
    console.error('Surya parse proxy error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Surya 代理失败' },
      { status: 500 },
    )
  }
}
