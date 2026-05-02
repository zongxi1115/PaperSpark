import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { buildRuntimeFileUrl, resolveRuntimeUploadPath } from '@/lib/server/runtimePaths'

// 图片存储目录
const UPLOAD_DIR = resolveRuntimeUploadPath('images')

// 确保上传目录存在
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

// 生成唯一文件名
function generateFileName(originalName: string): string {
  const timestamp = Date.now()
  const randomStr = crypto.randomBytes(4).toString('hex')
  const ext = path.extname(originalName) || '.png'
  return `${timestamp}_${randomStr}${ext}`
}

// 支持的图片类型
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml']

export async function POST(request: NextRequest) {
  try {
    ensureUploadDir()

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    
    if (!file) {
      // 尝试获取 base64 数据
      const base64Data = formData.get('base64') as string | null
      const mimeType = formData.get('mimeType') as string | null
      
      if (base64Data && mimeType) {
        // 处理 base64 上传
        const base64String = base64Data.replace(/^data:image\/\w+;base64,/, '')
        const buffer = Buffer.from(base64String, 'base64')
        
        const ext = mimeType.split('/')[1] || 'png'
        const fileName = generateFileName(`image.${ext}`)
        const filePath = path.join(UPLOAD_DIR, fileName)
        
        fs.writeFileSync(filePath, buffer)
        
        return NextResponse.json({
          success: true,
          url: buildRuntimeFileUrl('images', fileName),
          fileName,
          size: buffer.length,
        })
      }
      
      return NextResponse.json(
        { success: false, error: '没有提供文件或 base64 数据' },
        { status: 400 }
      )
    }

    // 检查文件类型
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { success: false, error: '不支持的文件类型' },
        { status: 400 }
      )
    }

    // 检查文件大小 (最大 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: '文件大小超过限制 (10MB)' },
        { status: 400 }
      )
    }

    // 生成文件名并保存
    const fileName = generateFileName(file.name)
    const filePath = path.join(UPLOAD_DIR, fileName)
    
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    fs.writeFileSync(filePath, buffer)

    return NextResponse.json({
      success: true,
      url: buildRuntimeFileUrl('images', fileName),
      fileName,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '上传失败' },
      { status: 500 }
    )
  }
}

// 删除图片
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const fileName = searchParams.get('fileName')
    
    if (!fileName) {
      return NextResponse.json(
        { success: false, error: '缺少文件名' },
        { status: 400 }
      )
    }

    const filePath = path.join(UPLOAD_DIR, fileName)
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: '删除失败' },
      { status: 500 }
    )
  }
}
