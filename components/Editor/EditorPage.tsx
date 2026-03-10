'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useCreateBlockNote,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { zh } from '@blocknote/core/locales'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import type { Block } from '@blocknote/core'
import {
  AIExtension,
  AIMenu,
  AIMenuController,
  AIToolbarButton,
  getAISlashMenuItems,
  getDefaultAIMenuItems,
} from '@blocknote/xl-ai'
import { zh as aiZh } from '@blocknote/xl-ai/locales'
import { DefaultChatTransport } from 'ai'
import { Button, Divider, Tooltip, addToast } from '@heroui/react'
import { TocSidebar } from '@/components/Sidebar/TocSidebar'
import { RightSidebar } from '@/components/Sidebar/RightSidebar'
import { getDocument, saveDocument, setLastDocId, getSettings } from '@/lib/storage'
import type { AppDocument, AppSettings } from '@/lib/types'
import { continueWritingItem, translateItem, polishItem } from './aiCommands'

interface EditorPageProps {
  docId: string
}

function extractTitle(content: Block[]): string {
  if (content.length > 0) {
    const first = content[0] as { type: string; content?: { type: string; text: string }[] }
    if (first.type === 'heading' || first.type === 'paragraph') {
      const text = first.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? ''
      if (text.trim()) return (first.type === 'heading' ? text.trim() : text.trim().slice(0, 40))
    }
  }
  return '无标题文档'
}

function getBlockPlainText(block: Block): string {
  const b = block as { content?: { type: string; text: string }[] }
  return b.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? ''
}

export function EditorPageContent({ docId }: EditorPageProps) {
  const [doc, setDoc] = useState<AppDocument | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  // Load settings synchronously so AIExtension can be configured on first render
  const [settings, setSettings] = useState<AppSettings>(() => getSettings())
  const [correcting, setCorrecting] = useState(false)
  const correctTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCorrectedRef = useRef<string>('')
  // Keep a stable ref to settings for the AI transport body
  const settingsRef = useRef<AppSettings>(settings)

  const editor = useCreateBlockNote({
    dictionary: {
      ...zh,
      ai: aiZh,
      placeholders: {
        ...zh.placeholders,
        emptyDocument: '开始写作，输入 / 快速选择语段类型…',
      },
    },
    extensions: [
      AIExtension({
        transport: new DefaultChatTransport({
          api: '/api/ai/chat',
          body: () => ({ modelConfig: settingsRef.current.largeModel }),
        }),
      }),
    ],
  })

  // Load document on mount
  useEffect(() => {
    
    const loaded = getDocument(docId)
    const loadedSettings = getSettings()
    setSettings(loadedSettings)
    settingsRef.current = loadedSettings

    if (loaded) {
      setDoc(loaded)
      setLastDocId(docId)
      if (loaded.content && (loaded.content as Block[]).length > 0) {
        editor.replaceBlocks(editor.document, loaded.content as Block[])
        setBlocks(editor.document as Block[])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  const handleChange = useCallback(() => {
    const current = editor.document as Block[]
    setBlocks(current)

    if (!doc) return
    const title = extractTitle(current)
    const updated: AppDocument = {
      ...doc,
      title,
      content: current,
      updatedAt: new Date().toISOString(),
    }
    setDoc(updated)
    saveDocument(updated)

    // Auto-correct: debounce 2.5s, only if enabled and API key set
    if (settings.autoCorrect && settings.smallModel.apiKey) {
      if (correctTimeoutRef.current) clearTimeout(correctTimeoutRef.current)

      correctTimeoutRef.current = setTimeout(async () => {
        // Find a changed text block to correct (paragraph only for safety)
        const textBlocks = current.filter(b => b.type === 'paragraph')
        if (textBlocks.length === 0) return

        // Correct the last paragraph that has content
        const target = [...textBlocks].reverse().find(b => getBlockPlainText(b).trim().length > 3)
        if (!target) return

        const text = getBlockPlainText(target)
        if (text === lastCorrectedRef.current) return
        lastCorrectedRef.current = text

        setCorrecting(true)
        try {
          const res = await fetch('/api/ai/correct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, modelConfig: settings.smallModel }),
          })
          if (res.ok) {
            const { corrected } = await res.json() as { corrected: string }
            if (corrected && corrected !== text) {
              editor.updateBlock(target, {
                content: [{ type: 'text', text: corrected, styles: {} }],
              })
              lastCorrectedRef.current = corrected
            }
          }
        } catch { /* silent */ } finally {
          setCorrecting(false)
        }
      }, 2500)
    }
  }, [doc, editor, settings])

  const handleExport = useCallback(async () => {
    if (!doc) return
    const markdown = await editor.blocksToMarkdownLossy(editor.document)
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${doc.title}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [doc, editor])

  const handleManualCorrect = useCallback(async () => {
    if (!settings.smallModel.apiKey) {
      addToast({ title: '请先在设置页配置小参数模型的 API Key', color: 'warning' })
      return
    }
    setCorrecting(true)
    try {
      const allText = editor.document
        .filter(b => b.type === 'paragraph' || b.type === 'heading')
        .map(b => getBlockPlainText(b as Block))
        .filter(t => t.trim().length > 0)
        .join('\n')

      if (!allText.trim()) {
        addToast({ title: '文档内容为空', color: 'default' })
        return
      }

      const res = await fetch('/api/ai/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: allText, modelConfig: settings.smallModel }),
      })
      if (res.ok) {
        const { corrected, error } = await res.json() as { corrected?: string; error?: string }
        if (error) {
          addToast({ title: error, color: 'danger' })
        } else if (corrected) {
          addToast({ title: 'AI 纠错完成', color: 'success' })
          // Apply line-by-line corrections
          const lines = corrected.split('\n').filter(l => l.trim().length > 0)
          const textBlocks = editor.document.filter(b => b.type === 'paragraph' || b.type === 'heading') as Block[]
          textBlocks.forEach((block, i) => {
            if (lines[i] && lines[i] !== getBlockPlainText(block)) {
              editor.updateBlock(block, {
                content: [{ type: 'text', text: lines[i], styles: {} }],
              })
            }
          })
        }
      }
    } catch (err) {
      addToast({ title: err instanceof Error ? err.message : '纠错请求失败', color: 'danger' })
    } finally {
      setCorrecting(false)
    }
  }, [editor, settings])

  if (!doc) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        文档不存在或已删除
      </div>
    )
  }

  return (
    <div style={{ 
      position: 'fixed', 
      top: 52, 
      left: 0, 
      right: 0, 
      bottom: 0, 
      display: 'flex', 
      overflow: 'hidden' 
    }}>
      {/* Left TOC Sidebar - Fixed */}
      <TocSidebar blocks={blocks} docTitle={doc.title} />

      {/* Main editor area - only this part scrolls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar - Fixed */}
        <div style={{
          padding: '8px 20px',
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          <Tooltip content="导出为 Markdown" placement="bottom">
            <Button
              size="sm"
              color="primary"
              variant="solid"
              startContent={<ExportIcon />}
              onPress={handleExport}
            >
              导出 MD
            </Button>
          </Tooltip>

          {settings.autoCorrect && (
            <>
              <Divider orientation="vertical" style={{ height: 20 }} />
              <Tooltip content="使用 AI 对全文进行错别字纠正" placement="bottom">
                <Button
                  size="sm"
                  color="secondary"
                  variant="flat"
                  startContent={<SpellIcon />}
                  isLoading={correcting}
                  onPress={handleManualCorrect}
                >
                  AI 纠错
                </Button>
              </Tooltip>
              {correcting && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>正在纠错…</span>
              )}
            </>
          )}

          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {doc.title}
          </span>
        </div>

        {/* Editor - Only scrollable area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '40px 60px', background: 'var(--bg-primary)' }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            <BlockNoteView
              editor={editor}
              onChange={handleChange}
              theme="light"
              formattingToolbar={false}
              slashMenu={false}
            >
              {/* AI 命令菜单：选中文字弹出或输入 /ai 触发 */}
              <AIMenuController aiMenu={() => (
                <AIMenu
                  items={(ed, status) => {
                    if (status !== 'user-input') return getDefaultAIMenuItems(ed, status)
                    return ed.getSelection()
                      ? [...getDefaultAIMenuItems(ed, status), translateItem(ed), polishItem(ed)]
                      : [...getDefaultAIMenuItems(ed, status), continueWritingItem(ed)]
                  }}
                />
              )} />

              {/* 带 AI 按钮的格式化工具栏 */}
              <FormattingToolbarController
                formattingToolbar={() => (
                  <FormattingToolbar>
                    {getFormattingToolbarItems()}
                    <AIToolbarButton />
                  </FormattingToolbar>
                )}
              />

              {/* 带 AI 选项的斜杠菜单 */}
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query) =>
                  filterSuggestionItems(
                    [...getDefaultReactSlashMenuItems(editor), ...getAISlashMenuItems(editor)],
                    query
                  )
                }
              />
            </BlockNoteView>
          </div>
        </div>
      </div>

      {/* Right Icon Sidebar - Fixed */}
      <RightSidebar />
    </div>
  )
}

function ExportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7,10 12,15 17,10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function SpellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}
