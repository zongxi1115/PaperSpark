/**
 * Global editor instance store.
 * EditorPage registers its editor here so AssistantChatPanel can access it.
 */
import type { BlockNoteEditor } from '@blocknote/core'

let _editor: BlockNoteEditor<any, any, any> | null = null

function emitEditorContextEvent() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('editor-instance-updated'))
}

export function registerEditor(editor: BlockNoteEditor<any, any, any>) {
  _editor = editor
  emitEditorContextEvent()
}

export function unregisterEditor() {
  _editor = null
  emitEditorContextEvent()
}

export function getEditor(): BlockNoteEditor<any, any, any> | null {
  return _editor
}

/**
 * 获取编辑器中当前选中的文本
 * 通过浏览器 Selection API 读取，映射回 BlockNote 块结构
 */
export function getSelectedText(): string | null {
  const editor = _editor
  if (!editor) return null

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const selectedText = selection.toString().trim()
  if (!selectedText) return null

  return selectedText
}

/**
 * 获取选中文本及其所在块的上下文信息
 */
export interface SelectionContext {
  text: string
  blockIds: string[]
  blockTexts: string[]
}

export function getSelectionContext(): SelectionContext | null {
  const editor = _editor
  if (!editor) return null

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const selectedText = selection.toString().trim()
  if (!selectedText) return null

  // 找到选区涉及的块
  const range = selection.getRangeAt(0)
  const blockIds: string[] = []
  const blockTexts: string[] = []

  try {
    const blocks = editor.document as Array<{ id: string; content?: unknown }>
    for (const block of blocks) {
      const blockEl = document.querySelector(`[data-id="${block.id}"]`)
      if (!blockEl) continue

      // 检查块是否与选区有交集
      if (range.intersectsNode && range.intersectsNode(blockEl)) {
        blockIds.push(block.id)
        // 提取块文本
        const extractText = (content: unknown): string => {
          if (!content) return ''
          if (typeof content === 'string') return content
          if (Array.isArray(content)) return content.map(extractText).join('')
          if (typeof content !== 'object') return ''
          const r = content as Record<string, unknown>
          if (r.type === 'text') return typeof r.text === 'string' ? r.text : ''
          return extractText(r.content) || extractText(r.text)
        }
        blockTexts.push(extractText(block.content))
      }
    }
  } catch {
    // fallback: just return the text
  }

  return { text: selectedText, blockIds, blockTexts }
}
