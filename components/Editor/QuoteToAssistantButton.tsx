'use client'
import { useBlockNoteEditor, useComponentsContext, useSelectedBlocks } from '@blocknote/react'
import { addToast } from '@heroui/react'

/**
 * Formatting Toolbar 按钮：将选中文本发送到 AI 助手面板
 * 选中文字后在浮动工具栏中点击，即可引用到助手输入框
 */
export function QuoteToAssistantButton() {
  const editor = useBlockNoteEditor()
  const Components = useComponentsContext()!

  // 仅在有 inline content 的块被选中时显示
  const blocks = useSelectedBlocks()
  const hasInlineContent = blocks.some((block) => (block as any).content !== undefined)
  if (!hasInlineContent) {
    return null
  }

  const handleClick = () => {
    // 从编辑器选区获取文本
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) {
      addToast({ title: '请先选中文本', color: 'warning' })
      return
    }

    const text = selection.toString().trim()
    if (!text) {
      addToast({ title: '请先选中文本', color: 'warning' })
      return
    }

    // 通过自定义事件发送到助手面板
    window.dispatchEvent(new CustomEvent('assistant-quote', { detail: { text } }))
    addToast({ title: '已引用到助手', color: 'success' })
  }

  return (
    <Components.FormattingToolbar.Button
      mainTooltip="引用到助手"
      secondaryTooltip="将选中文本发送到 AI 助手面板"
      onClick={handleClick}
    >
      <QuoteIcon />
    </Components.FormattingToolbar.Button>
  )
}

function QuoteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/>
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>
    </svg>
  )
}
