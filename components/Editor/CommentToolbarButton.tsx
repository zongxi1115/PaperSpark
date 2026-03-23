'use client'
import { useComponentsContext, useSelectedBlocks } from '@blocknote/react'
import { addToast } from '@heroui/react'

/**
 * Formatting Toolbar 按钮：将选中文本添加评论
 * 选中文字后在浮动工具栏中点击，弹出评论输入浮层
 */
export function CommentToolbarButton() {
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

    // 查找选中文本所在的块
    let blockId: string | undefined
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()
      const blockElement = range.startContainer.parentElement?.closest('[data-id]')
      let startOffset: number | undefined
      let endOffset: number | undefined
      if (blockElement) {
        blockId = blockElement.getAttribute('data-id') || undefined
        try {
          const blockRange = document.createRange()
          blockRange.selectNodeContents(blockElement)

          const startRange = blockRange.cloneRange()
          startRange.setEnd(range.startContainer, range.startOffset)
          startOffset = startRange.toString().length

          if (blockElement.contains(range.endContainer)) {
            const endRange = blockRange.cloneRange()
            endRange.setEnd(range.endContainer, range.endOffset)
            endOffset = endRange.toString().length
          }
        } catch {
          startOffset = undefined
          endOffset = undefined
        }
      }

      // 通过自定义事件触发评论浮层
      window.dispatchEvent(new CustomEvent('editor-comment', { 
        detail: { 
          text, 
          blockId,
          startOffset,
          endOffset,
          position: {
            top: rect.bottom + 8,
            left: Math.min(rect.left, window.innerWidth - 320),
          }
        } 
      }))
    }
  }

  return (
    <Components.FormattingToolbar.Button
      mainTooltip="添加评论"
      onClick={handleClick}
    >
      <CommentIcon />
    </Components.FormattingToolbar.Button>
  )
}

function CommentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}
