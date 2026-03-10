import { NextRequest, NextResponse } from 'next/server'
import { generateSummary, extractMetadata } from '@/lib/ai'
import type { ModelConfig } from '@/lib/types'

interface SummaryRequest {
  content: string // base64 encoded file content
  fileName: string
  fileType: 'pdf' | 'docx'
  modelConfig: ModelConfig
  itemType?: 'summary' | 'metadata' // summary for full summary, metadata for extracting title/authors
}

// 简单的 PDF 文本提取（不依赖外部库）
async function extractTextFromPdf(base64Content: string): Promise<string> {
  try {
    const buffer = Buffer.from(base64Content, 'base64')
    const content = buffer.toString('binary')
    
    // 简单提取文本流内容
    const textStreams: string[] = []
    
    // 查找 BT (begin text) 和 ET (end text) 之间的内容
    const btEtRegex = /BT\s*([\s\S]*?)\s*ET/g
    let match
    
    while ((match = btEtRegex.exec(content)) !== null) {
      const textBlock = match[1]
      
      // 提取 Tj 和 TJ 操作符中的文本
      // Tj: (text)Tj 或 <hex>Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g
      let tjMatch
      while ((tjMatch = tjRegex.exec(textBlock)) !== null) {
        textStreams.push(tjMatch[1])
      }
      
      // TJ: [(text1) (text2)]TJ
      const tjArrayRegex = /\[((?:\([^)]*\)|<[^>]*>)\s*)+\]\s*TJ/g
      let tjArrayMatch
      while ((tjArrayMatch = tjArrayRegex.exec(textBlock)) !== null) {
        const arrayContent = tjArrayMatch[1]
        const innerTextRegex = /\(([^)]*)\)/g
        let innerMatch
        while ((innerMatch = innerTextRegex.exec(arrayContent)) !== null) {
          textStreams.push(innerMatch[1])
        }
      }
    }
    
    // 清理和解码文本
    let text = textStreams.join(' ')
    
    // 解码 PDF 编码的特殊字符
    text = text
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    
    // 清理多余空白
    text = text.replace(/\s+/g, ' ').trim()
    
    return text
  } catch (error) {
    console.error('PDF extraction error:', error)
    return ''
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SummaryRequest
    const { content, fileName, fileType, modelConfig, itemType = 'summary' } = body

    if (!content || !modelConfig?.apiKey) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }

    // 提取文本
    let text = ''
    if (fileType === 'pdf') {
      text = await extractTextFromPdf(content)
    }
    
    if (!text.trim()) {
      return NextResponse.json({ 
        error: 'Could not extract text from the document',
        text: ''
      })
    }

    if (itemType === 'metadata') {
      const result = await extractMetadata(text, modelConfig, fileName)
      return NextResponse.json({
        success: result.success,
        ...result.metadata,
        extractedText: text.slice(0, 2000), // 返回部分提取的文本用于验证
      })
    }

    // 生成摘要
    const result = await generateSummary(text, modelConfig, { maxLength: 300, language: '中文' })
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    
    return NextResponse.json({
      success: true,
      summary: result.summary,
      textLength: text.length,
    })
  } catch (error) {
    console.error('Summary generation error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 })
  }
}