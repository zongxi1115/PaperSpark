'use client'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, Input, Textarea, addToast, Tooltip, Divider } from '@heroui/react'
import { useCreateBlockNote } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { zh } from '@blocknote/core/locales'
import type { Block } from '@blocknote/core'
import type { Theme } from '@blocknote/mantine'
import { getThoughts, saveThought, deleteThought, generateId, getSettings, getSelectedSmallModel } from '@/lib/storage'
import type { Thought, ModelConfig } from '@/lib/types'
import type { ThoughtAIAction } from '@/lib/ai'
import { getThemeById, buildBlockNoteTheme } from '@/lib/editorThemes'
import { useThemeContext } from '@/components/Providers'

// AI 操作类型定义
const AI_ACTIONS: { key: ThoughtAIAction; label: string; icon: React.ReactNode; desc: string }[] = [
  { key: 'organize', label: '整理', icon: <OrganizeIcon />, desc: '整理成有条理的表达' },
  { key: 'refine', label: '提炼', icon: <RefineIcon />, desc: '提炼核心观点' },
  { key: 'expand', label: '扩展', icon: <ExpandIcon />, desc: '扩展思维方向' },
]

export function ThoughtNotesPanel() {
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [editingThought, setEditingThought] = useState<Thought | null>(null)
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { isDark } = useThemeContext()

  // 加载
  useEffect(() => {
    setThoughts(getThoughts())
    const settings = getSettings()
    setModelConfig(getSelectedSmallModel(settings))
  }, [])

  // 新增
  const handleCreate = useCallback(() => {
    const newThought: Thought = {
      id: generateId(),
      title: '新想法',
      summary: '',
      content: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    saveThought(newThought)
    setThoughts(getThoughts())
    setEditingThought(newThought)
    onOpen()
  }, [onOpen])

  // 点击卡片
  const handleCardClick = useCallback((thought: Thought) => {
    setEditingThought(thought)
    onOpen()
  }, [onOpen])

  // 删除
  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteThought(id)
    setThoughts(getThoughts())
    addToast({ title: '已删除', color: 'success' })
  }, [])

  // 关闭
  const handleClose = useCallback(() => {
    setEditingThought(null)
    onClose()
  }, [onClose])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 头部 */}
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
          {thoughts.length} 条记录
        </span>
        <Button size="sm" color="primary" variant="flat" onPress={handleCreate}>
          + 新增
        </Button>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {thoughts.length === 0 ? (
          <div style={{ 
            textAlign: 'center', 
            padding: 24, 
            color: 'var(--text-muted)',
            fontSize: 13,
          }}>
            点击「+ 新增」记录你的想法
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {thoughts.map(thought => (
              <div
                key={thought.id}
                onClick={() => handleCardClick(thought)}
                style={{
                  padding: '10px 12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  border: '1px solid var(--border-color)',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent-color)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <span style={{ 
                    fontSize: 13, 
                    fontWeight: 500, 
                    color: 'var(--text-primary)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {thought.title || '无标题'}
                  </span>
                  <button
                    onClick={(e) => handleDelete(thought.id, e)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      fontSize: 11,
                    }}
                  >
                    删除
                  </button>
                </div>
                <p style={{ 
                  fontSize: 11, 
                  color: 'var(--text-muted)', 
                  margin: 0,
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {thought.summary || getContentPreview(thought.content)}
                </p>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  {formatDate(thought.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 编辑模态框 */}
      <Modal isOpen={isOpen} onClose={handleClose} size="4xl" scrollBehavior="inside">
        <ModalContent>
          {editingThought && (
            <ThoughtEditorModal
              key={editingThought.id}
              thought={editingThought}
              modelConfig={modelConfig}
              isDark={isDark}
              onClose={handleClose}
              onSave={() => setThoughts(getThoughts())}
            />
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

// 独立的编辑器组件
function ThoughtEditorModal({ 
  thought, 
  modelConfig,
  isDark,
  onClose, 
  onSave 
}: { 
  thought: Thought
  modelConfig: ModelConfig | null
  isDark: boolean
  onClose: () => void
  onSave: () => void 
}) {
  const [title, setTitle] = useState(thought.title)
  const [summary, setSummary] = useState(thought.summary)
  const [loading, setLoading] = useState<ThoughtAIAction | 'summarize' | null>(null)
  
  // 获取编辑器主题
  const settings = useMemo(() => getSettings(), [])
  const activeThemeConfig = useMemo(() => getThemeById(settings.editorThemeId ?? 'default'), [settings.editorThemeId])
  const blockNoteTheme = useMemo(() => {
    const themes = buildBlockNoteTheme(activeThemeConfig)
    return (isDark ? themes.dark : themes.light) as Theme
  }, [activeThemeConfig, isDark])
  
  const editor = useCreateBlockNote({
    dictionary: {
      ...zh,
      placeholders: {
        ...zh.placeholders,
        emptyDocument: '记录想法...',
      },
    },
    initialContent: Array.isArray(thought.content) && thought.content.length > 0 ? (thought.content as Block[]) : undefined,
  })

  // 获取纯文本
  const getPlainText = useCallback(() => {
    return editor.document
      .filter(b => b.type === 'paragraph' || b.type === 'heading')
      .map(b => getBlockText(b).trim())
      .filter(Boolean)
      .join('\n')
  }, [editor])

  // 保存
  const handleSave = useCallback(() => {
    const updated: Thought = {
      ...thought,
      title,
      summary,
      content: editor.document as Block[],
      updatedAt: new Date().toISOString(),
    }
    saveThought(updated)
    onSave()
  }, [thought, title, summary, editor, onSave])

  // AI 生成概述
  const handleGenerateSummary = useCallback(async () => {
    if (!modelConfig?.apiKey) {
      addToast({ title: '请先配置 API Key', color: 'warning' })
      return
    }
    const text = getPlainText()
    if (!text.trim()) {
      addToast({ title: '内容为空', color: 'warning' })
      return
    }
    setLoading('summarize')
    try {
      const res = await fetch('/api/ai/thought', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, action: 'summarize', modelConfig }),
      })
      if (res.ok) {
        const { title: newTitle, summary: newSummary, error } = await res.json() as { 
          title?: string; summary?: string; error?: string 
        }
        if (error) {
          addToast({ title: error, color: 'danger' })
        } else {
          setTitle(newTitle || title)
          setSummary(newSummary || '')
          addToast({ title: '概述已生成', color: 'success' })
        }
      }
    } catch (err) {
      addToast({ title: err instanceof Error ? err.message : '请求失败', color: 'danger' })
    } finally {
      setLoading(null)
    }
  }, [modelConfig, getPlainText, title])

  // AI 操作
  const handleAIAction = useCallback(async (action: ThoughtAIAction) => {
    if (!modelConfig?.apiKey) {
      addToast({ title: '请先配置 API Key', color: 'warning' })
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
          const lines = result.split('\n').filter(l => l.trim())
          for (const line of lines) {
            editor.insertBlocks(
              [{ type: 'paragraph', content: [{ type: 'text', text: line, styles: {} }] }],
              editor.document[editor.document.length - 1],
              'after'
            )
          }
          addToast({ title: '处理完成', color: 'success' })
        }
      }
    } catch (err) {
      addToast({ title: err instanceof Error ? err.message : '请求失败', color: 'danger' })
    } finally {
      setLoading(null)
    }
  }, [modelConfig, getPlainText, editor])

  return (
    <>
      <ModalHeader style={{ paddingBottom: 8 }}>
        <Input
          value={title}
          onValueChange={setTitle}
          size="lg"
          variant="underlined"
          placeholder="想法标题..."
          style={{ fontWeight: 600 }}
        />
      </ModalHeader>
      <ModalBody style={{ paddingTop: 0 }}>
        {/* AI 工具栏 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 6, 
          marginBottom: 12,
          padding: '6px 10px',
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          flexWrap: 'wrap',
        }}>
          <Tooltip content="生成标题和概述" placement="bottom">
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
          <Divider orientation="vertical" style={{ height: 16 }} />
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

        {/* 概述 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>
            概述
          </label>
          <Textarea
            value={summary}
            onValueChange={setSummary}
            placeholder="AI 生成的概述..."
            minRows={2}
            maxRows={3}
            style={{ fontSize: 13 }}
          />
        </div>

        {/* 编辑器 */}
        <div style={{ 
          border: '1px solid var(--border-color)', 
          borderRadius: 8, 
          minHeight: 200,
          background: 'var(--bg-primary)',
        }}>
          <BlockNoteView editor={editor} onChange={handleSave} theme={blockNoteTheme} />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="light" onPress={() => { handleSave(); onClose(); }}>保存并关闭</Button>
      </ModalFooter>
    </>
  )
}

// 辅助函数
function getContentPreview(content: unknown[]): string {
  if (!content || !Array.isArray(content)) return '点击编辑...'
  const texts = content
    .map(block => getBlockText(block))
    .filter(t => t.trim())
    .join(' ')
    .trim()

  if (!texts) return '点击编辑...'
  return texts.slice(0, 80) + (texts.length > 80 ? '...' : '')
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getInlineText(inline: unknown): string {
  if (!inline) return ''
  if (typeof inline === 'string') return inline
  if (Array.isArray(inline)) return inline.map(getInlineText).join('')
  if (!isRecord(inline)) return ''

  const text = inline.text
  if (typeof text === 'string') return text

  const content = inline.content
  if (Array.isArray(content)) return content.map(getInlineText).join('')

  return ''
}

function getBlockText(block: unknown, depth = 0): string {
  if (!block || depth > 10 || !isRecord(block)) return ''

  const selfText = getInlineText(block.content)
  const children = block.children

  if (!Array.isArray(children)) return selfText

  const childrenText = children
    .map(child => getBlockText(child, depth + 1))
    .filter(t => t.trim())
    .join(' ')

  return [selfText, childrenText].filter(Boolean).join(' ')
}

// 图标
function SparkleIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z" /></svg>
}
function OrganizeIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
}
function RefineIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
}
function ExpandIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
}
