/**
 * Global editor instance store.
 * EditorPage registers its editor here so AssistantChatPanel can access it.
 */
import type { BlockNoteEditor } from '@blocknote/core'

let _editor: BlockNoteEditor<any, any, any> | null = null

export function registerEditor(editor: BlockNoteEditor<any, any, any>) {
  _editor = editor
}

export function unregisterEditor() {
  _editor = null
}

export function getEditor(): BlockNoteEditor<any, any, any> | null {
  return _editor
}
