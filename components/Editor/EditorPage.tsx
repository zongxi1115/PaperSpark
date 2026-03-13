'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useCreateBlockNote,
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  SideMenuController,
  SideMenu,
} from '@blocknote/react'
import { CustomDragHandleMenu } from './CustomDragHandleMenu'
import { BlockNoteView } from '@blocknote/mantine'
import { zh } from '@blocknote/core/locales'
import { filterSuggestionItems } from '@blocknote/core/extensions'
import { BlockNoteSchema, defaultInlineContentSpecs } from '@blocknote/core'
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
import { getDocument, saveDocument, setLastDocId, getSettings, getSelectedSmallModel, getSelectedLargeModel, getKnowledgeItem, getKnowledgeItems } from '@/lib/storage'
import type { AppDocument, AppSettings, ArticleAuthor } from '@/lib/types'
import { continueWritingItem, translateItem, polishItem } from './aiCommands'
import { FormulaInlineContentSpec } from './InlineFormula'
import { FormulaInputExtension } from '@/lib/formulaInputExtension'
import { CitationInlineContentSpec, CitationData, dispatchCitationInsert } from './CitationBlock'
import { getThemeById, buildBlockNoteTheme, injectGoogleFont } from '@/lib/editorThemes'
import { registerEditor, unregisterEditor } from '@/lib/editorContext'
import { exportToLatex } from '@/lib/latexExporter'

// 自定义 Schema：包含行内公式和引用
const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    formula: FormulaInlineContentSpec,
    citation: CitationInlineContentSpec,
  },
})

interface EditorPageProps {
  docId: string
}

const CONTEXT_WINDOW = 1500 // 上下文窗口大小
const AUTO_COMPLETE_DELAY = 5000 // 5秒无输入后触发补全

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

/**
 * 获取光标位置周围的上下文文本
 * 返回 { context: 带有 | 标记光标位置的文本, cursorGlobalPos: 全局光标位置 }
 */
function getContextAroundCursor(editor: ReturnType<typeof useCreateBlockNote>, windowSize: number = CONTEXT_WINDOW): { context: string; cursorGlobalPos: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  
  // 获取编辑器内所有文本块的纯文本
  const allBlocks = editor.document as Block[]
  const textBlocks = allBlocks.filter(b => b.type === 'paragraph' || b.type === 'heading')
  
  if (textBlocks.length === 0) return null
  
  // 构建完整文本和位置映射
  let fullText = ''
  const blockTextMap: { block: Block; start: number; end: number; text: string }[] = []
  
  for (const block of textBlocks) {
    const text = getBlockPlainText(block)
    const start = fullText.length
    fullText += text + '\n'
    blockTextMap.push({ block, start, end: fullText.length, text })
  }
  
  // 尝试找到光标在哪个 block 中
  let cursorGlobalPos = -1
  const editorElement = document.querySelector('.bn-editor')
  
  if (editorElement && range.startContainer) {
    // 向上查找最近的 block 元素
    let node: Node | null = range.startContainer
    while (node && node !== editorElement) {
      if (node instanceof Element && node.hasAttribute('data-node-type')) {
        const blockId = node.getAttribute('data-id')
        if (blockId) {
          const blockIdx = textBlocks.findIndex(b => b.id === blockId)
          if (blockIdx >= 0) {
            const blockInfo = blockTextMap[blockIdx]
            // 计算光标在 block 内的位置
            const rangeInBlock = document.createRange()
            rangeInBlock.selectNodeContents(node)
            rangeInBlock.setEnd(range.startContainer, range.startOffset)
            const textBeforeCursor = rangeInBlock.toString()
            // 简化处理：估算位置
            const textInBlock = blockInfo.text
            let localPos = Math.min(textBeforeCursor.length, textInBlock.length)
            cursorGlobalPos = blockInfo.start + localPos
            break
          }
        }
      }
      node = node.parentNode
    }
  }
  
  // 如果找不到，放在最后一个块的末尾
  if (cursorGlobalPos < 0 && blockTextMap.length > 0) {
    const lastBlock = blockTextMap[blockTextMap.length - 1]
    cursorGlobalPos = lastBlock.end - 1 // 减去最后的换行符
  }
  
  if (cursorGlobalPos < 0) return null
  
  // 提取窗口大小的上下文
  const halfWindow = Math.floor(windowSize / 2)
  const start = Math.max(0, cursorGlobalPos - halfWindow)
  const end = Math.min(fullText.length, cursorGlobalPos + halfWindow)
  
  const contextText = fullText.slice(start, end)
  const cursorOffset = cursorGlobalPos - start
  
  // 插入 | 标记
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
  const [citations, setCitations] = useState<Map<string, CitationData>>(new Map()) // 引用列表

  // 文章元数据状态
  const [articleTitle, setArticleTitle] = useState('')
  const [articleAuthors, setArticleAuthors] = useState<ArticleAuthor[]>([])
  const [articleAbstract, setArticleAbstract] = useState('')
  const [articleKeywords, setArticleKeywords] = useState<string[]>([])
  const [articleDate, setArticleDate] = useState(() => new Date().toISOString().split('T')[0])

  // 作者编辑弹窗
  const { isOpen: isAuthorModalOpen, onOpen: onAuthorModalOpen, onClose: onAuthorModalClose } = useDisclosure()
  const [editingAuthor, setEditingAuthor] = useState<ArticleAuthor | null>(null)
  const [authorForm, setAuthorForm] = useState({ name: '', affiliation: '', email: '' })

  // 当前主题配置，动态更新
  const activeThemeConfig = getThemeById(settings.editorThemeId ?? 'default')
  const activeTheme = buildBlockNoteTheme(activeThemeConfig)
  
  const correctTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCorrectedRef = useRef<string>('')
  const settingsRef = useRef<AppSettings>(settings)
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
    // 粘贴处理器：解析 markdown 中的公式
    pasteHandler: async ({ event, editor, defaultPasteHandler }) => {
      const clipboardData = event.clipboardData
      if (!clipboardData) {
        return defaultPasteHandler()
      }

      // 获取纯文本内容
      const plainText = clipboardData.getData('text/plain')
      
      // 检查是否包含公式标记
      if (plainText && (plainText.includes('$') || plainText.includes('$$'))) {
        // 导入公式解析函数
        const { parseMarkdownWithFormulas, convertToInlineContent } = await import('@/lib/formulaInputExtension')
        
        // 解析公式
        const parsed = parseMarkdownWithFormulas(plainText)
        
        // 如果有公式被解析出来
        const hasFormulas = parsed.some(p => p.type === 'formula')
        
        if (hasFormulas) {
          // 处理包含公式的粘贴
          // 对于块级公式，需要创建新块
          // 对于行内公式，转换为行内内容
          
          // 将解析结果转换为 BlockNote 可用的格式
          const inlineContent = convertToInlineContent(parsed)
          
          // 插入内容
          editor.insertInlineContent(inlineContent)
          return true
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

  // 同步 citationsRef
  useEffect(() => {
    citationsRef.current = citations
  }, [citations])

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
        setGhostText(null)
        setGhostPosition(null)
      } else if (e.key !== 'Tab' && ghostTextRef.current) {
        // 任意其他键清除 ghost text
        setGhostText(null)
        setGhostPosition(null)
      }
    }
    
    document.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true })
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
      if (loaded.content && (loaded.content as Block[]).length > 0) {
        editor.replaceBlocks(editor.document, loaded.content as Block[])
        setBlocks(editor.document as Block[])
        
        // 提取已有的引用（从行内内容中）
        const extractedCitations = new Map<string, CitationData>()
        const content = loaded.content as Block[]
        
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

  // 保存文章元数据
  const saveArticleMetadata = useCallback(() => {
    if (!doc) return
    const updated: AppDocument = {
      ...doc,
      articleTitle,
      articleAuthors,
      articleAbstract,
      articleKeywords,
      articleDate,
      updatedAt: new Date().toISOString(),
    }
    setDoc(updated)
    saveDocument(updated)
  }, [doc, articleTitle, articleAuthors, articleAbstract, articleKeywords, articleDate])

  // 作者管理
  const handleAddAuthor = useCallback(() => {
    setEditingAuthor(null)
    setAuthorForm({ name: '', affiliation: '', email: '' })
    onAuthorModalOpen()
  }, [onAuthorModalOpen])

  const handleEditAuthor = useCallback((author: ArticleAuthor) => {
    setEditingAuthor(author)
    setAuthorForm({ name: author.name, affiliation: author.affiliation, email: author.email })
    onAuthorModalOpen()
  }, [onAuthorModalOpen])

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
    onAuthorModalClose()
    // 延迟保存，等待状态更新
    setTimeout(() => saveArticleMetadata(), 100)
  }, [authorForm, editingAuthor, onAuthorModalClose, saveArticleMetadata])

  const handleDeleteAuthor = useCallback((authorId: string) => {
    setArticleAuthors(prev => prev.filter(a => a.id !== authorId))
    setTimeout(() => saveArticleMetadata(), 100)
  }, [saveArticleMetadata])

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

  // 请求补全
  const requestAutoComplete = useCallback(async () => {
    const smallModelConfig = getSelectedSmallModel(settings)
    if (!smallModelConfig.apiKey) return

    const result = getContextAroundCursor(editor)
    if (!result) return

    try {
      const res = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: result.context, modelConfig: smallModelConfig }),
      })
      
      if (res.ok) {
        const { completion } = await res.json() as { completion?: string }
        if (completion && completion.trim()) {
          // 获取光标位置用于定位 ghost text
          const selection = window.getSelection()
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0)
            const rect = range.getBoundingClientRect()
            setGhostText(completion.trim())
            setGhostPosition({ top: rect.bottom, left: rect.right })
          }
        }
      }
    } catch { /* silent */ }
  }, [editor, settings])

  const handleChange = useCallback(() => {
    const current = editor.document as Block[]
    setBlocks(current)

    if (!doc) return
    const title = extractTitle(current)
    const updated: AppDocument = {
      ...doc,
      title,
      content: current,
      articleTitle,
      articleAuthors,
      articleAbstract,
      articleKeywords,
      articleDate,
      updatedAt: new Date().toISOString(),
    }
    setDoc(updated)
    saveDocument(updated)

    // 清除之前的 ghost text
    setGhostText(null)
    setGhostPosition(null)
    
    // 重新索引引用（延迟执行，避免频繁更新）
    setTimeout(() => {
      reindexCitations()
    }, 100)

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
    if (settings.autoComplete && smallModelConfig.apiKey) {
      if (completeTimeoutRef.current) clearTimeout(completeTimeoutRef.current)
      completeTimeoutRef.current = setTimeout(requestAutoComplete, AUTO_COMPLETE_DELAY)
    }
  }, [doc, editor, settings, requestAutoComplete])

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

  const handleExportLatex = useCallback(async () => {
    if (!doc) return

    try {
      const citationList = Array.from(citations.values()).sort((a, b) => a.index - b.index)
      const zipBlob = await exportToLatex(editor as unknown as { document: unknown[] }, doc, citationList)
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement('a')
      const baseName = (doc.title || 'document').replace(/[\\/:*?"<>|]/g, '_')
      a.href = url
      a.download = `${baseName}_latex.zip`
      a.click()
      URL.revokeObjectURL(url)
      addToast({ title: 'LaTeX 导出成功', color: 'success' })
    } catch (err) {
      addToast({ title: `导出失败: ${err instanceof Error ? err.message : '未知错误'}`, color: 'danger' })
    }
  }, [citations, doc, editor])

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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Ghost Text 浮层 - 补全提示 */}
        {ghostText && ghostPosition && (
          <div
            style={{
              position: 'fixed',
              top: ghostPosition.top,
              left: ghostPosition.left,
              color: 'rgba(120, 120, 120, 0.6)',
              backgroundColor: 'rgba(240, 240, 240, 0.8)',
              padding: '2px 4px',
              borderRadius: '3px',
              fontSize: '15px',
              fontFamily: 'inherit',
              pointerEvents: 'none',
              zIndex: 1000,
              whiteSpace: 'pre-wrap',
              maxWidth: '400px',
              lineHeight: 1.6,
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

          <Tooltip content="导出为 LaTeX Zip" placement="bottom">
            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={<LatexIcon />}
              onPress={handleExportLatex}
            >
              导出 TeX
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
            <div style={{ marginBottom: 24 }}>
              <input
                type="text"
                value={articleTitle}
                onChange={(e) => {
                  setArticleTitle(e.target.value)
                  // 防抖保存
                  if (doc) {
                    const timeoutId = setTimeout(() => {
                      const updated = { ...doc, articleTitle: e.target.value, updatedAt: new Date().toISOString() }
                      saveDocument(updated)
                    }, 500)
                    return () => clearTimeout(timeoutId)
                  }
                }}
                placeholder="点击输入文章标题"
                style={{
                  width: '100%',
                  fontSize: 28,
                  fontWeight: 700,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  padding: '8px 0',
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
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 32,
              marginBottom: 32,
              fontSize: 13,
              color: 'var(--text-secondary)',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserIcon />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {articleAuthors.length === 0 ? (
                    <span
                      onClick={handleAddAuthor}
                      style={{ cursor: 'pointer', color: 'var(--accent-color)' }}
                    >
                      点击添加作者
                    </span>
                  ) : (
                    <>
                      {articleAuthors.map((author, index) => (
                        <span key={author.id}>
                          <span
                            onClick={() => handleEditAuthor(author)}
                            style={{ cursor: 'pointer' }}
                            title={`${author.affiliation}${author.email ? `\n${author.email}` : ''}`}
                          >
                            {author.name}
                          </span>
                          {index < articleAuthors.length - 1 && <span>, </span>}
                        </span>
                      ))}
                      <span
                        onClick={handleAddAuthor}
                        style={{
                          cursor: 'pointer',
                          color: 'var(--accent-color)',
                          marginLeft: 4,
                          fontSize: 12,
                        }}
                        title="添加作者"
                      >
                        +
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <Divider style={{ marginBottom: 32 }} />

            <BlockNoteView
              key={settings.editorThemeId ?? 'default'}
              editor={editor}
              onChange={handleChange}
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
                getItems={async (query) =>
                  filterSuggestionItems(
                    [
                      ...getDefaultReactSlashMenuItems(editor),
                      ...getAISlashMenuItems(editor),
                      {
                        title: '行内公式',
                        groupName: '其他',
                        icon: <FormulaIcon />,
                        keywords: ['formula', 'math', '公式', '数学','latex','gs'],
                        onItemClick: () => {
                          editor.insertInlineContent([
                            {
                              type: 'formula',
                              props: { latex: '' },
                            },
                          ])
                        },
                      },
                    ],
                    query
                  )
                }
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
      <RightSidebar />

      {/* 作者编辑弹窗 */}
      <Modal isOpen={isAuthorModalOpen} onClose={onAuthorModalClose} size="sm">
        <ModalContent>
          <ModalHeader>{editingAuthor ? '编辑作者' : '添加作者'}</ModalHeader>
          <ModalBody>
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
          </ModalBody>
          <ModalFooter>
            {editingAuthor && (
              <Button
                color="danger"
                variant="light"
                onPress={() => {
                  handleDeleteAuthor(editingAuthor.id)
                  onAuthorModalClose()
                }}
              >
                删除
              </Button>
            )}
            <div style={{ flex: 1 }} />
            <Button variant="light" onPress={onAuthorModalClose}>取消</Button>
            <Button color="primary" onPress={handleSaveAuthor}>保存</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
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
