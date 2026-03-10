'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { zh } from '@blocknote/core/locales'
import type { Block } from '@blocknote/core'
import { Button, Divider, Textarea, Tooltip, addToast, Spinner } from '@heroui/react'
import { saveThought, getSettings } from '@/lib/storage'
import type { Thought, ModelConfig } from '@/lib/types'
import type { ThoughtAIAction } from '@/lib/ai'

interface ThoughtEditorProps {
  thought: Thought
  title: string
  summary: string
  onTitleChange: (value: string) => void
  onSummaryChange: (value: string) => void
  onSave: (thought: Thought) => void
}

// AI 操作类型定义
const AI_ACTIONS: { key: ThoughtAIAction; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    key: 'organize',
    label: 'AI 整理',
    icon: <OrganizeIcon />,
    desc: '整理成有条理的表达'
  },
  {
    key: 'refine',
    label: 'AI 提炼',
    icon: <RefineIcon />,
    desc: '提炼核心观点'
  },
  {
    key: 'expand',
    label: '思维扩展',
    icon: <ExpandIcon />,
    desc: '扩展思维方向'
  },
]

export function ThoughtEditor({
  thought,
  title,
  summary,
  onTitleChange,
  onSummaryChange,
  onSave
}: ThoughtEditorProps) {
  const [blocks, setBlocks] = useState<Block[]>([])
  const [loading, setLoading] = useState<ThoughtAIAction | null>(null)
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useCreateBlockNote({
    dictionary: {
      ...zh,
      placeholders: {
        ...zh.placeholders,
        emptyDocument: '记录你的想法，输入 / 快速选择语段类型…',
      },
    },
  })

  // 初始化
  useEffect(() => {
    const settings = getSettings()
    setModelConfig(settings.smallModel)

    if (thought.content && (thought.content as Block[]).length > 0) {
      editor.replaceBlocks(editor.document, thought.content as Block[])
      setBlocks(editor.document as Block[])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thought.id])

  // 获取纯文本内容
  const getPlainText = useCallback(() => {
    return editor.document
      .filter(b => b.type === 'paragraph' || b.type === 'heading')
      .map(b => {
        const block = b as { content?: { type: string; text: string }[] }
        return block.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? ''
      })
      .filter(t => t.trim())
      .join('\n')
  }, [editor])

  // 自动保存
  const handleChange = useCallback(() => {
    const current = editor.document as Block[]
    setBlocks(current)

    // 防抖保存
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      const updated: Thought = {
        ...thought,
        title,
        summary,
        content: current,
        updatedAt: new Date().toISOString(),
      }
      onSave(updated)
    }, 500)
  }, [editor, thought, title, summary, onSave])

  // 生成 AI 概述
  const handleGenerateSummary = useCallback(async () => {
    if (!modelConfig?.apiKey) {
      addToast({ title: '请先在设置页配置小参数模型的 API Key', color: 'warning' })
      return
    }

    const text = getPlainText()
    if (!text.trim()) {
      addToast({ title: '内容为空，无法生成概述', color: 'warning' })
      return
    }

    setLoading('summarize')
    try {
      const res = await fetch('/api/ai/thought', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          action: 'summarize',
          modelConfig
        }),
      })

      if (res.ok) {
        const { title: newTitle, summary: newSummary, error } = await res.json() as {
          title?: string
          summary?: string
          error?: string
        }

        if (error) {
          addToast({ title: error, color: 'danger' })
        } else {
          onTitleChange(newTitle || title)
          onSummaryChange(newSummary || '')
          addToast({ title: 'AI 概述已生成', color: 'success' })
        }
      }
    } catch (err) {
      addToast({ title: err instanceof Error ? err.message : '请求失败', color: 'danger' })
    } finally {
      setLoading(null)
    }
  }, [getPlainText, modelConfig, onTitleChange, onSummaryChange, title])

  // AI 操作（整理、提炼、扩展）
  const handleAIAction = useCallback(async (action: ThoughtAIAction) => {
    if (!modelConfig?.apiKey) {
      addToast({ title: '请先在设置页配置小参数模型的 API Key', color: 'warning' })
      return
    }

    const text = getPlainText()
    if (!text.trim()) {
      addToast({ title: '内容为空', color: 'warning' })
      return
    }

    setLoading(action)
    try {
      const res = await fetch('/api/ai/thought', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, action, modelConfig }),
      })

      if (res.ok) {
        const { result, error } = await res.json() as { result?: string; error?: string }

        if (error) {
          addToast({ title: error, color: 'danger' })
        } else if (result) {
          // 将结果追加到编辑器末尾
          const lines = result.split('\n').filter(l => l.trim())
          for (const line of lines) {
            editor.insertBlocks(
              [{ type: 'paragraph', content: [{ type: 'text', text: line, styles: {} }] }],
              editor.document[editor.document.length - 1],
              'after'
            )
          }
          addToast({ title: 'AI 处理完成', color: 'success' })
        }
      }
    } catch (err) {
      addToast({ title: err instanceof Error ? err.message : '请求失败', color: 'danger' })
    } finally {
      setLoading(null)
    }
  }, [getPlainText, modelConfig, editor])

  return (
    <div>
      {/* AI 工具栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
        padding: '8px 12px',
        background: 'var(--bg-secondary)',
        borderRadius: 8,
        flexWrap: 'wrap',
      }}>
        <Tooltip content="使用 AI 分析内容并生成标题和概述" placement="bottom">
          <Button
            size="sm"
            color="primary"
            variant="flat"
            onPress={handleGenerateSummary}
            isLoading={loading === 'summarize'}
            startContent={loading !== 'summarize' && <SparkleIcon />}
          >
            生成概述
          </Button>
        </Tooltip>

        <Divider orientation="vertical" style={{ height: 20 }} />

        {AI_ACTIONS.map(action => (
          <Tooltip key={action.key} content={action.desc} placement="bottom">
            <Button
              size="sm"
              color="secondary"
              variant="flat"
              onPress={() => handleAIAction(action.key)}
              isLoading={loading === action.key}
              startContent={loading !== action.key && action.icon}
            >
              {action.label}
            </Button>
          </Tooltip>
        ))}
      </div>

      {/* 概述编辑区 */}
      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: 'block',
          fontSize: 12,
          color: 'var(--text-muted)',
          marginBottom: 4
        }}>
          概述（可手动编辑）
        </label>
        <Textarea
          value={summary}
          onValueChange={onSummaryChange}
          placeholder="AI 生成的概述会显示在这里，也可以手动编辑..."
          minRows={2}
          maxRows={4}
          style={{ fontSize: 14 }}
        />
      </div>

      {/* BlockNote 编辑器 */}
      <div style={{
        border: '1px solid var(--border-color)',
        borderRadius: 8,
        padding: 16,
        minHeight: 300,
        background: 'var(--bg-primary)',
      }} >
        <BlockNoteView
          className='px-4 py-4'
          editor={editor}
          onChange={handleChange}
          theme="light"
        />
      </div>
    </div>
  )
}

// 图标组件
function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" />
    </svg>
  )
}

function OrganizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}

function RefineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}
