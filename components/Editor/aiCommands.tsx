import type { BlockNoteEditor } from '@blocknote/core'
import { AIExtension, type AIMenuSuggestionItem, aiDocumentFormats } from '@blocknote/xl-ai'

/** 续写：在光标位置后续写内容（无需选中） */
export function continueWritingItem(
  editor: BlockNoteEditor<any, any, any>
): AIMenuSuggestionItem {
  return {
    key: 'continue_writing',
    title: '续写',
    aliases: ['续写', 'continue', '继续写'],
    onItemClick: async () => {
      await editor.getExtension(AIExtension)?.invokeAI({
        userPrompt: '请根据上文内容，自然流畅地续写后续内容，保持原有风格和语气。',
        useSelection: false,
        streamToolsProvider: aiDocumentFormats.html.getStreamToolsProvider({
          defaultStreamTools: { add: true, delete: false, update: false },
        }),
      })
    },
  }
}

/** 翻译：将选中内容翻译为中文 */
export function translateItem(
  editor: BlockNoteEditor<any, any, any>
): AIMenuSuggestionItem {
  return {
    key: 'translate_to_chinese',
    title: '翻译为中文',
    aliases: ['翻译', 'translate', 'zh', '中文'],
    onItemClick: async () => {
      await editor.getExtension(AIExtension)?.invokeAI({
        userPrompt: '请将选中的文字准确翻译为中文，保持原文含义和格式，只翻译不解释。',
        useSelection: true,
        streamToolsProvider: aiDocumentFormats.html.getStreamToolsProvider({
          defaultStreamTools: { add: false, delete: false, update: true },
        }),
      })
    },
  }
}

/** 润色：对选中内容进行语言润色 */
export function polishItem(
  editor: BlockNoteEditor<any, any, any>
): AIMenuSuggestionItem {
  return {
    key: 'polish',
    title: '润色',
    aliases: ['润色', 'polish', '优化', 'improve', '改写'],
    onItemClick: async () => {
      await editor.getExtension(AIExtension)?.invokeAI({
        userPrompt: '请对选中的文字进行语言润色，使其更加流畅、专业、简洁，保持原意不变。',
        useSelection: true,
        streamToolsProvider: aiDocumentFormats.html.getStreamToolsProvider({
          defaultStreamTools: { add: false, delete: false, update: true },
        }),
      })
    },
  }
}
