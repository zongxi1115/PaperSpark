import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { buildRuntimeFileUrl, resolveRuntimeOutPath, resolveRuntimeUploadPath } from '@/lib/server/runtimePaths'

interface RunRequest {
  code: string
  timeout?: number
}

interface RunResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  executionTime: number
  images: string[]  // URL 列表
}

// 图片存储目录
const UPLOAD_DIR = resolveRuntimeUploadPath('python_images')

// 确保上传目录存在
function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

// 生成唯一文件名
function generateFileName(): string {
  const timestamp = Date.now()
  const randomStr = crypto.randomBytes(4).toString('hex')
  return `${timestamp}_${randomStr}.png`
}

export async function POST(request: NextRequest) {
  try {
    ensureUploadDir()

    const body = await request.json() as RunRequest
    const { code, timeout = 60000 } = body

    if (!code || typeof code !== 'string') {
      return NextResponse.json(
        { success: false, error: '代码不能为空' },
        { status: 400 }
      )
    }

    // 创建临时目录
    const tempDir = resolveRuntimeOutPath('python_runs')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    // 生成唯一文件名
    const timestamp = Date.now()
    const randomId = crypto.randomBytes(4).toString('hex')
    const scriptFile = path.join(tempDir, `script_${timestamp}_${randomId}.py`)
    const outputDir = path.join(tempDir, `output_${timestamp}_${randomId}`)
    fs.mkdirSync(outputDir, { recursive: true })

    // 转义输出目录路径
    const escapedOutputDir = outputDir.replace(/\\/g, '\\\\')

    // 包装代码：自动设置中文字体 + 捕获所有图片并保存到文件
    const wrappedCode = `# -*- coding: utf-8 -*-
import sys
import os

# 设置输出编码
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

# ========== 预初始化 matplotlib ==========
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

# 自动配置中文字体
def _setup_chinese_font():
    chinese_fonts = [
        'SimHei', 'Microsoft YaHei', 'STHeiti', 'PingFang SC',
        'WenQuanYi Micro Hei', 'Noto Sans CJK SC', 'Arial Unicode MS',
    ]
    available_fonts = [f.name for f in fm.fontManager.ttflist]
    for font in chinese_fonts:
        if font in available_fonts:
            plt.rcParams['font.sans-serif'] = [font]
            break
    plt.rcParams['axes.unicode_minus'] = False

_setup_chinese_font()

# 设置工作目录
_output_dir = r"${escapedOutputDir}"
os.chdir(_output_dir)

# ========== 图片捕获系统 ==========
_image_counter = 0

def _save_figure(fig):
    global _image_counter
    _image_counter += 1
    fname = f"_auto_figure_{_image_counter}.png"
    fig.savefig(fname, dpi=100, bbox_inches='tight', facecolor='white', edgecolor='none')
    plt.close(fig)
    return fname

def _save_all_figures():
    import matplotlib.pyplot as plt
    for fig_num in list(plt.get_fignums()):
        fig = plt.figure(fig_num)
        _save_figure(fig)

# 重写 plt.show() - 在非 GUI 后端下自动保存
_original_show = plt.show
def _patched_show(*args, **kwargs):
    _save_all_figures()
plt.show = _patched_show

# 重写 plt.savefig()
_original_savefig = plt.savefig
def _patched_savefig(fname, *args, **kwargs):
    result = _original_savefig(fname, *args, **kwargs)
    return result
plt.savefig = _patched_savefig

# ========== 用户代码开始 ==========
${code}
# ========== 用户代码结束 ==========

# 自动保存所有未保存的图形
_save_all_figures()

if _image_counter > 0:
    print("")
    print(f"[Generated {_image_counter} image(s)]")
`

    // 写入脚本文件
    fs.writeFileSync(scriptFile, wrappedCode, 'utf-8')

    const startTime = Date.now()

    // 运行 Python 脚本
    const result = await new Promise<RunResult>((resolve) => {
      const pythonExecutable = process.env.PAPERSPARK_PYTHON_PATH || 'python'
      const proc = spawn(pythonExecutable, [scriptFile], {
        cwd: outputDir,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString('utf-8')
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString('utf-8')
      })

      const timeoutId = setTimeout(() => {
        proc.kill('SIGKILL')
        stderr += '\n执行超时'
      }, timeout)

      proc.on('close', (code) => {
        clearTimeout(timeoutId)
        const executionTime = Date.now() - startTime

        // 收集图片 - 从输出目录读取所有 PNG 文件并保存到 public
        const images: string[] = []
        try {
          const files = fs.readdirSync(outputDir)
          // 按文件名排序，确保顺序正确
          const pngFiles = files.filter(f => f.toLowerCase().endsWith('.png')).sort()
          
          for (const file of pngFiles) {
            const srcPath = path.join(outputDir, file)
            const newFileName = generateFileName()
            const destPath = path.join(UPLOAD_DIR, newFileName)
            
            // 复制文件到 public 目录
            fs.copyFileSync(srcPath, destPath)
            
            // 返回公开 URL
            images.push(buildRuntimeFileUrl('python_images', newFileName))
          }
        } catch {
          // 忽略读取错误
        }

        // 清理临时文件
        try {
          fs.unlinkSync(scriptFile)
          fs.rmSync(outputDir, { recursive: true, force: true })
        } catch {
          // 忽略清理错误
        }

        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code,
          executionTime,
          images,
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timeoutId)
        resolve({
          success: false,
          stdout: '',
          stderr: `执行失败: ${err.message}`,
          exitCode: -1,
          executionTime: Date.now() - startTime,
          images: [],
        })
      })
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Python execution error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '未知错误',
        stdout: '',
        stderr: '',
        exitCode: -1,
        executionTime: 0,
        images: [],
      },
      { status: 500 }
    )
  }
}
