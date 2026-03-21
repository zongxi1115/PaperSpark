'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalHeader, addToast, useDisclosure } from '@heroui/react'
import { Icon } from '@iconify/react'
import { defaultSettings } from '@/lib/types'
import { getSelectedLargeModel, getSettings } from '@/lib/storage'
import type { TextBlock } from '@/lib/types'

type ImmersiveCanvasPanelProps = {
  knowledgeItemId: string
  title: string
  fullText: string
  blocks: TextBlock[]
}

type CanvasBlockPayload = {
  id: string
  pageNum: number
  type: string
  text: string
}

function extractHtmlPayload(raw: string) {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''

  const codeFenceMatch = trimmed.match(/```(?:html)?\s*([\s\S]*?)```/i)
  if (codeFenceMatch?.[1]) {
    return codeFenceMatch[1].trim()
  }

  const htmlStart = trimmed.toLowerCase().indexOf('<!doctype html')
  if (htmlStart >= 0) return trimmed.slice(htmlStart)

  const htmlTagStart = trimmed.toLowerCase().indexOf('<html')
  if (htmlTagStart >= 0) return trimmed.slice(htmlTagStart)

  return trimmed
}

export default function ImmersiveCanvasPanel({ knowledgeItemId, title, fullText, blocks }: ImmersiveCanvasPanelProps) {
  const [canvasHtml, setCanvasHtml] = useState('')
  const [streamingCode, setStreamingCode] = useState('')
  const [canvasGenerating, setCanvasGenerating] = useState(false)
  const [showCodePanel, setShowCodePanel] = useState(false)
  const { isOpen: isPreviewOpen, onOpen: onPreviewOpen, onClose: onPreviewClose } = useDisclosure()
  const codePanelRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const htmlKey = `paper_reader_canvas_html_${knowledgeItemId}`
    const codeKey = `paper_reader_canvas_code_${knowledgeItemId}`
    const savedHtml = localStorage.getItem(htmlKey) || ''
    const savedCode = localStorage.getItem(codeKey) || ''
    if (savedHtml) setCanvasHtml(savedHtml)
    if (savedCode) setStreamingCode(savedCode)
  }, [knowledgeItemId])

  useEffect(() => {
    if (!canvasGenerating || !codePanelRef.current) return
    codePanelRef.current.scrollTop = codePanelRef.current.scrollHeight
  }, [streamingCode, canvasGenerating])

  const handleGenerateCanvas = useCallback(async () => {
    if (canvasGenerating) return

    const settings = getSettings()
    const largeModelConfig = getSelectedLargeModel(settings)
    const canvasPrompt = settings.immersiveCanvasPrompt?.trim() || defaultSettings.immersiveCanvasPrompt || ''

    if (!largeModelConfig?.apiKey || !largeModelConfig?.modelName) {
      addToast({ title: '请先在设置中配置大参数模型', color: 'warning' })
      return
    }

    const payloadBlocks: CanvasBlockPayload[] = blocks.slice(0, 300).map(item => ({
      id: item.id,
      pageNum: item.pageNum,
      type: item.type,
      text: item.text,
    }))

    setCanvasGenerating(true)
    setStreamingCode('')
    setShowCodePanel(true)
    try {
      const response = await fetch('/api/ai/immersive-canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          fullText,
          blocks: payloadBlocks,
          modelConfig: largeModelConfig,
          userPrompt: canvasPrompt,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || 'Canvas 生成失败')
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('未获取到流式响应')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullCode = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          const payload = JSON.parse(line) as { type?: string; delta?: string; error?: string }
          if (payload.type === 'text-delta' && payload.delta) {
            fullCode += payload.delta
            setStreamingCode(fullCode)
          }
          if (payload.type === 'error') {
            throw new Error(payload.error || '流式生成失败')
          }
        }
      }

      const html = extractHtmlPayload(fullCode)
      if (!html) {
        throw new Error('模型没有返回有效 HTML')
      }

      setCanvasHtml(html)
      if (typeof window !== 'undefined') {
        localStorage.setItem(`paper_reader_canvas_html_${knowledgeItemId}`, html)
        localStorage.setItem(`paper_reader_canvas_code_${knowledgeItemId}`, fullCode)
      }
      setShowCodePanel(false)
      onPreviewOpen()
      addToast({ title: 'Canvas 已生成', color: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Canvas 生成失败'
      addToast({ title: message, color: 'danger' })
    } finally {
      setCanvasGenerating(false)
    }
  }, [blocks, canvasGenerating, fullText, knowledgeItemId, title])

  return (
    <div className="h-full flex flex-col bg-[#171717]">
      <div className="px-4 py-3 border-b border-[#333]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-medium text-gray-200">AI Canvas</h3>
            <p className="text-xs text-gray-500 mt-0.5 truncate">使用全文上下文生成独立交互网页</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              color="primary"
              className="h-8"
              isLoading={canvasGenerating}
              onPress={handleGenerateCanvas}
            >
              生成网页
            </Button>
            <Button
              size="sm"
              variant="flat"
              className="h-8"
              isDisabled={!canvasHtml}
              onPress={onPreviewOpen}
            >
              全屏查看
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-b border-[#2d2d2d]">
        <p className="text-[11px] text-amber-300/90">
          AI生成的代码可能会包含潜在风险，生成内容后将自动展示生成结果。
        </p>
      </div>

      {canvasGenerating && (
        <div className="px-4 py-3 border-b border-[#2d2d2d] bg-[#121212]">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="text-[11px] text-gray-400">AI 正在生成代码...</p>
            <Button
              size="sm"
              variant="light"
              className="h-6 min-w-0 px-2 text-[10px]"
              onPress={() => setShowCodePanel(prev => !prev)}
            >
              {showCodePanel ? '折叠代码' : '展开代码'}
            </Button>
          </div>
          {showCodePanel && (
            <pre ref={codePanelRef} className="max-h-56 overflow-auto rounded-lg bg-[#0b0b0b] border border-[#2a2a2a] p-2.5 text-[10px] leading-relaxed text-emerald-300 whitespace-pre-wrap wrap-break-word">
            {streamingCode || '...'}
            </pre>
          )}
        </div>
      )}

      <div className="flex-1 p-3 overflow-hidden">
        {canvasHtml ? (
          <iframe
            title="immersive-canvas"
            className="w-full h-full rounded-xl border border-[#30445d] bg-white"
            sandbox="allow-scripts"
            srcDoc={canvasHtml}
          />
        ) : (
          <div className="h-full rounded-xl border border-dashed border-[#3a3a3a] flex items-center justify-center px-6 text-center">
            <div>
              <Icon icon="mdi:draw" className="text-3xl text-gray-500 mx-auto mb-2" />
              <p className="text-sm text-gray-400">点击上方“生成网页”，这里将显示 AI 生成的独立 Canvas 页面</p>
              <p className="text-xs text-gray-600 mt-1">生成使用大参数模型 + 全文上下文</p>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={isPreviewOpen} onClose={onPreviewClose} size="full" backdrop="opaque">
        <ModalContent>
          <ModalHeader className="text-sm">Canvas 全屏预览</ModalHeader>
          <ModalBody className="p-3">
            <iframe
              title="immersive-canvas-fullscreen"
              className="w-full h-full min-h-[80vh] rounded-lg border border-[#30445d] bg-white"
              sandbox="allow-scripts"
              srcDoc={canvasHtml}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  )
}
