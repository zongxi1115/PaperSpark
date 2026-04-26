'use client'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  useCreateBlockNote,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  SideMenuController,
  SideMenu,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { CustomDragHandleMenu } from './CustomDragHandleMenu'
import { BlockNoteView } from '@blocknote/mantine'
import { zh } from '@blocknote/core/locales'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from '@blocknote/core'
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
import { Button, Divider, Tooltip, addToast, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure } from '@heroui/react'
import { TocSidebar } from '@/components/Sidebar/TocSidebar'
import { RightSidebar } from '@/components/Sidebar/RightSidebar'
import { getDocument, saveDocument, setLastDocId, getSettings, getSelectedSmallModel, getSelectedLargeModel, getKnowledgeItem, getKnowledgeItems, saveDocumentVersion, calculateWordCount, addComment } from '@/lib/storage'
import type { AppDocument, AppSettings, ArticleAuthor, DocumentVersion } from '@/lib/types'
import { extractInlineText } from '@/lib/agentDocument'
import { removeCommentThreadMarks } from '@/lib/commentStyles'
import { VersionHistoryPanel } from './VersionHistoryPanel'
import { continueWritingItem, translateItem, polishItem } from './aiCommands'
import { FormulaInlineContentSpec } from './InlineFormula'
import { FormulaInputExtension } from '@/lib/formulaInputExtension'
import { CitationInlineContentSpec, CitationData, dispatchCitationInsert } from './CitationBlock'
import { COMMENT_THREAD_STYLE_TYPE, CommentThreadStyleSpec } from './CommentThreadStyle'
import { getThemeById, buildBlockNoteTheme, injectGoogleFont } from '@/lib/editorThemes'
import { registerEditor, unregisterEditor } from '@/lib/editorContext'
import { exportToLatex, type LatexExportLanguage } from '@/lib/latexExporter'
import { insertMarkdownBlocksAtCursor, looksLikeMarkdownContent } from '@/lib/blocknoteMarkdown'
import { useThemeContext } from '@/components/Providers'
import { CanvasBlockSpec } from './CanvasBlock'
import { QuoteToAssistantButton } from './QuoteToAssistantButton'
import { CommentToolbarButton } from './CommentToolbarButton'
import { useIsMobile } from '@/lib/useIsMobile'
import useClickOutside from '@/hooks/useClickOutside'
import { DocumentIssueHighlighter } from '@/components/Assistant/tools/DocumentIssueHighlighter'

// 自定义 Schema：包含行内公式和引用
const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    canvas: CanvasBlockSpec,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    formula: FormulaInlineContentSpec,
    citation: CitationInlineContentSpec,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    commentThread: CommentThreadStyleSpec,
  },
})

interface EditorPageProps {
  docId: string
}

const CONTEXT_WINDOW = 1500 // 上下文窗口大小
const AUTO_COMPLETE_DELAY = 5000 // 5秒无输入后触发补全
const AUTHOR_CARD_LAYOUT_ID = 'editor-author-card'

type SlashMenuItem = DefaultReactSuggestionItem & {
  icon?: ReactNode
}

function buildItemSearchText(item: DefaultReactSuggestionItem): string {
  return [item.title, ...(item.aliases ?? [])].join(' ').toLowerCase()
}

function isHeadingItem(item: DefaultReactSuggestionItem): boolean {
  const text = buildItemSearchText(item)
  return /heading|标题/.test(text)
}

function isHeading3Item(item: DefaultReactSuggestionItem): boolean {
  const text = buildItemSearchText(item)
  return /(heading\s*3|h3|三级标题|标题\s*3)/.test(text)
}

function isCollapsibleHeadingItem(item: DefaultReactSuggestionItem): boolean {
  const text = buildItemSearchText(item)
  return /(toggle\s*heading|collapsible|collapse|可折叠|折叠标题|切换标题)/.test(text)
}

function isEmojiItem(item: DefaultReactSuggestionItem): boolean {
  const text = buildItemSearchText(item)
  return /(emoji|表情)/.test(text)
}

function isTableItem(item: DefaultReactSuggestionItem): boolean {
  const text = buildItemSearchText(item)
  return /(table|表格)/.test(text)
}

function isImageItem(item: DefaultReactSuggestionItem): boolean {
  const text = buildItemSearchText(item)
  return /(image|图片)/.test(text)
}

function getPinyinInitialAliases(item: DefaultReactSuggestionItem): string[] {
  const text = buildItemSearchText(item)
  const aliases = new Set<string>()

  const mapping: Array<{ pattern: RegExp; pinyin: string[] }> = [
    { pattern: /(paragraph|段落|正文)/, pinyin: ['dl'] },
    { pattern: /(bullet\s*list|unordered|无序列表)/, pinyin: ['wxlb'] },
    { pattern: /(numbered\s*list|ordered|有序列表)/, pinyin: ['yxlb'] },
    { pattern: /(check\s*list|todo|待办列表|任务列表)/, pinyin: ['dblb'] },
    { pattern: /(quote|blockquote|引用|引述)/, pinyin: ['yy'] },
    { pattern: /(code\s*block|代码块|代码)/, pinyin: ['dmk'] },
    { pattern: /(table|表格)/, pinyin: ['bg'] },
    { pattern: /(image|图片)/, pinyin: ['tp'] },
    { pattern: /(video|视频)/, pinyin: ['sp'] },
    { pattern: /(file|文件)/, pinyin: ['wj'] },
    { pattern: /(audio|音频)/, pinyin: ['yp'] },
    { pattern: /(divider|separator|分割线|分隔线)/, pinyin: ['fgx'] },
    { pattern: /(callout|提示|告警)/, pinyin: ['ts'] },
    { pattern: /(equation|formula|math|latex|公式)/, pinyin: ['gs'] },
  ]

  mapping.forEach(({ pattern, pinyin }) => {
    if (pattern.test(text)) {
      pinyin.forEach((alias) => aliases.add(alias))
    }
  })

  return Array.from(aliases)
}

function withPinyinAliases(item: SlashMenuItem): SlashMenuItem {
  if (isHeadingItem(item)) return item

  const pinyinAliases = getPinyinInitialAliases(item)
  if (pinyinAliases.length === 0) return item

  const mergedAliases = Array.from(new Set([...(item.aliases ?? []), ...pinyinAliases]))
  return { ...item, aliases: mergedAliases }
}

function withMenuGroup(item: SlashMenuItem, group: string): SlashMenuItem {
  return { ...item, group }
}

function extractTitle(content: Block[], articleTitle?: string): string {
  // 优先使用文章标题
  if (articleTitle?.trim()) {
    return articleTitle.trim()
  }
  // 回退：从正文第一个块提取
  if (content.length > 0) {
    const first = content[0] as { type: string; content?: { type: string; text: string }[] }
    if (first.type === 'heading' || first.type === 'paragraph') {
      const text = extractInlineText(first.content)
      if (text.trim()) return (first.type === 'heading' ? text.trim() : text.trim().slice(0, 40))
    }
  }
  return '无标题文档'
}

function getBlockPlainText(block: Block): string {
  const b = block as { content?: unknown }
  return extractInlineText(b.content)
}

function getAuthorChipLabel(authors: ArticleAuthor[]): string {
  if (authors.length === 0) return '添加作者'
  if (authors.length <= 2) return authors.map(author => author.name).join(', ')
  return `${authors[0]?.name}、${authors[1]?.name} 等 ${authors.length} 位作者`
}

function sanitizeInlineContent(content: unknown): unknown[] {
  if (!Array.isArray(content)) return []
  return content.filter((item) => {
    if (!item || typeof item !== 'object') return false
    const type = (item as { type?: unknown }).type
    return typeof type === 'string' && type.length > 0
  })
}

function sanitizeTableContent(content: unknown): unknown {
  if (!content || typeof content !== 'object') return content

  const tableContent = content as {
    type?: unknown
    columnWidths?: unknown
    rows?: unknown[]
  }

  if (tableContent.type !== 'tableContent' || !Array.isArray(tableContent.rows)) {
    return content
  }

  return {
    ...tableContent,
    columnWidths: Array.isArray(tableContent.columnWidths) ? tableContent.columnWidths : [],
    rows: tableContent.rows
      .filter((row) => row && typeof row === 'object')
      .map((row) => {
        const tableRow = row as { cells?: unknown[] }
        return {
          ...tableRow,
          cells: Array.isArray(tableRow.cells)
            ? tableRow.cells
                .filter((cell) => cell && typeof cell === 'object')
                .map((cell) => {
                  const tableCell = cell as Record<string, unknown>
                  return {
                    ...tableCell,
                    content: sanitizeInlineContent(tableCell.content),
                  }
                })
            : [],
        }
      }),
  }
}

function sanitizeBlockTree(content: unknown): Block[] {
  if (!Array.isArray(content)) return []

  const sanitizeNode = (node: unknown): Block | null => {
    if (!node || typeof node !== 'object') return null

    const block = node as Record<string, unknown>
    const type = block.type
    if (typeof type !== 'string' || type.length === 0) return null

    const sanitized: Record<string, unknown> = { ...block }

    if ('content' in sanitized) {
      sanitized.content = Array.isArray(sanitized.content)
        ? sanitizeInlineContent(sanitized.content)
        : sanitizeTableContent(sanitized.content)
    }

    if (Array.isArray(sanitized.children)) {
      sanitized.children = sanitized.children
        .map((child) => sanitizeNode(child))
        .filter((child): child is Block => child !== null)
    }

    return sanitized as unknown as Block
  }

  return content
    .map((node) => sanitizeNode(node))
    .filter((node): node is Block => node !== null)
}

function stripCommentThreadStyleFromInlineContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content

  return content.map((item) => {
    if (!item || typeof item !== 'object') return item

    const node = item as Record<string, unknown>
    const nextNode: Record<string, unknown> = { ...node }

    if (node.styles && typeof node.styles === 'object') {
      const nextStyles = { ...(node.styles as Record<string, unknown>) }
      delete nextStyles[COMMENT_THREAD_STYLE_TYPE]
      nextNode.styles = nextStyles
    }

    if (Array.isArray(node.content)) {
      nextNode.content = stripCommentThreadStyleFromInlineContent(node.content)
    }

    return nextNode
  })
}

function normalizeBlockForCommentDiff(block: Block): unknown {
  const current = block as Record<string, unknown>
  return {
    ...current,
    content: stripCommentThreadStyleFromInlineContent(current.content),
    children: Array.isArray(current.children)
      ? (current.children as Block[]).map((child) => normalizeBlockForCommentDiff(child))
      : current.children,
  }
}

function isCommentThreadOnlyUpdate(block: Block, prevBlock: Block): boolean {
  return JSON.stringify(normalizeBlockForCommentDiff(block)) === JSON.stringify(normalizeBlockForCommentDiff(prevBlock))
}

function replaceBlocksInTree(blocks: Block[], updatesById: Map<string, Block>): Block[] {
  return blocks.map((block) => {
    const replacement = updatesById.get(block.id)
    if (replacement) {
      return replacement
    }

    if (block.children.length === 0) {
      return block
    }

    return {
      ...block,
      children: replaceBlocksInTree(block.children, updatesById),
    }
  })
}

function hasCitationInlineContent(content: unknown): boolean {
  if (Array.isArray(content)) {
    return content.some((item) => hasCitationInlineContent(item))
  }

  if (!content || typeof content !== 'object') return false
  const node = content as Record<string, unknown>

  if (node.type === 'citation') return true
  if (Array.isArray(node.content)) return hasCitationInlineContent(node.content)
  return false
}

function isHeadingRelatedChange(change: { block: Block; prevBlock?: Block }): boolean {
  return change.block.type === 'heading' || change.prevBlock?.type === 'heading'
}

function isCitationRelatedChange(change: { block: Block; prevBlock?: Block }): boolean {
  return hasCitationInlineContent((change.block as { content?: unknown }).content)
    || hasCitationInlineContent((change.prevBlock as { content?: unknown } | undefined)?.content)
}

function getSafeCurrentDocumentBlocks(editor: ReturnType<typeof useCreateBlockNote>): Block[] {
  return (editor.document as Array<Block | null | undefined>).filter((b): b is Block => Boolean(b))
}

function getBlockDebugLabel(block: Block, index: number): string {
  const text = getBlockPlainText(block).trim()
  const preview = text ? `: ${text.slice(0, 30)}` : ''
  return `#${index + 1} <${block.type}>${preview}`
}

function applyCompatibleBlockContent(
  editor: ReturnType<typeof useCreateBlockNote>,
  content: Block[],
  warningTitle: string,
): { appliedContent: Block[]; skippedCount: number } {
  if (content.length === 0) {
    return { appliedContent: [], skippedCount: 0 }
  }

  try {
    editor.replaceBlocks(getSafeCurrentDocumentBlocks(editor), content)
    return { appliedContent: content, skippedCount: 0 }
  } catch (error) {
    console.error('Block content batch load failed, attempting compatible fallback.', error)
  }

  const appliedContent: Block[] = []
  let skippedCount = 0

  content.forEach((block, index) => {
    try {
      if (appliedContent.length === 0) {
        editor.replaceBlocks(getSafeCurrentDocumentBlocks(editor), [block])
      } else {
        const currentBlocks = getSafeCurrentDocumentBlocks(editor)
        const anchorBlock = currentBlocks[currentBlocks.length - 1]
        if (!anchorBlock) {
          throw new Error('missing anchor block during fallback load')
        }
        editor.insertBlocks([block], anchorBlock, 'after')
      }
      appliedContent.push(block)
    } catch (error) {
      skippedCount += 1
      console.warn(`Skipped incompatible block ${getBlockDebugLabel(block, index)}`, error, block)
    }
  })

  if (skippedCount > 0) {
    addToast({ title: `${warningTitle}，已跳过 ${skippedCount} 个不兼容块`, color: 'warning' })
  }

  return { appliedContent, skippedCount }
}

/**
 * 获取光标位置周围的上下文文本
 * 使用 BlockNote 内置 API 获取光标位置，避免 DOM 遍历
 * 返回 { context: 带有 | 标记光标位置的文本, cursorGlobalPos: 全局光标位置 }
 */
function getContextAroundCursor(editor: ReturnType<typeof useCreateBlockNote>, windowSize: number = CONTEXT_WINDOW): { context: string; cursorGlobalPos: number } | null {
  // 用 BlockNote API 获取当前光标所在块
  let cursorBlock: Block
  let cursorLocalOffset = 0
  try {
    const pos = editor.getTextCursorPosition()
    cursorBlock = pos.block
    // 估算光标在块内文本中的偏移量：用 DOM 辅助
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      const blockEl = document.querySelector(`[data-id="${cursorBlock.id}"]`)
      if (blockEl) {
        const r = document.createRange()
        r.selectNodeContents(blockEl)
        r.setEnd(range.startContainer, range.startOffset)
        cursorLocalOffset = r.toString().length
      }
    }
  } catch {
    return null
  }

  // 遍历文档中所有块，为有文本内容的块构建位置映射
  const allBlocks = (editor.document as Block[]).filter((b): b is Block => Boolean(b))
  if (allBlocks.length === 0) return null

  let fullText = ''
  const blockMap: { block: Block; start: number; end: number; text: string }[] = []
  let cursorBlockIdx = -1

  for (let i = 0; i < allBlocks.length; i++) {
    const block = allBlocks[i]
    const text = getBlockPlainText(block)
    const start = fullText.length
    fullText += text + '\n'
    blockMap.push({ block, start, end: fullText.length, text })
    if (block.id === cursorBlock.id) {
      cursorBlockIdx = i
    }
  }

  if (cursorBlockIdx < 0) return null

  const cursorInfo = blockMap[cursorBlockIdx]
  const cursorGlobalPos = cursorInfo.start + Math.min(cursorLocalOffset, cursorInfo.text.length)
  const isAtBlockEnd = cursorLocalOffset >= cursorInfo.text.trimEnd().length

  // 左边 1/3, 右边 2/3
  const leftWindow = Math.floor(windowSize / 3)
  const rightWindow = windowSize - leftWindow

  let contextStart = Math.max(0, cursorGlobalPos - leftWindow)
  let contextEnd = Math.min(fullText.length, cursorGlobalPos + rightWindow)

  // 光标在块末尾且右边几乎没文本 → 把后续块内容也纳入
  if (isAtBlockEnd) {
    const rightText = fullText.slice(cursorGlobalPos, contextEnd).replace(/^\n+/, '').trim()
    if (rightText.length < 20 && cursorBlockIdx < allBlocks.length - 1) {
      const nextInfo = blockMap[cursorBlockIdx + 1]
      contextEnd = Math.min(fullText.length, nextInfo.start + nextInfo.text.length + 1)
    }
  }

  const contextText = fullText.slice(contextStart, contextEnd)
  const cursorOffset = cursorGlobalPos - contextStart
  const contextWithCursor = contextText.slice(0, cursorOffset) + '|' + contextText.slice(cursorOffset)

  return { context: contextWithCursor, cursorGlobalPos }
}

export function EditorPageContent({ docId }: EditorPageProps) {
  const [doc, setDoc] = useState<AppDocument | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [settings, setSettings] = useState<AppSettings>(() => getSettings())
  const [correcting, setCorrecting] = useState(false)
  const [ghostText, setGhostText] = useState<string | null>(null) // ghost text 内容
  const [ghostPosition, setGhostPosition] = useState<{ top: number; left: number } | null>(null)
  const [ghostVisible, setGhostVisible] = useState(false) // 用于控制 opacity 动画
  const lastCursorPositionRef = useRef<{ top: number; left: number } | null>(null) // 记录上次光标位置
  const [citations, setCitations] = useState<Map<string, CitationData>>(new Map()) // 引用列表
  const { isDark, mounted: themeMounted } = useThemeContext()
  const isMobile = useIsMobile()
  const [mobileTocOpen, setMobileTocOpen] = useState(false)

  // 选中文本评论相关状态
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [pendingCommentThreadId, setPendingCommentThreadId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | undefined>(undefined)
  const [selectedCommentStartOffset, setSelectedCommentStartOffset] = useState<number | undefined>(undefined)
  const [selectedCommentEndOffset, setSelectedCommentEndOffset] = useState<number | undefined>(undefined)
  const [commentModalPosition, setCommentModalPosition] = useState<{ top: number; left: number } | null>(null)
  const [commentContent, setCommentContent] = useState('')

  // 文章元数据状态
  const [articleTitle, setArticleTitle] = useState('')
  const [articleAuthors, setArticleAuthors] = useState<ArticleAuthor[]>([])
  const [articleAbstract, setArticleAbstract] = useState('')
  const [articleKeywords, setArticleKeywords] = useState<string[]>([])
  const [articleDate, setArticleDate] = useState(() => new Date().toISOString().split('T')[0])

  // 作者编辑弹窗
  const { isOpen: isLatexModalOpen, onOpen: onLatexModalOpen, onClose: onLatexModalClose } = useDisclosure()
  const [editingAuthor, setEditingAuthor] = useState<ArticleAuthor | null>(null)
  const [authorForm, setAuthorForm] = useState({ name: '', affiliation: '', email: '' })
  const [isAuthorPopoverOpen, setIsAuthorPopoverOpen] = useState(false)
  const [latexLanguage, setLatexLanguage] = useState<Exclude<LatexExportLanguage, 'auto'>>('zh')
  const authorPopoverRef = useRef<HTMLDivElement>(null)

  // 当前主题配置，动态更新
  const activeThemeConfig = getThemeById(settings.editorThemeId ?? 'default')
  const themes = buildBlockNoteTheme(activeThemeConfig)
  // 根据当前主题状态选择对应的 Theme 对象
  const activeTheme = isDark ? themes.dark : themes.light
  
  const correctTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completeAbortRef = useRef<AbortController | null>(null)
  const commentOnlySaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorFocusedRef = useRef(true)
  const lastCorrectedRef = useRef<string>('')
  const settingsRef = useRef<AppSettings>(settings)
  const docRef = useRef<AppDocument | null>(null)
  const ghostTextRef = useRef<string | null>(null) // 用于 Tab 键处理
  const citationsRef = useRef<Map<string, CitationData>>(new Map()) // 用于事件处理中获取最新引用

  const MAX_PASTE_UPLOAD_BYTES = 50 * 1024 * 1024

  const syncSettingsFromStorage = useCallback(() => {
    const latestSettings = getSettings()
    settingsRef.current = latestSettings
    setSettings(latestSettings)
  }, [])

  const editor = useCreateBlockNote({
    schema,
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
          body: () => ({ modelConfig: getSelectedLargeModel(settingsRef.current) }),
        }),
      }),
      FormulaInputExtension(),
    ],
    // 粘贴处理器：统一走 Markdown -> BlockNote 转换，支持公式、表格等复杂结构
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const clipboardData = event.clipboardData
      if (!clipboardData) {
        return defaultPasteHandler()
      }

      const markdownText = clipboardData.getData('text/markdown')
      const plainText = markdownText || clipboardData.getData('text/plain')
      const hasMarkdownMime = Array.from(clipboardData.types || []).includes('text/markdown')

      if (plainText && (hasMarkdownMime || looksLikeMarkdownContent(plainText))) {
        try {
          return insertMarkdownBlocksAtCursor(editor as any, plainText)
        } catch (error) {
          console.warn('Custom markdown paste failed, falling back to default handler.', error)
        }
      }
      
      // 默认处理
      return defaultPasteHandler({ prioritizeMarkdownOverHTML: true })
    },
    uploadFile: async (file) => {
      try {
        if (file.size > MAX_PASTE_UPLOAD_BYTES) {
          addToast({ title: `文件过大（>${Math.round(MAX_PASTE_UPLOAD_BYTES / 1024 / 1024)}MB），无法粘贴上传`, color: 'danger' })
          throw new Error('file too large')
        }

        const { storeFile } = await import('@/lib/localFiles')
        const stored = await storeFile(file)
        return stored.url
      } catch (e) {
        console.error('uploadFile failed:', e)
        addToast({ title: '文件粘贴上传失败', color: 'danger' })
        throw e
      }
    },
    resolveFileUrl: async (url) => {
      const { resolveLocalFileUrl } = await import('@/lib/localFiles')
      return await resolveLocalFileUrl(url)
    },
  })

  const buildCitationSuggestionItems = useCallback(() => {
    const items = getKnowledgeItems()
    return items.map((item) => {
      const abstract = item.abstract || item.cachedSummary || ''
      const authors = item.authors?.length ? item.authors.slice(0, 2).join(', ') + (item.authors.length > 2 ? ' 等' : '') : ''
      const year = item.year ? String(item.year) : ''
      const meta = [authors, year].filter(Boolean).join(' · ')
      const subtextBase = abstract.trim() || meta || item.journal || item.doi || ''
      const subtext = subtextBase.length > 120 ? subtextBase.slice(0, 120) + '…' : subtextBase

      return {
        title: item.title || '（无标题）',
        subtext,
        group: '引用文献',
        aliases: [item.title, item.doi, item.journal, ...item.authors].filter(Boolean) as string[],
        icon: <CitationIcon />,
        onItemClick: () => {
          dispatchCitationInsert({
            id: item.id,
            title: item.title,
            authors: item.authors,
            year: item.year,
            journal: item.journal,
            doi: item.doi,
            url: item.url,
            bib: item.bib,
          })
        },
      }
    })
  }, [])

  // 注册编辑器实例供助手工具使用
  useEffect(() => {
    registerEditor(editor)
    return () => unregisterEditor()
  }, [editor])

  // 同步 ghostTextRef
  useEffect(() => {
    ghostTextRef.current = ghostText
  }, [ghostText])

  useEffect(() => {
    docRef.current = doc
  }, [doc])

  // 同步 citationsRef
  useEffect(() => {
    citationsRef.current = citations
  }, [citations])

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('editor-content-updated'))
    })

    return () => cancelAnimationFrame(frameId)
  }, [docId, blocks.length])

  // 监听引用插入事件
  useEffect(() => {
    const handleCitationInsert = (e: CustomEvent<CitationData>) => {
      const data = e.detail
      const citationId = data.citationId
      
      // 获取当前引用列表
      const currentCitations = new Map(citationsRef.current)
      
      // 如果引用已存在，使用已有索引
      let index: number
      if (currentCitations.has(citationId)) {
        index = currentCitations.get(citationId)!.index
      } else {
        // 新引用，分配新索引
        index = currentCitations.size + 1
        currentCitations.set(citationId, { ...data, index })
        setCitations(currentCitations)
      }
      
      // 在光标位置插入行内引用
      editor.insertInlineContent([
        {
          type: 'citation',
          props: {
            citationId,
            citationIndex: index,
          },
        },
      ])
      addToast({ title: `已插入引用 [${index}]`, color: 'success' })
    }

    window.addEventListener('citation-insert', handleCitationInsert as EventListener)
    return () => window.removeEventListener('citation-insert', handleCitationInsert as EventListener)
  }, [editor])

  // Tab 键监听：接受补全（使用 capture 阶段，先于编辑器处理）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && ghostTextRef.current) {
        e.preventDefault()
        e.stopPropagation()
        // 在光标位置插入补全内容
        const selection = window.getSelection()
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0)
          const textNode = document.createTextNode(ghostTextRef.current)
          range.insertNode(textNode)
          // 移动光标到插入文本之后
          range.setStartAfter(textNode)
          range.collapse(true)
          selection.removeAllRanges()
          selection.addRange(range)
        }
        setGhostVisible(false)
        setTimeout(() => {
          setGhostText(null)
          setGhostPosition(null)
        }, 150)
      } else if (e.key !== 'Tab' && ghostTextRef.current) {
        // 任意其他键清除 ghost text
        setGhostVisible(false)
        setTimeout(() => {
          setGhostText(null)
          setGhostPosition(null)
        }, 150)
      }
    }
    
    // 编辑器失去焦点时隐藏提示并取消补全请求
    const handleBlur = () => {
      editorFocusedRef.current = false
      cancelAutoComplete()
      if (ghostTextRef.current) {
        setGhostVisible(false)
        setTimeout(() => {
          setGhostText(null)
          setGhostPosition(null)
        }, 150)
      }
    }

    // 编辑器获得焦点时恢复状态
    const handleFocusIn = () => {
      editorFocusedRef.current = true
    }

    // 检测光标位置变化
    const handleSelectionChange = () => {
      if (!ghostTextRef.current || !lastCursorPositionRef.current) return
      
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        const currentPosition = { top: rect.bottom + 2, left: rect.left }
        
        // 如果光标位置变化超过阈值，隐藏提示
        const lastPos = lastCursorPositionRef.current
        const threshold = 5
        if (Math.abs(currentPosition.top - lastPos.top) > threshold || 
            Math.abs(currentPosition.left - lastPos.left) > threshold) {
          setGhostVisible(false)
          setTimeout(() => {
            setGhostText(null)
            setGhostPosition(null)
          }, 150)
        }
      }
    }
    
    document.addEventListener('keydown', handleKeyDown, { capture: true })
    document.addEventListener('selectionchange', handleSelectionChange)
    
    // 监听编辑器容器失去焦点
    const editorElement = document.querySelector('.bn-editor')
    editorElement?.addEventListener('blur', handleBlur, true)
    editorElement?.addEventListener('focusin', handleFocusIn)
    
    // 监听评论工具栏按钮事件
    const handleEditorComment = (e: CustomEvent<{ threadId: string; text: string; blockId?: string; startOffset?: number; endOffset?: number; position: { top: number; left: number } }>) => {
      const { threadId, text, blockId, startOffset, endOffset, position } = e.detail
      setPendingCommentThreadId(threadId)
      setSelectedText(text)
      setSelectedBlockId(blockId)
      setSelectedCommentStartOffset(startOffset)
      setSelectedCommentEndOffset(endOffset)
      setCommentModalPosition(position)
      setCommentContent('')
    }
    window.addEventListener('editor-comment', handleEditorComment as EventListener)
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true })
      document.removeEventListener('selectionchange', handleSelectionChange)
      window.removeEventListener('editor-comment', handleEditorComment as EventListener)
      editorElement?.removeEventListener('blur', handleBlur, true)
      editorElement?.removeEventListener('focusin', handleFocusIn)
    }
  }, [])

  // Load document on mount
  useEffect(() => {
    const loaded = getDocument(docId)
    const loadedSettings = getSettings()
    setSettings(loadedSettings)
    settingsRef.current = loadedSettings
    // 注入当前主题字体
    const themeConfig = getThemeById(loadedSettings.editorThemeId ?? 'default')
    if (themeConfig.googleFontUrl) injectGoogleFont(themeConfig.googleFontUrl)

    if (loaded) {
      setDoc(loaded)
      setLastDocId(docId)
      const safeLoadedContent = sanitizeBlockTree(loaded.content)
      if (safeLoadedContent.length > 0) {
        const { appliedContent } = applyCompatibleBlockContent(editor, safeLoadedContent, '文档包含兼容性内容')
        setBlocks(appliedContent)
        
        // 提取已有的引用（从行内内容中）
        const extractedCitations = new Map<string, CitationData>()
        const content = appliedContent
        
        // 遍历所有块的内容，查找引用
        content.forEach(block => {
          const blockContent = (block as any).content
          if (Array.isArray(blockContent)) {
            blockContent.forEach((inlineContent: any) => {
              if (inlineContent.type === 'citation') {
                const citationId = inlineContent.props?.citationId
                const index = inlineContent.props?.citationIndex || 1
                if (citationId && !extractedCitations.has(citationId)) {
                  // 从知识库获取引用信息
                  const item = getKnowledgeItem(citationId)
                  if (item) {
                    extractedCitations.set(citationId, {
                      citationId,
                      index,
                      title: item.title,
                      authors: item.authors,
                      year: item.year || '',
                      journal: item.journal || '',
                      doi: item.doi || '',
                      url: item.url || '',
                      bib: item.bib || '',
                    })
                  }
                }
              }
            })
          }
        })
        setCitations(extractedCitations)
      }
      // 加载文章元数据
      if (loaded.articleTitle) setArticleTitle(loaded.articleTitle)
      if (loaded.articleAuthors) setArticleAuthors(loaded.articleAuthors)
      if (loaded.articleAbstract) setArticleAbstract(loaded.articleAbstract)
      if (loaded.articleKeywords) setArticleKeywords(loaded.articleKeywords)
      if (loaded.articleDate) setArticleDate(loaded.articleDate)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  useEffect(() => {
    if (activeThemeConfig.googleFontUrl) {
      injectGoogleFont(activeThemeConfig.googleFontUrl)
    }
  }, [activeThemeConfig.googleFontUrl])

  // 动态注入标题字体大小样式
  useEffect(() => {
    const headingFontSizes = settings.headingFontSizes
    if (!headingFontSizes) return

    const styleId = 'heading-font-sizes-override'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    styleEl.textContent = `
      .bn-block-content[data-content-type="heading"][data-level="1"] {
        font-size: ${headingFontSizes.h1}px !important;
      }
      .bn-block-content[data-content-type="heading"][data-level="2"] {
        font-size: ${headingFontSizes.h2}px !important;
      }
      .bn-block-content[data-content-type="heading"][data-level="3"] {
        font-size: ${headingFontSizes.h3}px !important;
      }
    `

    return () => {
      styleEl.remove()
    }
  }, [settings.headingFontSizes])

  useEffect(() => {
    const handleFocus = () => syncSettingsFromStorage()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncSettingsFromStorage()
      }
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [syncSettingsFromStorage])

  useEffect(() => {
    return () => {
      if (commentOnlySaveTimeoutRef.current) {
        clearTimeout(commentOnlySaveTimeoutRef.current)
      }
      if (contentSaveTimeoutRef.current) {
        clearTimeout(contentSaveTimeoutRef.current)
        const pendingDoc = docRef.current
        if (pendingDoc) {
          saveDocument(pendingDoc)
        }
      }
    }
  }, [])

  // 保存文章元数据
  const saveArticleMetadata = useCallback(() => {
    if (!doc) return
    const updated: AppDocument = {
      ...doc,
      title: articleTitle.trim() || extractTitle(editor.document as Block[], articleTitle),
      articleTitle,
      articleAuthors,
      articleAbstract,
      articleKeywords,
      articleDate,
      updatedAt: new Date().toISOString(),
    }
    setDoc(updated)
    saveDocument(updated)
  }, [doc, articleTitle, articleAuthors, articleAbstract, articleKeywords, articleDate, editor])

  // 版本控制：保存版本快照
  const handleSaveVersion = useCallback(async (title: string) => {
    if (!doc) return
    const currentBlocks = editor.document as Block[]
    const version: DocumentVersion = {
      id: `version-${Date.now()}`,
      documentId: doc.id,
      title,
      content: currentBlocks,
      articleTitle,
      articleAuthors,
      articleAbstract,
      articleKeywords,
      articleDate,
      isAuto: false,
      wordCount: calculateWordCount(currentBlocks),
      createdAt: new Date().toISOString(),
    }
    try {
      await saveDocumentVersion(version)
      addToast({ title: '版本快照已保存', color: 'success' })
    } catch (error) {
      console.error('Failed to save document version:', error)
      addToast({ title: '版本快照保存失败', color: 'danger' })
      throw error
    }
  }, [doc, editor, articleTitle, articleAuthors, articleAbstract, articleKeywords, articleDate])

  // Ctrl+S 监听：保存版本快照
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (!doc) return
        const now = new Date()
        const title = `手动保存 ${now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        void handleSaveVersion(title).catch(() => {})
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [doc, handleSaveVersion])

  // 版本控制：恢复历史版本
  const handleRestoreVersion = useCallback(async (version: DocumentVersion) => {
    if (!doc) return
    
    // 先保存当前版本（自动）
    const currentBlocks = editor.document as Block[]
    const autoVersion: DocumentVersion = {
      id: `version-${Date.now()}`,
      documentId: doc.id,
      title: `恢复前自动保存`,
      content: currentBlocks,
      articleTitle,
      articleAuthors,
      articleAbstract,
      articleKeywords,
      articleDate,
      isAuto: true,
      wordCount: calculateWordCount(currentBlocks),
      createdAt: new Date().toISOString(),
    }
    try {
      await saveDocumentVersion(autoVersion)
    } catch (error) {
      console.error('Failed to save restore backup version:', error)
      addToast({ title: '恢复前自动备份失败，已取消恢复', color: 'danger' })
      throw error
    }
    
    // 恢复版本内容
    const safeVersionContent = sanitizeBlockTree(version.content)
    let restoredContent = safeVersionContent
    if (safeVersionContent.length > 0) {
      const result = applyCompatibleBlockContent(editor, safeVersionContent, '历史版本包含兼容性内容')
      restoredContent = result.appliedContent
    }
    setBlocks(restoredContent)
    
    // 恢复文章元数据
    if (version.articleTitle !== undefined) setArticleTitle(version.articleTitle)
    if (version.articleAuthors !== undefined) setArticleAuthors(version.articleAuthors)
    if (version.articleAbstract !== undefined) setArticleAbstract(version.articleAbstract)
    if (version.articleKeywords !== undefined) setArticleKeywords(version.articleKeywords)
    if (version.articleDate !== undefined) setArticleDate(version.articleDate)
    
    // 保存恢复后的文档
    const updated: AppDocument = {
      ...doc,
      content: restoredContent,
      articleTitle: version.articleTitle,
      articleAuthors: version.articleAuthors,
      articleAbstract: version.articleAbstract,
      articleKeywords: version.articleKeywords,
      articleDate: version.articleDate,
      updatedAt: new Date().toISOString(),
    }
    setDoc(updated)
    saveDocument(updated)
  }, [doc, editor, articleTitle, articleAuthors, articleAbstract, articleKeywords, articleDate])

  // 自动版本快照：每 5 分钟自动保存一次
  const AUTO_VERSION_INTERVAL = 5 * 60 * 1000 // 5分钟
  const lastAutoVersionRef = useRef<string>('') // 上次自动保存的内容 hash
  
  useEffect(() => {
    if (!doc) return
    
    const autoSaveVersion = async () => {
      const currentBlocks = editor.document as Block[]
      const contentStr = JSON.stringify(currentBlocks)
      
      // 计算简单的 hash 来判断内容是否有变化
      let hash = 0
      for (let i = 0; i < contentStr.length; i++) {
        const char = contentStr.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash
      }
      const contentHash = hash.toString()
      
      // 如果内容没有变化，跳过
      if (contentHash === lastAutoVersionRef.current) return
      lastAutoVersionRef.current = contentHash
      
      // 如果内容为空或太少，跳过
      const wordCount = calculateWordCount(currentBlocks)
      if (wordCount < 50) return
      
      const now = new Date()
      const version: DocumentVersion = {
        id: `version-${Date.now()}`,
        documentId: doc.id,
        title: `自动保存 ${now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
        content: currentBlocks,
        articleTitle,
        articleAuthors,
        articleAbstract,
        articleKeywords,
        articleDate,
        isAuto: true,
        wordCount,
        createdAt: now.toISOString(),
      }
      try {
        await saveDocumentVersion(version)
      } catch (error) {
        console.error('Failed to auto save document version:', error)
      }
    }
    
    const intervalId = setInterval(() => {
      void autoSaveVersion()
    }, AUTO_VERSION_INTERVAL)
    
    return () => clearInterval(intervalId)
  }, [doc, editor, articleTitle, articleAuthors, articleAbstract, articleKeywords, articleDate])

  // 作者管理
  const handleAddAuthor = useCallback(() => {
    setEditingAuthor(null)
    setAuthorForm({ name: '', affiliation: '', email: '' })
    setIsAuthorPopoverOpen(true)
  }, [])

  const handleEditAuthor = useCallback((author: ArticleAuthor) => {
    setEditingAuthor(author)
    setAuthorForm({ name: author.name, affiliation: author.affiliation, email: author.email })
    setIsAuthorPopoverOpen(true)
  }, [])

  const handleSaveAuthor = useCallback(() => {
    if (!authorForm.name.trim()) {
      addToast({ title: '请输入作者姓名', color: 'warning' })
      return
    }

    if (editingAuthor) {
      // 编辑现有作者
      setArticleAuthors(prev => prev.map(a =>
        a.id === editingAuthor.id
          ? { ...a, ...authorForm }
          : a
      ))
    } else {
      // 添加新作者
      const newAuthor: ArticleAuthor = {
        id: `author-${Date.now()}`,
        ...authorForm,
      }
      setArticleAuthors(prev => [...prev, newAuthor])
    }
    setIsAuthorPopoverOpen(false)
    // 延迟保存，等待状态更新
    setTimeout(() => saveArticleMetadata(), 100)
  }, [authorForm, editingAuthor, saveArticleMetadata])

  const handleDeleteAuthor = useCallback((authorId: string) => {
    setArticleAuthors(prev => prev.filter(a => a.id !== authorId))
    setTimeout(() => saveArticleMetadata(), 100)
  }, [saveArticleMetadata])

  useClickOutside(authorPopoverRef, () => {
    setIsAuthorPopoverOpen(false)
  })

  useEffect(() => {
    if (!isAuthorPopoverOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAuthorPopoverOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isAuthorPopoverOpen])

  // 重新扫描文档中的引用，按出现顺序重新编号
  const reindexCitations = useCallback(() => {
    const content = editor.document as Block[]
    const citationOrder: string[] = [] // 按出现顺序存储 citationId
    
    // 遍历所有块，按出现顺序收集引用
    content.forEach(block => {
      const blockContent = (block as any).content
      if (Array.isArray(blockContent)) {
        blockContent.forEach((inlineContent: any) => {
          if (inlineContent.type === 'citation') {
            const citationId = inlineContent.props?.citationId
            if (citationId && !citationOrder.includes(citationId)) {
              citationOrder.push(citationId)
            }
          }
        })
      }
    })
    
    // 构建新的引用映射
    const newCitations = new Map<string, CitationData>()
    citationOrder.forEach((citationId, index) => {
      const existing = citationsRef.current.get(citationId)
      if (existing) {
        newCitations.set(citationId, { ...existing, index: index + 1 })
      } else {
        // 从知识库获取引用信息
        const item = getKnowledgeItem(citationId)
        if (item) {
          newCitations.set(citationId, {
            citationId,
            index: index + 1,
            title: item.title,
            authors: item.authors,
            year: item.year || '',
            journal: item.journal || '',
            doi: item.doi || '',
            url: item.url || '',
            bib: item.bib || '',
          })
        }
      }
    })
    
    // 检查是否有变化
    const oldIds = Array.from(citationsRef.current.entries()).map(([id, data]) => `${id}:${data.index}`)
    const newIds = Array.from(newCitations.entries()).map(([id, data]) => `${id}:${data.index}`)
    const hasChanged = oldIds.length !== newIds.length || oldIds.some((id, i) => id !== newIds[i])
    
    if (hasChanged) {
      setCitations(newCitations)
      
      // 更新文档中所有引用的索引
      content.forEach(block => {
        const blockContent = (block as any).content
        if (Array.isArray(blockContent)) {
          let needsUpdate = false
          const newContent = blockContent.map((inlineContent: any) => {
            if (inlineContent.type === 'citation') {
              const citationId = inlineContent.props?.citationId
              const newIndex = citationOrder.indexOf(citationId) + 1
              if (inlineContent.props?.citationIndex !== newIndex) {
                needsUpdate = true
                return {
                  ...inlineContent,
                  props: {
                    ...inlineContent.props,
                    citationIndex: newIndex,
                  },
                }
              }
            }
            return inlineContent
          })
          
          if (needsUpdate) {
            editor.updateBlock(block, { content: newContent } as any)
          }
        }
      })
    }
  }, [editor])

  // 取消待执行的补全请求
  const cancelAutoComplete = useCallback(() => {
    if (completeTimeoutRef.current) {
      clearTimeout(completeTimeoutRef.current)
      completeTimeoutRef.current = null
    }
    if (completeAbortRef.current) {
      completeAbortRef.current.abort()
      completeAbortRef.current = null
    }
  }, [])

  // 请求补全
  const requestAutoComplete = useCallback(async () => {
    const smallModelConfig = getSelectedSmallModel(settings)
    if (!smallModelConfig.apiKey) return

    // 如果编辑器已失去焦点，直接跳过
    if (!editorFocusedRef.current) return

    const result = getContextAroundCursor(editor)
    if (!result) return

    // 取消上一个未完成的请求
    if (completeAbortRef.current) {
      completeAbortRef.current.abort()
    }
    const abortController = new AbortController()
    completeAbortRef.current = abortController

    try {
      const res = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: result.context, modelConfig: smallModelConfig }),
        signal: abortController.signal,
      })
      
      if (res.ok && !abortController.signal.aborted) {
        const { completion } = await res.json() as { completion?: string }
        // 请求回来后再次检查焦点状态
        if (completion && completion.trim() && editorFocusedRef.current) {
          // 获取光标位置用于定位 ghost text
          const selection = window.getSelection()
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            // 提示在光标正下方，与光标左对齐
            const position = { top: rect.bottom + 2, left: rect.left }
            setGhostText(completion.trim())
            setGhostPosition(position)
            lastCursorPositionRef.current = position
            // 延迟显示以触发动画
            setTimeout(() => setGhostVisible(true), 10)
          }
        }
      }
    } catch { /* silent */ }
    if (completeAbortRef.current === abortController) {
      completeAbortRef.current = null
    }
  }, [editor, settings])

  const handleChange = useCallback((_changedEditor: any, ctx?: { getChanges: () => Array<{ type: string; block: Block; prevBlock?: Block }> }) => {
    const changes = ctx?.getChanges() || []
    const commentOnlyChange = changes.length > 0 && changes.every((change) => (
      change.type === 'update'
      && change.prevBlock
      && isCommentThreadOnlyUpdate(change.block as Block, change.prevBlock as Block)
    ))
    const shouldRefreshSidebarBlocks = changes.length === 0 || changes.some((change) => (
      change.type !== 'update' || isHeadingRelatedChange(change)
    ))
    const shouldReindexCitations = changes.length === 0 || changes.some((change) => (
      change.type !== 'update' || isCitationRelatedChange(change)
    ))
    const activeDoc = docRef.current

    if (!activeDoc) return

    if (commentOnlyChange) {
      const current = replaceBlocksInTree(
        activeDoc.content as Block[],
        new Map(changes.map((change) => [change.block.id, change.block as Block])),
      )
      const updated: AppDocument = {
        ...activeDoc,
        content: current,
        updatedAt: new Date().toISOString(),
      }

      docRef.current = updated

      if (commentOnlySaveTimeoutRef.current) {
        clearTimeout(commentOnlySaveTimeoutRef.current)
      }
      commentOnlySaveTimeoutRef.current = setTimeout(() => {
        const latestDoc = docRef.current
        if (latestDoc) {
          saveDocument(latestDoc)
        }
        commentOnlySaveTimeoutRef.current = null
      }, 80)
      return
    }

    const current = editor.document as Block[]
    const title = extractTitle(current, articleTitle)
    const updated: AppDocument = {
      ...activeDoc,
      title,
      content: current,
      articleTitle,
      articleAuthors,
      articleAbstract,
      articleKeywords,
      articleDate,
      updatedAt: new Date().toISOString(),
    }

    docRef.current = updated

    if (shouldRefreshSidebarBlocks) {
      setBlocks(current)
    }

    if (contentSaveTimeoutRef.current) {
      clearTimeout(contentSaveTimeoutRef.current)
    }
    contentSaveTimeoutRef.current = setTimeout(() => {
      const latestDoc = docRef.current
      if (latestDoc) {
        setDoc(latestDoc)
        saveDocument(latestDoc)
      }
      contentSaveTimeoutRef.current = null
    }, 180)

    // 清除之前的 ghost text
    setGhostVisible(false)
    setTimeout(() => {
      setGhostText(null)
      setGhostPosition(null)
    }, 150)
    
    // 重新索引引用（延迟执行，避免频繁更新）
    if (shouldReindexCitations) {
      setTimeout(() => {
        reindexCitations()
      }, 100)
    }

    // Auto-correct: debounce 2.5s
    const smallModelConfig = getSelectedSmallModel(settings)
    if (settings.autoCorrect && smallModelConfig.apiKey) {
      if (correctTimeoutRef.current) clearTimeout(correctTimeoutRef.current)

      correctTimeoutRef.current = setTimeout(async () => {
        const textBlocks = current.filter(b => b.type === 'paragraph')
        if (textBlocks.length === 0) return

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
            body: JSON.stringify({ text, modelConfig: smallModelConfig }),
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

    // Auto-complete: debounce 5s
    if (settings.autoComplete && smallModelConfig.apiKey && editorFocusedRef.current) {
      cancelAutoComplete()
      completeTimeoutRef.current = setTimeout(requestAutoComplete, AUTO_COMPLETE_DELAY)
    }
  }, [editor, articleTitle, articleAuthors, articleAbstract, articleKeywords, articleDate, settings, requestAutoComplete, cancelAutoComplete])

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

  const handleExportLatex = useCallback(() => {
    onLatexModalOpen()
  }, [onLatexModalOpen])

  const doExportLatex = useCallback(async (language: Exclude<LatexExportLanguage, 'auto'>) => {
    if (!doc) return

    try {
      const markdown = await editor.blocksToMarkdownLossy(editor.document)
      const citationList = Array.from(citations.values()).sort((a, b) => a.index - b.index)
      const zipBlob = await exportToLatex(editor as unknown as { document: unknown[] }, doc, citationList, {
        language,
        markdownContent: markdown,
      })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      const baseName = (doc.title || 'document').replace(/[\\/:*?"<>|]/g, '_')
      a.href = url
      a.download = `${baseName}_latex.zip`
      a.click()
      URL.revokeObjectURL(url)
      onLatexModalClose()
      addToast({ title: 'LaTeX 导出成功', color: 'success' })
    } catch (err) {
      addToast({ title: `导出失败: ${err instanceof Error ? err.message : '未知错误'}`, color: 'danger' })
    }
  }, [citations, doc, editor, onLatexModalClose])

  const handleManualCorrect = useCallback(async () => {
    const smallModelConfig = getSelectedSmallModel(settings)
    if (!smallModelConfig.apiKey) {
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
        body: JSON.stringify({ text: allText, modelConfig: smallModelConfig }),
      })
      if (res.ok) {
        const { corrected, error } = await res.json() as { corrected?: string; error?: string }
        if (error) {
          addToast({ title: error, color: 'danger' })
        } else if (corrected) {
          addToast({ title: 'AI 纠错完成', color: 'success' })
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
    <>
      <DocumentIssueHighlighter />
      <div style={{ 
        position: 'fixed', 
        top: 52, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        display: 'flex', 
        overflow: 'hidden' 
      }}>
        {/* Left TOC Sidebar - Desktop: inline, Mobile: overlay */}
        {isMobile ? (
          mobileTocOpen && (
            <>
              <div className="sidebar-backdrop" onClick={() => setMobileTocOpen(false)} />
              <div className="toc-sidebar-overlay">
                <TocSidebar blocks={blocks} docTitle={doc.title} onCollapse={() => setMobileTocOpen(false)} />
              </div>
            </>
          )
        ) : (
          <TocSidebar blocks={blocks} docTitle={doc.title} />
        )}

      {/* Main editor area - only this part scrolls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Ghost Text 浮层 - 补全提示 */}
        {ghostText && ghostPosition && (
          <div
            className={isMobile ? 'editor-mobile-ghost' : ''}
            style={{
              position: 'fixed',
              top: ghostPosition.top,
              left: ghostPosition.left,
              color: 'rgba(120, 120, 120, 0.6)',
              backgroundColor: 'rgba(240, 240, 240, 0.8)',
              padding: '2px 4px',
              borderRadius: '3px',
              fontSize: isMobile ? 13 : 15,
              fontFamily: 'inherit',
              pointerEvents: 'none',
              zIndex: 1000,
              whiteSpace: 'pre-wrap',
              maxWidth: isMobile ? 260 : 400,
              lineHeight: 1.6,
              opacity: ghostVisible ? 1 : 0,
              transform: ghostVisible ? 'translateY(0)' : 'translateY(-4px)',
              transition: 'opacity 150ms ease-out, transform 150ms ease-out',
            }}
          >
            {ghostText}
            <span style={{ 
              fontSize: '11px', 
              color: 'rgba(100, 100, 100, 0.7)',
              marginLeft: '6px',
              border: '1px solid rgba(150, 150, 150, 0.5)',
              padding: '1px 4px',
              borderRadius: '3px',
            }}>
              Tab 接受
            </span>
          </div>
        )}
        {/* Toolbar - Fixed */}
        <div className={isMobile ? 'editor-mobile-toolbar' : ''} style={{
          padding: '8px 20px',
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}>
          {isMobile && (
            <Tooltip content="目录" placement="bottom">
              <Button
                size="sm"
                variant="light"
                isIconOnly
                onPress={() => setMobileTocOpen(true)}
              >
                <TocIcon />
              </Button>
            </Tooltip>
          )}

          <Tooltip content="导出为 Markdown" placement="bottom">
            <Button
              size="sm"
              color="primary"
              variant="solid"
              startContent={<ExportIcon />}
              onPress={handleExport}
            >
              <span className="btn-label">导出 MD</span>
            </Button>
          </Tooltip>

          <Tooltip content="导出为 LaTeX Zip" placement="bottom">
            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={<LatexIcon />}
              onPress={handleExportLatex}
            >
              <span className="btn-label">导出 TeX</span>
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
                  <span className="btn-label">AI 纠错</span>
                </Button>
              </Tooltip>
              {correcting && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>正在纠错…</span>
              )}
            </>
          )}

          <Divider orientation="vertical" style={{ height: 20 }} />
          <VersionHistoryPanel
            documentId={doc.id}
            currentContent={doc.content as Block[]}
            articleTitle={articleTitle}
            articleAuthors={articleAuthors}
            articleAbstract={articleAbstract}
            articleKeywords={articleKeywords}
            articleDate={articleDate}
            onRestoreVersion={handleRestoreVersion}
            onSaveVersion={handleSaveVersion}
          />

          <div style={{ flex: 1 }} />
          {!isMobile && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {doc.title}
            </span>
          )}
        </div>

        {/* Editor - Only scrollable area */}
        <div className={isMobile ? 'editor-mobile-padding' : ''} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 16 : '40px 60px', background: 'var(--bg-primary)' }}>
          <div
            className="editor-themed-surface"
            style={{
              maxWidth: 800,
              margin: '0 auto',
              fontFamily: activeThemeConfig.fontFamily,
              ['--editor-font-family' as string]: activeThemeConfig.fontFamily,
            }}
          >
            {/* 文章标题区域 */}
            <div style={{ marginBottom: isMobile ? 16 : 24 }}>
              <input
                type="text"
                value={articleTitle}
                onChange={(e) => {
                  const nextTitle = e.target.value
                  setArticleTitle(nextTitle)
                  if (!doc) return

                  const updated: AppDocument = {
                    ...doc,
                    title: nextTitle.trim() || extractTitle(editor.document as Block[], nextTitle),
                    articleTitle: nextTitle,
                    articleAuthors,
                    articleAbstract,
                    articleKeywords,
                    articleDate,
                    updatedAt: new Date().toISOString(),
                  }
                  setDoc(updated)
                  saveDocument(updated)
                }}
                placeholder="点击输入文章标题"
                className={isMobile ? 'editor-mobile-title' : ''}
                style={{
                  width: '100%',
                  fontSize: isMobile ? 22 : 28,
                  fontWeight: 700,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  padding: isMobile ? '4px 0' : '8px 0',
                  borderBottom: '2px solid transparent',
                  transition: 'border-color 0.2s',
                  textAlign: 'center',
                }}
                onFocus={(e) => {
                  e.target.style.borderBottomColor = 'var(--accent-color)'
                }}
                onBlur={(e) => {
                  e.target.style.borderBottomColor = 'transparent'
                  saveArticleMetadata()
                }}
              />
            </div>

            {/* 描述表格 */}
            <div className={isMobile ? 'editor-mobile-meta' : ''} style={{
              display: 'flex',
              justifyContent: 'center',
              gap: isMobile ? 8 : 32,
              marginBottom: isMobile ? 16 : 32,
              fontSize: 13,
              color: 'var(--text-secondary)',
              flexWrap: 'wrap',
            }}>
              {/* 日期 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CalendarIcon />
                <input
                  type="date"
                  value={articleDate}
                  onChange={(e) => {
                    setArticleDate(e.target.value)
                    setTimeout(() => saveArticleMetadata(), 100)
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                />
              </div>

              {/* 作者 */}
              <div ref={authorPopoverRef} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                <UserIcon />
                {!isAuthorPopoverOpen && (
                  <motion.button
                    layout
                    layoutId={AUTHOR_CARD_LAYOUT_ID}
                    onClick={articleAuthors.length === 0 ? handleAddAuthor : () => setIsAuthorPopoverOpen(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      maxWidth: 360,
                      cursor: 'pointer',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-secondary)',
                      color: articleAuthors.length === 0 ? 'var(--accent-color)' : 'var(--text-primary)',
                      borderRadius: 999,
                      padding: '6px 12px',
                      fontSize: 13,
                      lineHeight: 1.2,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                    }}
                    title={articleAuthors.length > 0 ? '点击编辑作者' : '点击添加作者'}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getAuthorChipLabel(articleAuthors)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12, flexShrink: 0 }}>
                      {articleAuthors.length > 0 ? '编辑' : '+'}
                    </span>
                  </motion.button>
                )}

                <AnimatePresence initial={false}>
                  {isAuthorPopoverOpen && (
                    <motion.div
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'linear' }}
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: 'calc(100% + 12px)',
                        zIndex: 1100,
                        width: 320,
                        overflow: 'hidden',
                        borderRadius: 16,
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-primary)',
                        boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                        transformOrigin: 'top right',
                      }}
                    >
                      <motion.div
                        layout
                        layoutId={AUTHOR_CARD_LAYOUT_ID}
                        transition={{ duration: 0.18, ease: 'linear' }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: 14,
                          borderBottom: '1px solid var(--border-color)',
                          color: 'var(--text-primary)',
                          background: 'var(--bg-secondary)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {editingAuthor ? editingAuthor.name : getAuthorChipLabel(articleAuthors)}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            {editingAuthor ? '编辑作者信息' : articleAuthors.length > 0 ? '管理作者列表' : '添加论文作者'}
                          </div>
                        </div>
                        <Button variant="light" size="sm" isIconOnly onPress={() => setIsAuthorPopoverOpen(false)}>
                          ×
                        </Button>
                      </motion.div>
                      <motion.div
                        layout
                        transition={{ duration: 0.18, ease: 'linear' }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}
                      >
                        {articleAuthors.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {articleAuthors.map((author) => {
                              const isActive = editingAuthor?.id === author.id
                              return (
                                <button
                                  key={author.id}
                                  type="button"
                                  onClick={() => handleEditAuthor(author)}
                                  style={{
                                    border: `1px solid ${isActive ? 'var(--accent-color)' : 'var(--border-color)'}`,
                                    background: isActive ? 'var(--accent-light)' : 'var(--bg-secondary)',
                                    color: 'var(--text-primary)',
                                    borderRadius: 999,
                                    padding: '4px 10px',
                                    fontSize: 12,
                                    cursor: 'pointer',
                                  }}
                                  title={`${author.affiliation}${author.email ? `\n${author.email}` : ''}`}
                                >
                                  {author.name}
                                </button>
                              )
                            })}
                            <button
                              type="button"
                              onClick={handleAddAuthor}
                              style={{
                                border: '1px dashed var(--border-color)',
                                background: 'transparent',
                                color: 'var(--accent-color)',
                                borderRadius: 999,
                                padding: '4px 10px',
                                fontSize: 12,
                                cursor: 'pointer',
                              }}
                            >
                              + 新增作者
                            </button>
                          </div>
                        )}
                        <Input
                          label="姓名"
                          placeholder="作者姓名"
                          value={authorForm.name}
                          onValueChange={(v) => setAuthorForm(prev => ({ ...prev, name: v }))}
                          size="sm"
                          variant="bordered"
                        />
                        <Input
                          label="单位"
                          placeholder="所属机构/学校"
                          value={authorForm.affiliation}
                          onValueChange={(v) => setAuthorForm(prev => ({ ...prev, affiliation: v }))}
                          size="sm"
                          variant="bordered"
                        />
                        <Input
                          label="邮箱"
                          type="email"
                          placeholder="example@university.edu"
                          value={authorForm.email}
                          onValueChange={(v) => setAuthorForm(prev => ({ ...prev, email: v }))}
                          size="sm"
                          variant="bordered"
                        />
                      </motion.div>
                      <motion.div
                        layout="position"
                        transition={{ duration: 0.18, ease: 'linear' }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 14, borderTop: '1px solid var(--border-color)' }}
                      >
                        {editingAuthor && (
                          <Button
                            color="danger"
                            variant="light"
                            size="sm"
                            onPress={() => {
                              handleDeleteAuthor(editingAuthor.id)
                              setIsAuthorPopoverOpen(false)
                            }}
                          >
                            删除
                          </Button>
                        )}
                        <div style={{ flex: 1 }} />
                        <Button variant="light" size="sm" onPress={() => setIsAuthorPopoverOpen(false)}>取消</Button>
                        <Button color="primary" size="sm" onPress={handleSaveAuthor}>保存</Button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* 分隔线 */}
            <Divider style={{ marginBottom: 32 }} />

            {/* 评论输入浮层 */}
            {selectedText && commentModalPosition && (
              <div
                className={isMobile ? 'editor-mobile-comment' : ''}
                style={{
                  position: 'fixed',
                  top: isMobile ? 'auto' : commentModalPosition.top,
                  bottom: isMobile ? 80 : 'auto',
                  left: isMobile ? 16 : commentModalPosition.left,
                  right: isMobile ? 16 : 'auto',
                  zIndex: 1001,
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  padding: 12,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  width: isMobile ? 'auto' : 300,
                }}
              >
                <div style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  marginBottom: 8,
                  maxHeight: 60,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  borderLeft: '3px solid var(--accent-color)',
                  paddingLeft: 8,
                }}>
                  {selectedText.length > 100 ? selectedText.slice(0, 100) + '...' : selectedText}
                </div>
                <textarea
                  autoFocus
                  placeholder="添加评论..."
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 60,
                    border: '1px solid var(--border-color)',
                    borderRadius: 4,
                    padding: 8,
                    fontSize: 13,
                    resize: 'vertical',
                    outline: 'none',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      if (commentContent.trim() && pendingCommentThreadId) {
                        addComment({
                          id: pendingCommentThreadId,
                          documentId: docId,
                          selectedText,
                          blockId: selectedBlockId,
                          startOffset: selectedCommentStartOffset,
                          endOffset: selectedCommentEndOffset,
                          content: commentContent.trim(),
                          source: 'user',
                          createdAt: new Date().toISOString(),
                          updatedAt: new Date().toISOString(),
                        })
                        addToast({ title: '评论已添加', color: 'success' })
                        setPendingCommentThreadId(null)
                        setSelectedText(null)
                        setSelectedBlockId(undefined)
                        setSelectedCommentStartOffset(undefined)
                        setSelectedCommentEndOffset(undefined)
                        setCommentModalPosition(null)
                        setCommentContent('')
                      }
                    } else if (e.key === 'Escape') {
                      if (pendingCommentThreadId) {
                        removeCommentThreadMarks(pendingCommentThreadId)
                      }
                      setPendingCommentThreadId(null)
                      setSelectedText(null)
                      setSelectedBlockId(undefined)
                      setSelectedCommentStartOffset(undefined)
                      setSelectedCommentEndOffset(undefined)
                      setCommentModalPosition(null)
                      setCommentContent('')
                    }
                  }}
                />
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 8,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}>
                  <span>Ctrl+Enter 发送</span>
                  <span>Esc 取消</span>
                </div>
              </div>
            )}

            <BlockNoteView
              key={settings.editorThemeId ?? 'default'}
              editor={editor as any}
              onChange={handleChange as any}
              theme={activeTheme}
              formattingToolbar={false}
              slashMenu={false}
              sideMenu={false}
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
                    <QuoteToAssistantButton />
                    <CommentToolbarButton />
                  </FormattingToolbar>
                )}
              />

              {/* 自定义侧边菜单：包含块类型转换功能 */}
              <SideMenuController
                sideMenu={() => (
                  <SideMenu dragHandleMenu={CustomDragHandleMenu} />
                )}
              />

              {/* 带 AI 选项的斜杠菜单 */}
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query) => {
                  const defaultItems = getDefaultReactSlashMenuItems(editor) as SlashMenuItem[]
                  const baseItems = defaultItems.filter((item) => !isCollapsibleHeadingItem(item) && !isEmojiItem(item))

                  const tableItem = baseItems.find(isTableItem)
                  const imageItem = baseItems.find(isImageItem)
                  const itemsWithoutQuickInsert = baseItems.filter((item) => !isTableItem(item) && !isImageItem(item))
                  const formulaItem: SlashMenuItem = {
                    title: '行内公式',
                    group: '其他',
                    icon: <FormulaIcon />,
                    aliases: ['formula', 'math', '公式', '数学', 'latex', 'gs'],
                    onItemClick: () => {
                      editor.insertInlineContent([
                        {
                          type: 'formula',
                          props: {
                            latex: '',
                            autoOpenToken: `formula-open-${Date.now()}`,
                          },
                        },
                      ])
                    },
                  }
                  const canvasItem: SlashMenuItem = {
                    title: '画板',
                    group: '其他',
                    icon: <CanvasIcon />,
                    aliases: ['canvas', 'diagram', '图', 'huaban', 'hb'],
                    onItemClick: () => {
                      const cursorBlock = editor.getTextCursorPosition().block
                      editor.insertBlocks([{ type: 'canvas' as any }], cursorBlock, 'after')
                    },
                  }

                  const normalizedItems = itemsWithoutQuickInsert.map(withPinyinAliases)
                  const quickInsertGroup = '快捷插入'
                  const insertItems: SlashMenuItem[] = [
                    withMenuGroup(withPinyinAliases(formulaItem), quickInsertGroup),
                    withMenuGroup(withPinyinAliases(canvasItem), quickInsertGroup),
                  ]
                  if (imageItem) {
                    insertItems.push(withMenuGroup(withPinyinAliases(imageItem), quickInsertGroup))
                  }
                  if (tableItem) {
                    insertItems.push(withMenuGroup(withPinyinAliases(tableItem), quickInsertGroup))
                  }

                  const heading3Index = normalizedItems.findIndex(isHeading3Item)
                  if (heading3Index >= 0) {
                    normalizedItems.splice(heading3Index + 1, 0, ...insertItems)
                  } else {
                    normalizedItems.push(...insertItems)
                  }

                  return filterSuggestionItems(
                    [
                      ...normalizedItems,
                      ...getAISlashMenuItems(editor),
                    ],
                    query
                  )
                }}
              />

              {/* 引用文献菜单：输入 [ 触发 */}
              <SuggestionMenuController
                triggerCharacter="["
                minQueryLength={0}
                getItems={async (query) => filterSuggestionItems(buildCitationSuggestionItems(), query)}
              />
            </BlockNoteView>
            
            {/* References 区域 */}
            {citations.size > 0 && (
              <div style={{
                marginTop: '60px',
                paddingTop: '24px',
                borderTop: '2px solid var(--border-color)',
              }}>
                <h2 style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  color: 'var(--text-primary)',
                }}>
                  References
                </h2>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}>
                  {Array.from(citations.values())
                    .sort((a, b) => a.index - b.index)
                    .map((citation) => (
                      <div 
                        key={citation.citationId}
                        id={`reference-${citation.citationId}`}
                        style={{
                          fontSize: '13px',
                          lineHeight: 1.6,
                          color: 'var(--text-secondary)',
                          paddingLeft: '24px',
                          textIndent: '-24px',
                          padding: '4px 4px 4px 24px',
                          marginLeft: '-4px',
                          borderRadius: '4px',
                          transition: 'background-color 0.2s',
                        }}
                      >
                        <span 
                          onClick={() => {
                            // 点击索引号跳转到正文中对应的引用
                            const citationElements = document.querySelectorAll(`[data-citation-id="${citation.citationId}"]`)
                            if (citationElements.length > 0) {
                              const firstCitation = citationElements[0] as HTMLElement
                              firstCitation.scrollIntoView({ behavior: 'smooth', block: 'center' })
                              // 高亮效果
                              firstCitation.style.backgroundColor = 'rgba(59, 130, 246, 0.3)'
                              setTimeout(() => {
                                firstCitation.style.backgroundColor = ''
                              }, 2000)
                            }
                          }}
                          style={{ 
                            color: 'var(--accent-color)', 
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                          title="点击跳转到正文"
                        >
                          [{citation.index}]
                        </span>
                        {' '}
                        {citation.bib ? (
                          <span dangerouslySetInnerHTML={{ 
                            __html: citation.bib
                              .replace(/<[^>]*>/g, ' ') // 移除 HTML 标签
                              .replace(/\s+/g, ' ')      // 合并多余空格
                              .trim()
                          }} />
                        ) : (
                          <>
                            {citation.authors.length > 0 && (
                              <span>{citation.authors.join(', ')}. </span>
                            )}
                            <span style={{ fontWeight: 500 }}>{citation.title}</span>
                            {citation.journal && <span>, {citation.journal}</span>}
                            {citation.year && <span>, {citation.year}</span>}
                            {citation.doi && (
                              <span>. DOI: <a 
                                href={`https://doi.org/${citation.doi}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--accent-color)' }}
                              >
                                {citation.doi}
                              </a></span>
                            )}
                            {citation.url && !citation.doi && (
                              <span>. <a 
                                href={citation.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: 'var(--accent-color)' }}
                              >
                                {citation.url}
                              </a></span>
                            )}
                            <span>.</span>
                          </>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Icon Sidebar - Fixed */}
      <RightSidebar documentId={docId} />

      {/* LaTeX 导出语言选择弹窗 */}
      <Modal isOpen={isLatexModalOpen} onClose={onLatexModalClose} size="sm">
        <ModalContent>
          <ModalHeader>选择 LaTeX 导出语言</ModalHeader>
          <ModalBody>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Button
                variant={latexLanguage === 'zh' ? 'solid' : 'flat'}
                color={latexLanguage === 'zh' ? 'primary' : 'default'}
                onPress={() => setLatexLanguage('zh')}
              >
                中文模板（ctex）
              </Button>
              <Button
                variant={latexLanguage === 'en' ? 'solid' : 'flat'}
                color={latexLanguage === 'en' ? 'primary' : 'default'}
                onPress={() => setLatexLanguage('en')}
              >
                English template (article)
              </Button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              导出 zip 将自动包含 main.tex、images/ 和 document.md。
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onLatexModalClose}>取消</Button>
            <Button color="primary" onPress={() => doExportLatex(latexLanguage)}>
              开始导出
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      </div>
    </>
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

function LatexIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16v16H4z" />
      <path d="M8 9l2 6" />
      <path d="M8 15h4" />
      <path d="M13 9h4" />
      <path d="M13 15h4" />
      <path d="M15 9v6" />
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

function FormulaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h6v6H4z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M4 14h6v6H4z" />
      <circle cx="17" cy="17" r="3" />
    </svg>
  )
}

function CanvasIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="m7 13 3-3 3 2 4-4" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  )
}

function CitationIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 7H20" />
      <path d="M6.5 7h13.5v13H6.5a2.5 2.5 0 0 0 0-5H20V4H6.5a2.5 2.5 0 0 0 0 5Z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function TocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="15" y2="12" />
      <line x1="3" y1="18" x2="18" y2="18" />
    </svg>
  )
}
