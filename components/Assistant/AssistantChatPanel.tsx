'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button, Tooltip, Autocomplete, AutocompleteItem, addToast, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, useDisclosure, Spinner } from '@heroui/react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button as UiButton } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from '@/components/prompt-kit/chat-container'
import { Message, MessageAction, MessageActions, MessageContent } from '@/components/prompt-kit/message'
import { PromptInput, PromptInputAction, PromptInputActions, PromptInputTextarea } from '@/components/prompt-kit/prompt-input'
import { ScrollButton } from '@/components/ui/scroll-button'
import { readDocument } from './tools/ReadDocumentTool'

// Python 运行结果接口
interface PythonRunResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  executionTime: number
  images: string[]
}

// 代码块运行状态
interface CodeBlockState {
  isRunning: boolean
  result: PythonRunResult | null
  showOutput: boolean
}
import {
  EditDocumentTool,
  SimpleTool,
  applyEditOperations,
  acceptInsertionChanges,
  rejectInsertionChanges,
  parseSimpleToolCalls,
  stripSimpleToolSyntax,
  convertToolCallsToRequest,
  getDocumentStructure,
  StreamingToolDetector,
  type EditDocumentRequest,
  type EditStatus,
  type ParsedToolCall,
} from './tools/EditDocumentTool'
import { getEditor, getSelectedText, getSelectionContext } from '@/lib/editorContext'
import { 
  getAgents, 
  getSettings, 
  getKnowledgeItems,
  getDocument,
  getLastDocId,
  getAssets,
  getAssetTypes,
  saveAsset,
  saveDocument,
  getSelectedLargeModel,
  getConversations,
  saveConversation,
  deleteConversation,
  generateId,
  getAssistantNotes,
  addAssistantNote,
  deleteAssistantNote,
  getEmbeddingModelConfig,
  getRerankModelConfig,
} from '@/lib/storage'
import { getVectorDocumentsByDocumentId } from '@/lib/pdfCache'
import { getFullTextByKnowledgeId } from '@/lib/pdfCache'
import { searchMyKnowledgeBase as runKnowledgeSearch } from '@/lib/assistantKnowledge'
import { indexKnowledgeForRAG } from '@/lib/rag'
import { getJSON, setJSON } from '@/lib/storage/StorageUtils'
import type { Agent, AppSettings, ModelConfig, AssistantConversation, AssistantMessage, AssistantNote, AssistantToolEvent, AssistantCitation, AssetItem, ArticleAuthor } from '@/lib/types'

import {
  ChainOfThought,
  ChainOfThoughtItem,
  ChainOfThoughtTrigger,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from '@/components/ui/chain-of-thought'
import {
  Citation,
  CitationTrigger,
  CitationContent,
} from '@/components/ui/citation'

const ASSISTANT_CHECKPOINTS_KEY = 'assistant_doc_checkpoints'

interface AssistantDocCheckpoint {
  id: string
  messageId: string
  conversationId?: string
  documentId: string
  documentTitle: string
  content: unknown[]
  articleTitle?: string
  articleAuthors?: ArticleAuthor[]
  articleAbstract?: string
  articleKeywords?: string[]
  articleDate?: string
  createdAt: string
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function getAssistantCheckpoints(): AssistantDocCheckpoint[] {
  if (typeof window === 'undefined') return []
  return getJSON<AssistantDocCheckpoint[]>(ASSISTANT_CHECKPOINTS_KEY, [])
}

function saveAssistantCheckpoints(checkpoints: AssistantDocCheckpoint[]): void {
  if (typeof window === 'undefined') return
  setJSON(ASSISTANT_CHECKPOINTS_KEY, checkpoints)
}

function getAssistantCheckpointById(id: string): AssistantDocCheckpoint | null {
  return getAssistantCheckpoints().find(item => item.id === id) ?? null
}

type StreamingToken = {
  value: string
  isWhitespace: boolean
}

function tokenizeStreamingText(input: string): StreamingToken[] {
  if (!input) return []

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    try {
      const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
      const tokens: StreamingToken[] = []
      for (const segment of segmenter.segment(input)) {
        tokens.push({
          value: segment.segment,
          isWhitespace: /^\s+$/.test(segment.segment),
        })
      }
      return tokens
    } catch {
      // fall through to regex tokenizer
    }
  }

  return (
    input.match(/\s+|[A-Za-z0-9_]+|[\u4e00-\u9fff]|[^\sA-Za-z0-9_\u4e00-\u9fff]/g)?.map(part => ({
      value: part,
      isWhitespace: /^\s+$/.test(part),
    })) ?? []
  )
}

function StreamingTokenizedContent({ text }: { text: string }) {
  const tokens = useMemo(() => tokenizeStreamingText(text), [text])

  if (!text) return null

  return (
    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {tokens.map((token, index) => {
        if (token.isWhitespace) {
          return <span key={`ws-${index}`}>{token.value}</span>
        }

        return (
          <motion.span
            key={`tk-${index}`}
            initial={{ opacity: 0, y: 2, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: 'inline-block', willChange: 'opacity, transform, filter' }}
          >
            {token.value}
          </motion.span>
        )
      })}
    </div>
  )
}

export function AssistantChatPanel() {
  const [conversations, setConversations] = useState<AssistantConversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<AssistantConversation | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [useKnowledge, setUseKnowledge] = useState(false)
  const [useAssets, setUseAssets] = useState(false)
  const [knowledgeBusy, setKnowledgeBusy] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentions, setMentions] = useState<Array<{ id: string; type: 'knowledge' | 'asset'; title: string }>>([])
  const [showHistory, setShowHistory] = useState(false)
  const [notes, setNotes] = useState<AssistantNote[]>([])
  const [noteContent, setNoteContent] = useState('')
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [showNotesList, setShowNotesList] = useState(false)
  const [useDocEditing, setUseDocEditing] = useState(false)
  // 选中文本引用
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null)
  // edit tool state: key = `${msgId}:${blockIdx}` or `${msgId}:simple:${idx}`
  const [editStates, setEditStates] = useState<Record<string, {
    status: EditStatus;
    progress: string;
    error: string;
    toolCall?: ParsedToolCall;
  }>>({})
  const editAbortRefs = useRef<Record<string, AbortController>>({})
  
  // Python 代码块运行状态: key = `${msgId}:${blockIdx}`
  const [codeBlockStates, setCodeBlockStates] = useState<Record<string, CodeBlockState>>({})
  
  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  const getCodeHash = useCallback((str: string) => {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash |= 0
    }
    return Math.abs(hash).toString(36)
  }, [])

  const { isOpen: isNoteModalOpen, onOpen: onNoteModalOpen, onClose: onNoteModalClose } = useDisclosure()
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const focusInput = useCallback(() => {
    const textarea = inputContainerRef.current?.querySelector('textarea')
    textarea?.focus()
  }, [])

  // 加载数据
  useEffect(() => {
    setAgents(getAgents())
    setSettings(getSettings())
    setConversations(getConversations())
    setNotes(getAssistantNotes())
  }, [])

  // 监听编辑器选中文本事件
  useEffect(() => {
    const handleQuote = (e: CustomEvent<{ text: string }>) => {
      if (e.detail?.text) {
        setSelectedQuote(e.detail.text.trim())
      }
    }
    window.addEventListener('assistant-quote', handleQuote as EventListener)
    return () => window.removeEventListener('assistant-quote', handleQuote as EventListener)
  }, [])

  // 滚动到底部 - 已禁用自动滚动（不要光标滚动了）
  // useEffect(() => {
  //   messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  // }, [currentConversation?.messages])

  const [isComposing, setIsComposing] = useState(false)

  const handleInputValueChange = useCallback((nextValue: string) => {
    const normalizedValue = nextValue.trim()
    const isSlashTrigger = normalizedValue === '/' || normalizedValue === '／' || normalizedValue === '、'

    if (!showSlashMenu && isSlashTrigger && normalizedValue.length === 1 && !isComposing) {
      setShowSlashMenu(true)
      setInputValue('')
      return
    }

    if (showSlashMenu && nextValue.trim().length > 0) {
      setShowSlashMenu(false)
    }

    const mentionMatch = nextValue.match(/(?:^|\s)@([^\s@]*)$/)
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1] || '')
      setShowMentionMenu(true)
    } else {
      setMentionQuery('')
      setShowMentionMenu(false)
    }

    setInputValue(nextValue)
  }, [showSlashMenu, isComposing])

  // 处理输入法状态
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    setIsComposing(false)
    // 中文输入法输入完成后检查是否为 / 触发
    const value = e.data || ''
    if (value === '/' || value === '／' || value === '、') {
      if (!showSlashMenu && inputValue.trim().length === 0) {
        setShowSlashMenu(true)
        setInputValue('')
        return
      }
    }
    // 也检查当前输入框的值
    const textarea = e.currentTarget
    if (textarea.value.trim() === '/' && !showSlashMenu) {
      setShowSlashMenu(true)
      setInputValue('')
    }
  }, [showSlashMenu, inputValue])

  // 处理输入框按键
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 使用 e.key 和 e.which 双重检测，兼容中文输入法
    const isSlashKey = e.key === '/' || e.key === '／' || e.key === '、' || e.which === 191 || e.keyCode === 191

    if (isSlashKey && !showSlashMenu && inputValue.trim().length === 0 && !isComposing) {
      e.preventDefault()
      setShowSlashMenu(true)
      return
    }

    if (e.key === 'Escape' && (showSlashMenu || showMentionMenu)) {
      setShowSlashMenu(false)
      setShowMentionMenu(false)
    }
  }

  const handleSlashAction = useCallback((key: React.Key) => {
    const value = String(key)

    if (value === 'command-knowledge') {
      setUseKnowledge(current => !current)
    } else if (value === 'command-assets') {
      setUseAssets(current => !current)
    } else if (value === 'agent:none') {
      handleRemoveAgent()
    } else if (value.startsWith('agent:')) {
      const agentId = value.replace('agent:', '')
      const agent = agents.find(item => item.id === agentId)
      if (agent) {
        handleSelectAgent(agent)
      }
    }

    setShowSlashMenu(false)
    focusInput()
  }, [agents, focusInput])

  const buildAssetContentBlocks = useCallback((text: string): unknown[] => {
    const lines = text
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean)
      .slice(0, 200)

    return lines.map(line => ({
      type: 'paragraph',
      content: [{ type: 'text', text: line, styles: {} }],
    }))
  }, [])

  const handleAddToAssets = useCallback((message: AssistantMessage) => {
    const assetTypes = getAssetTypes()
    const preferredTypeId = assetTypes.some(t => t.id === 'note')
      ? 'note'
      : (assetTypes[0]?.id ?? 'note')

    const firstLine = message.content
      .split('\n')
      .map(line => line.trim())
      .find(Boolean)

    const baseTitle = firstLine || '助手回答'
    const title = baseTitle.length > 28 ? `${baseTitle.slice(0, 28)}…` : baseTitle
    const now = new Date().toISOString()

    const asset: AssetItem = {
      id: generateId(),
      title: `AI：${title}`,
      typeId: preferredTypeId,
      summary: message.content.trim().slice(0, 280),
      content: buildAssetContentBlocks(message.content),
      tags: ['assistant'],
      createdAt: now,
      updatedAt: now,
    }

    saveAsset(asset)
    addToast({ title: '已添加到资产库', color: 'success' })
  }, [buildAssetContentBlocks])

  // 选择智能体
  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent)
    setShowSlashMenu(false)

    if (currentConversation) {
      const updated: AssistantConversation = {
        ...currentConversation,
        agentId: agent.id,
        updatedAt: new Date().toISOString(),
      }
      setCurrentConversation(updated)
      saveConversation(updated)
      setConversations(getConversations())
    }
    focusInput()
  }

  // 移除智能体
  const handleRemoveAgent = () => {
    setSelectedAgent(null)
    if (currentConversation) {
      const updated: AssistantConversation = {
        ...currentConversation,
        agentId: undefined,
        updatedAt: new Date().toISOString(),
      }
      setCurrentConversation(updated)
      saveConversation(updated)
      setConversations(getConversations())
    }
    focusInput()
  }

  const buildAssetContext = useCallback((query: string) => {
    const assets = getAssets()
    const assetTypes = getAssetTypes()
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2)

    const ranked = assets
      .map(asset => {
        const assetType = assetTypes.find(type => type.id === asset.typeId)
        const haystack = [
          asset.title,
          asset.summary,
          ...(asset.tags || []),
          assetType?.name,
        ].filter(Boolean).join('\n').toLowerCase()

        const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0)
        return { asset, assetType, score }
      })
      .filter(entry => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)

    if (ranked.length === 0) {
      return ''
    }

    return ranked.map(({ asset, assetType }) => [
      `标题：${asset.title}`,
      assetType?.name ? `类型：${assetType.name}` : '',
      asset.summary ? `摘要：${asset.summary}` : '',
      asset.tags?.length ? `标签：${asset.tags.join('、')}` : '',
    ].filter(Boolean).join('\n')).join('\n\n---\n\n')
  }, [])

  const extractBlockNoteText = useCallback((value: unknown): string => {
    const extractInlineText = (inline: unknown): string => {
      if (typeof inline === 'string') return inline
      if (!inline) return ''
      if (Array.isArray(inline)) {
        return inline.map(item => extractInlineText(item)).filter(Boolean).join('')
      }
      if (typeof inline !== 'object') return ''

      const record = inline as Record<string, unknown>
      return [
        typeof record.text === 'string' ? record.text : '',
        extractInlineText(record.content),
        extractInlineText(record.children),
      ].filter(Boolean).join('')
    }

    const visit = (node: unknown): string => {
      if (typeof node === 'string') return node
      if (typeof node === 'number' || typeof node === 'boolean') return String(node)
      if (!node) return ''

      if (Array.isArray(node)) {
        return node.map(item => visit(item)).filter(Boolean).join('\n')
      }

      if (typeof node !== 'object') {
        return ''
      }

      const record = node as Record<string, unknown>

      const contentRecord = typeof record.content === 'object' && record.content !== null
        ? record.content as Record<string, unknown>
        : null

      if (contentRecord?.type === 'tableContent' && Array.isArray(contentRecord.rows)) {
        const tableRows = contentRecord.rows
          .map(row => {
            if (!row || typeof row !== 'object') return ''
            const rowRecord = row as Record<string, unknown>
            if (!Array.isArray(rowRecord.cells)) return ''

            const cellTexts = rowRecord.cells
              .map(cell => extractInlineText(cell).replace(/\s+/g, ' ').trim())
              .filter(Boolean)

            return cellTexts.join(' | ')
          })
          .filter(Boolean)

        const blockText = extractInlineText(record.content).replace(/\s+/g, ' ').trim()
        return [blockText, ...tableRows].filter(Boolean).join('\n')
      }

      const tableRows = [record.rows, record.children, record.content]
        .filter(Array.isArray)
        .flatMap(item => item as unknown[])
        .filter(row => typeof row === 'object' && row !== null && (
          Array.isArray((row as Record<string, unknown>).cells)
          || Array.isArray((row as Record<string, unknown>).content)
          || Array.isArray((row as Record<string, unknown>).children)
        ))

      if (tableRows.length > 0 || record.type === 'table' || record.type === 'tableRow' || record.type === 'tableCell') {
        const formattedRows = tableRows.map(row => {
          const rowRecord = row as Record<string, unknown>
          const cells = [rowRecord.cells, rowRecord.content, rowRecord.children]
            .filter(Array.isArray)
            .flatMap(item => item as unknown[])
          return cells.map(cell => visit(cell).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')
        }).filter(Boolean)

        const looseTableParts = [
          visit(record.caption),
          visit(record.header),
          visit(record.footer),
        ].filter(Boolean)

        return [...looseTableParts, ...formattedRows].join('\n')
      }

      return [
        visit(record.text),
        visit(record.content),
        visit(record.children),
        visit(record.props),
        visit(record.cells),
        visit(record.rows),
      ].filter(Boolean).join('\n')
    }

    return visit(value)
  }, [])

  const buildTextBlocks = useCallback((documentId: string, text: string) => {
    return text
      .split(/\n{2,}/)
      .map(part => part.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((part, index) => ({
        id: `${documentId}-block-${index + 1}`,
        type: 'paragraph' as const,
        text: part.slice(0, 1200),
        bbox: { x: 0, y: 0, width: 0, height: 0 },
        style: { fontSize: 12, fontFamily: 'system-ui', isBold: false, isItalic: false },
        pageNum: index + 1,
        itemIds: [],
      }))
  }, [])

  const mentionCandidates = useMemo(() => {
    const keyword = mentionQuery.trim().toLowerCase()
    const knowledgeItems = getKnowledgeItems().map(item => ({
      id: item.id,
      type: 'knowledge' as const,
      title: item.title,
      subtitle: item.cachedSummary || item.abstract || item.authors?.join('、') || '知识库条目',
    }))
    const assetItems = getAssets().map(asset => ({
      id: asset.id,
      type: 'asset' as const,
      title: asset.title,
      subtitle: asset.summary || asset.tags?.join('、') || '资产库条目',
    }))

    return [...knowledgeItems, ...assetItems]
      .filter(item => !mentions.some(mention => mention.id === item.id && mention.type === item.type))
      .filter(item => !keyword || item.title.toLowerCase().includes(keyword) || item.subtitle.toLowerCase().includes(keyword))
      .slice(0, 8)
  }, [mentionQuery, mentions])

  const getMentionDisplayText = useCallback((mention: { id: string; type: 'knowledge' | 'asset'; title: string }) => {
    const typeLabel = mention.type === 'knowledge' ? '知识' : '资产'
    return `@${typeLabel}:${mention.title}`
  }, [])

  const handleMentionSelect = useCallback((candidate: { id: string; type: 'knowledge' | 'asset'; title: string }) => {
    setMentions(prev => [...prev, candidate])
    setInputValue(prev => {
      const mentionText = getMentionDisplayText(candidate)
      const withoutQuery = prev.replace(/(?:^|\s)@([^\s@]*)$/, ' ')
      const normalized = withoutQuery.replace(/\s+/g, ' ').trim()
      return normalized ? `${normalized} ${mentionText} ` : `${mentionText} `
    })
    setMentionQuery('')
    setShowMentionMenu(false)
    requestAnimationFrame(() => {
      focusInput()
    })
  }, [focusInput, getMentionDisplayText])

  useEffect(() => {
    setMentions(prev => {
      const filtered = prev.filter(item => inputValue.includes(getMentionDisplayText(item)))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [inputValue, getMentionDisplayText])

  const removeMention = useCallback((id: string, type: 'knowledge' | 'asset') => {
    setMentions(prev => prev.filter(item => !(item.id === id && item.type === type)))
  }, [])

  const createPreEditCheckpoint = useCallback((message: AssistantMessage): string | null => {
    if (message.checkpointId) return message.checkpointId

    const editor = getEditor()
    if (!editor) return null

    const currentDocId = getLastDocId()
    if (!currentDocId) return null

    const currentDoc = getDocument(currentDocId)
    if (!currentDoc) return null

    const checkpointId = generateId()
    const checkpoint: AssistantDocCheckpoint = {
      id: checkpointId,
      messageId: message.id,
      conversationId: currentConversation?.id,
      documentId: currentDoc.id,
      documentTitle: currentDoc.title,
      content: deepClone((editor.document || []) as unknown[]),
      articleTitle: currentDoc.articleTitle,
      articleAuthors: currentDoc.articleAuthors,
      articleAbstract: currentDoc.articleAbstract,
      articleKeywords: currentDoc.articleKeywords,
      articleDate: currentDoc.articleDate,
      createdAt: new Date().toISOString(),
    }

    const all = getAssistantCheckpoints()
    all.push(checkpoint)
    saveAssistantCheckpoints(all)

    return checkpointId
  }, [currentConversation?.id])

  const handleRestoreCheckpoint = useCallback((message: AssistantMessage) => {
    if (!message.checkpointId) {
      addToast({ title: '未找到检查点', color: 'warning' })
      return
    }

    const checkpoint = getAssistantCheckpointById(message.checkpointId)
    if (!checkpoint) {
      addToast({ title: '检查点不存在或已失效', color: 'warning' })
      return
    }

    const editor = getEditor()
    if (!editor) {
      addToast({ title: '编辑器未就绪', color: 'warning' })
      return
    }

    try {
      const currentBlocks = [...editor.document]
      editor.replaceBlocks(currentBlocks as any, checkpoint.content as any)

      const doc = getDocument(checkpoint.documentId)
      if (doc) {
        saveDocument({
          ...doc,
          content: deepClone(checkpoint.content),
          articleTitle: checkpoint.articleTitle,
          articleAuthors: checkpoint.articleAuthors,
          articleAbstract: checkpoint.articleAbstract,
          articleKeywords: checkpoint.articleKeywords,
          articleDate: checkpoint.articleDate,
          updatedAt: new Date().toISOString(),
        })
      }

      addToast({ title: '已还原到检查点', color: 'success' })
    } catch {
      addToast({ title: '还原失败', color: 'danger' })
    }
  }, [])

  const buildMentionKnowledgeCandidates = useCallback(async (query: string, options?: { allowIndexing?: boolean }) => {
    const focusedResults: AssistantCitation[] = []
    const knowledgeMentions = mentions.filter(item => item.type === 'knowledge')
    const assetMentions = mentions.filter(item => item.type === 'asset')
    const normalizedQuery = query.trim().toLowerCase()
    const allowIndexing = options?.allowIndexing ?? false

    for (const mention of knowledgeMentions) {
      const knowledge = getKnowledgeItems().find(item => item.id === mention.id)
      if (!knowledge) continue

      if (knowledge.cachedSummary || knowledge.abstract) {
        focusedResults.push({
          id: `mention-overview-${knowledge.id}`,
          knowledgeItemId: knowledge.id,
          title: knowledge.title,
          excerpt: [knowledge.cachedSummary, knowledge.abstract].filter(Boolean).join('\n\n'),
          score: 0.98,
          sourceKind: 'overview',
          year: knowledge.year,
          journal: knowledge.journal,
          authors: knowledge.authors,
        })
      }

      let vectorDocuments = await getVectorDocumentsByDocumentId(knowledge.id)
      if (!vectorDocuments.length && knowledge.hasImmersiveCache && allowIndexing) {
        const fullText = await getFullTextByKnowledgeId(knowledge.id)
        const blocks = buildTextBlocks(knowledge.id, fullText || '')
        if (blocks.length) {
          await indexKnowledgeForRAG({ documentId: knowledge.id, blocks, forceLocal: true })
          vectorDocuments = await getVectorDocumentsByDocumentId(knowledge.id)
        }
      }

      if (!vectorDocuments.length && knowledge.hasImmersiveCache) {
        const fullText = await getFullTextByKnowledgeId(knowledge.id)
        const paragraphs = (fullText || '')
          .split(/\n{2,}/)
          .map(part => part.trim())
          .filter(Boolean)
          .sort((a, b) => {
            const aScore = normalizedQuery && a.toLowerCase().includes(normalizedQuery) ? 1 : 0
            const bScore = normalizedQuery && b.toLowerCase().includes(normalizedQuery) ? 1 : 0
            return bScore - aScore
          })
          .slice(0, 3)

        paragraphs.forEach((paragraph, index) => {
          focusedResults.push({
            id: `mention-fulltext-direct-${knowledge.id}-${index}`,
            knowledgeItemId: knowledge.id,
            title: knowledge.title,
            excerpt: paragraph,
            score: normalizedQuery && paragraph.toLowerCase().includes(normalizedQuery) ? 0.96 : 0.86,
            sourceKind: 'fulltext',
            year: knowledge.year,
            journal: knowledge.journal,
            authors: knowledge.authors,
          })
        })
      }

      const matchedVectors = vectorDocuments
        .map(doc => ({
          ...doc,
          score: normalizedQuery && doc.text.toLowerCase().includes(normalizedQuery) ? 0.99 : 0.9,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      matchedVectors.forEach((doc, index) => {
        focusedResults.push({
          id: `mention-fulltext-${knowledge.id}-${index}`,
          knowledgeItemId: knowledge.id,
          title: knowledge.title,
          excerpt: doc.text,
          score: doc.score,
          sourceKind: 'fulltext',
          pageNum: doc.metadata?.pageNum ?? undefined,
          year: knowledge.year,
          journal: knowledge.journal,
          authors: knowledge.authors,
        })
      })
    }

    for (const mention of assetMentions) {
      const asset = getAssets().find(item => item.id === mention.id)
      if (!asset) continue
      const fullText = extractBlockNoteText(asset.content || asset.summary || '')
      if (!fullText.trim()) continue

      const paragraphs = fullText
        .split(/\n{2,}/)
        .map(part => part.trim())
        .filter(Boolean)
        .sort((a, b) => {
          const aScore = normalizedQuery && a.toLowerCase().includes(normalizedQuery) ? 1 : 0
          const bScore = normalizedQuery && b.toLowerCase().includes(normalizedQuery) ? 1 : 0
          return bScore - aScore
        })
        .slice(0, 3)

      paragraphs.forEach((paragraph, index) => {
        focusedResults.push({
          id: `mention-asset-${asset.id}-${index}`,
          knowledgeItemId: asset.id,
          title: asset.title,
          excerpt: paragraph,
          score: normalizedQuery && paragraph.toLowerCase().includes(normalizedQuery) ? 0.97 : 0.88,
          sourceKind: 'asset',
        })
      })
    }

    return focusedResults
      .sort((left, right) => right.score - left.score)
      .slice(0, 8)
  }, [mentions, buildTextBlocks, extractBlockNoteText])

  // 运行 Python 代码
  const runPythonCode = useCallback(async (code: string, blockKey: string) => {
    setCodeBlockStates(prev => ({
      ...prev,
      [blockKey]: { isRunning: true, result: null, showOutput: true }
    }))

    try {
      const response = await fetch('/api/python/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, timeout: 60000 })
      })

      const result: PythonRunResult = await response.json()
      
      setCodeBlockStates(prev => ({
        ...prev,
        [blockKey]: { isRunning: false, result, showOutput: true }
      }))

      if (!result.success) {
        addToast({ title: 'Python 执行失败', description: result.stderr.slice(0, 100), color: 'danger' })
      }
    } catch (error) {
      setCodeBlockStates(prev => ({
        ...prev,
        [blockKey]: { 
          isRunning: false, 
          result: { 
            success: false, 
            stdout: '', 
            stderr: error instanceof Error ? error.message : '网络错误',
            exitCode: -1,
            executionTime: 0,
            images: []
          },
          showOutput: true 
        }
      }))
      addToast({ title: '执行失败', color: 'danger' })
    }
  }, [])

  // 上传图片到服务器（支持 URL 或 base64）
  const uploadImageToServer = useCallback(async (imageSource: string): Promise<string> => {
    // 如果已经是服务器 URL，直接返回
    if (imageSource.startsWith('/uploads/')) {
      return imageSource
    }
    
    // 如果是 base64，上传到服务器
    if (imageSource.startsWith('data:image')) {
      const mimeType = imageSource.match(/^data:(image\/[-+.\w]+)[;,]/)?.[1] || 'image/png'
      const ext = mimeType.includes('svg')
        ? 'svg'
        : (mimeType.split('/')[1] || 'png').replace('jpeg', 'jpg').split('+')[0]
      const blob = await fetch(imageSource).then(res => res.blob())
      const file = new File([blob], `assistant-image.${ext}`, { type: mimeType })
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) {
        throw new Error('图片上传失败')
      }
      
      const data = await response.json()
      return data.url
    }
    
    // 如果是其他 URL，直接返回
    return imageSource
  }, [])

  // 将图片插入编辑器
  const insertImageToEditor = useCallback(async (imageSource: string) => {
    const editor = getEditor()
    if (!editor) {
      addToast({ title: '编辑器未就绪', color: 'warning' })
      return
    }

    try {
      // 确保图片是服务器 URL
      const imageUrl = await uploadImageToServer(imageSource)
      
      // 使用 BlockNote API 插入图片块（正确的 ImageBlock 结构）
      editor.insertBlocks([
        {
          type: 'image',
          props: {
            backgroundColor: 'default',
            textAlignment: 'center',
            name: 'ai-generated-image.png',
            url: imageUrl,
            caption: 'AI 生成的图片',
            showPreview: true,
            previewWidth: undefined,
          },
        }
      ], editor.getTextCursorPosition().block, 'after')
      addToast({ title: '图片已插入编辑器', color: 'success' })
    } catch (error) {
      console.error('插入图片失败:', error)
      addToast({ title: '插入图片失败', description: '请确保编辑器支持图片块', color: 'danger' })
    }
  }, [uploadImageToServer])

  // 将图片添加到资产库
  const addImageToAssets = useCallback(async (imageSource: string, title?: string) => {
    try {
      // 确保图片是服务器 URL
      const imageUrl = await uploadImageToServer(imageSource)
      
      const assetTypes = getAssetTypes()
      const preferredTypeId = assetTypes.some(t => t.id === 'image') 
        ? 'image' 
        : (assetTypes[0]?.id ?? 'note')

      const now = new Date().toISOString()
      const asset: AssetItem = {
        id: generateId(),
        title: title || `AI生成图片 ${new Date().toLocaleString('zh-CN')}`,
        typeId: preferredTypeId,
        summary: '由 Python 代码生成的图片',
        content: [{
          type: 'image',
          props: {
            backgroundColor: 'default',
            textAlignment: 'center',
            name: 'ai-generated-image.png',
            url: imageUrl,
            caption: 'Python 生成的图片',
            showPreview: true,
            previewWidth: undefined,
          },
        }],
        tags: ['python', 'generated', 'image'],
        createdAt: now,
        updatedAt: now,
      }

      saveAsset(asset)
      addToast({ title: '图片已添加到资产库', color: 'success' })
    } catch (error) {
      console.error('添加到资产库失败:', error)
      addToast({ title: '添加失败', color: 'danger' })
    }
  }, [uploadImageToServer])

  const MermaidCodeBlock = ({ codeContent, blockKey }: { codeContent: string; blockKey: string }) => {
    const [activeTab, setActiveTab] = useState<'code' | 'preview'>('preview')
    const [previewUrl, setPreviewUrl] = useState('')
    const [isRendering, setIsRendering] = useState(false)
    const [renderError, setRenderError] = useState('')

    useEffect(() => {
      let disposed = false

      const renderMermaid = async () => {
        if (!codeContent.trim()) {
          setPreviewUrl('')
          setRenderError('')
          return
        }

        setIsRendering(true)
        setRenderError('')

        try {
          const mermaidModule = await import('mermaid')
          const mermaid = mermaidModule.default

          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'default',
          })

          const renderId = `assistant-mermaid-${blockKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
          const { svg } = await mermaid.render(renderId, codeContent)
          const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

          if (!disposed) {
            setPreviewUrl(dataUrl)
            setRenderError('')
          }
        } catch (error) {
          if (!disposed) {
            setPreviewUrl('')
            setRenderError(error instanceof Error ? error.message : 'Mermaid 渲染失败')
          }
        } finally {
          if (!disposed) {
            setIsRendering(false)
          }
        }
      }

      void renderMermaid()

      return () => {
        disposed = true
      }
    }, [codeContent, blockKey])

    return (
      <div style={{ position: 'relative', margin: '8px 0' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          padding: '4px 12px',
          borderRadius: '6px 6px 0 0',
          fontSize: 11,
          color: 'var(--text-muted)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>mermaid</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setActiveTab('code')}
                style={{
                  background: activeTab === 'code' ? 'var(--bg-primary)' : 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  color: activeTab === 'code' ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                代码
              </button>
              <button
                onClick={() => setActiveTab('preview')}
                style={{
                  background: activeTab === 'preview' ? 'var(--bg-primary)' : 'transparent',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 10,
                  color: activeTab === 'preview' ? 'var(--text-primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                预览
              </button>
            </div>
          </div>
          <button
            onClick={() => handleCopy(codeContent)}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 10,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            复制
          </button>
        </div>

        {activeTab === 'code' ? (
          <pre style={{
            background: 'var(--bg-secondary)',
            padding: 12,
            margin: 0,
            borderRadius: '0 0 6px 6px',
            overflow: 'auto',
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            <code>{codeContent}</code>
          </pre>
        ) : (
          <div style={{
            background: 'var(--bg-secondary)',
            padding: 12,
            margin: 0,
            borderRadius: '0 0 6px 6px',
            display: 'grid',
            gap: 10,
          }}>
            {isRendering ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                <Spinner size="sm" />
                <span>正在渲染 Mermaid…</span>
              </div>
            ) : renderError ? (
              <div style={{ fontSize: 12, color: '#ef4444', whiteSpace: 'pre-wrap' }}>{renderError}</div>
            ) : previewUrl ? (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>点击缩略图可放大预览</div>
                <img
                  src={previewUrl}
                  alt="Mermaid 预览"
                  onClick={() => setPreviewImage(previewUrl)}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 260,
                    borderRadius: 6,
                    border: '1px solid var(--border-color)',
                    background: 'white',
                    cursor: 'pointer',
                    objectFit: 'contain',
                  }}
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => insertImageToEditor(previewUrl)}
                    style={{
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      padding: '4px 10px',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    添加到编辑器
                  </button>
                  <button
                    onClick={() => addImageToAssets(previewUrl, 'Mermaid 图表')}
                    style={{
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      padding: '4px 10px',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    添加到资产库
                  </button>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>暂无可预览内容</div>
            )}
          </div>
        )}
      </div>
    )
  }

  const citationMarkerRegex = /<cite:(\d+)>|cite:\[(\d+)\]/g

  const hasCitationMarkers = useCallback((content: string) => {
    citationMarkerRegex.lastIndex = 0
    return citationMarkerRegex.test(content)
  }, [])

  // 解析消息内容中的 <cite:N> / cite:[N] 标记并渲染为 Citation 组件
  const renderMessageWithCitations = useCallback((
    content: string,
    citations: AssistantCitation[] | undefined,
    renderMarkdownSegment: (segment: string, key: string) => React.ReactNode,
  ) => {
    if (!citations || citations.length === 0) {
      return renderMarkdownSegment(content, 'segment-0')
    }

    const citeRegex = /<cite:(\d+)>|cite:\[(\d+)\]/g
    const parts: React.ReactNode[] = []
    let lastIndex = 0
    let match
    let citeIndex = 0

    while ((match = citeRegex.exec(content)) !== null) {
      // Add text before the cite tag
      if (match.index > lastIndex) {
        const segment = content.slice(lastIndex, match.index)
        if (segment) {
          parts.push(renderMarkdownSegment(segment, `segment-${citeIndex}-${lastIndex}`))
        }
      }

      const citeNum = parseInt(match[1] || match[2], 10)
      const citation = citations[citeNum - 1]

      if (citation) {
        parts.push(
          <Citation
            key={`cite-${citeIndex++}`}
            title={citation.title}
            sourceKind={citation.sourceKind}
            pageNum={citation.pageNum}
            year={citation.year}
            journal={citation.journal}
            authors={citation.authors}
            excerpt={citation.excerpt}
            index={citeNum}
          >
            <CitationTrigger />
            <CitationContent />
          </Citation>
        )
      } else {
        // If citation not found, render a fallback badge
        parts.push(
          <span key={`cite-fallback-${citeIndex++}`} className="inline-flex h-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
            {citeNum}
          </span>
        )
      }

      lastIndex = match.index + match[0].length
    }

    // Add remaining text
    if (lastIndex < content.length) {
      const segment = content.slice(lastIndex)
      if (segment) {
        parts.push(renderMarkdownSegment(segment, `segment-tail-${lastIndex}`))
      }
    }

    return parts.length > 0 ? parts : renderMarkdownSegment(content, 'segment-final')
  }, [])

  // 从内容中移除 <cite:N> / cite:[N] 标记（用于纯文本流式渲染）
  const stripCitationsFromContent = useCallback((content: string) => {
    return content.replace(/<cite:\d+>|cite:\[\d+\]/g, '')
  }, [])

  const handleCopy = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      addToast({ title: '已复制到剪贴板', color: 'success' })
    } catch {
      addToast({ title: '复制失败', color: 'danger' })
    }
  }

  // 打开便签模态框
  const handleOpenNote = (messageId: string, content: string) => {
    setActiveMessageId(messageId)
    setNoteContent(content)
    onNoteModalOpen()
  }

  // 保存便签
  const handleSaveNote = () => {
    if (!noteContent.trim()) {
      addToast({ title: '便签内容不能为空', color: 'warning' })
      return
    }
    
    addAssistantNote({
      content: noteContent,
      messageId: activeMessageId || undefined,
      conversationId: currentConversation?.id,
    })
    
    setNotes(getAssistantNotes())
    onNoteModalClose()
    setNoteContent('')
    setActiveMessageId(null)
    addToast({ title: '已保存到临时便签', color: 'success' })
  }

  // 删除便签
  const handleDeleteNote = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteAssistantNote(id)
    setNotes(getAssistantNotes())
    addToast({ title: '已删除', color: 'success' })
  }

  // 点击便签定位到消息
  const handleNoteClick = (note: AssistantNote) => {
    if (note.messageId && note.conversationId) {
      // 如果不是当前对话，先切换
      if (currentConversation?.id !== note.conversationId) {
        const conv = conversations.find(c => c.id === note.conversationId)
        if (conv) {
          setCurrentConversation(conv)
          if (conv.agentId) {
            const agent = agents.find(a => a.id === conv.agentId)
            if (agent) setSelectedAgent(agent)
          }
        }
      }
      
      // 延迟滚动，等待渲染
      setTimeout(() => {
        const messageEl = messageRefs.current.get(note.messageId!)
        if (messageEl) {
          messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // 高亮效果
          messageEl.style.transition = 'background 0.3s'
          messageEl.style.background = 'rgba(0, 153, 255, 0.1)'
          setTimeout(() => {
            messageEl.style.background = 'transparent'
          }, 2000)
        }
      }, 100)
    }
    setShowNotesList(false)
  }

  // 新建对话
  const handleNewConversation = () => {
    const newConv: AssistantConversation = {
      id: generateId(),
      title: '新对话',
      messages: [],
      agentId: selectedAgent?.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setCurrentConversation(newConv)
    setInputValue('')
    setMentions([])
    setMentionQuery('')
    setShowMentionMenu(false)
    setShowSlashMenu(false)
    setShowHistory(false)
  }

  // 选择对话
  const handleSelectConversation = (conv: AssistantConversation) => {
    setCurrentConversation(conv)
    if (conv.agentId) {
      const agent = agents.find(a => a.id === conv.agentId)
      if (agent) setSelectedAgent(agent)
    }
    setShowHistory(false)
  }

  // 删除对话
  const handleDeleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    deleteConversation(id)
    const updated = getConversations()
    setConversations(updated)
    if (currentConversation?.id === id) {
      setCurrentConversation(null)
    }
    addToast({ title: '已删除', color: 'success' })
  }

  // 发送消息
  const handleSend = useCallback(async () => {
    const content = inputValue.trim()
    if (!content || isLoading) return

    let conv = currentConversation
    if (!conv) {
      conv = {
        id: generateId(),
        title: content.slice(0, 20) + (content.length > 20 ? '...' : ''),
        messages: [],
        agentId: selectedAgent?.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }

    const userMessage: AssistantMessage = {
      id: generateId(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    
    const updatedMessages = [...conv.messages, userMessage]
    setCurrentConversation({
      ...conv,
      messages: updatedMessages,
    })
    setInputValue('')
    setMentionQuery('')
    setShowMentionMenu(false)
    setIsLoading(true)

    const assistantMessage: AssistantMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      toolEvents: [],
      citations: [],
      createdAt: new Date().toISOString(),
    }

    try {
      const modelConfig = settings ? getSelectedLargeModel(settings) : null
      if (!modelConfig?.apiKey) {
        addToast({ title: '请先配置模型 API Key', color: 'warning' })
        setIsLoading(false)
        return
      }

      const systemPrompt = selectedAgent?.prompt || ''
      let knowledgeCandidates: AssistantCitation[] = []
      const assetContext = useAssets ? buildAssetContext(content) : ''

      // Auto-read document content when doc editing is enabled
      let docContextText = ''
      if (useDocEditing) {
        const freshDoc = readDocument()
        if (freshDoc) {
          docContextText = `\n\n当前编辑器文档内容（Markdown格式）：\n\`\`\`\n${freshDoc.markdown.slice(0, 8000)}\n\`\`\``
        }
      }

      // 用户选中的文本引用
      let quoteContext = ''
      if (selectedQuote) {
        quoteContext = `\n\n用户选中的文本内容（请基于此内容回答）：\n> ${selectedQuote.split('\n').join('\n> ')}`
      }
      const mentionCandidates = mentions.length > 0
        ? await buildMentionKnowledgeCandidates(content, { allowIndexing: useKnowledge })
        : []
      const shouldRunGlobalKnowledgeSearch = useKnowledge
      const shouldSendKnowledgeContext = mentionCandidates.length > 0 || shouldRunGlobalKnowledgeSearch

      if (shouldRunGlobalKnowledgeSearch) {
        setKnowledgeBusy(true)
        assistantMessage.toolEvents = [{
          id: 'knowledge-hybrid-search',
          toolName: 'knowledgeHybridSearch',
          status: 'running',
          message: '正在混合检索知识库概要与精读全文…',
        }]
        setCurrentConversation(prev => {
          if (!prev) return prev
          return {
            ...prev,
            messages: [...updatedMessages, { ...assistantMessage }],
          }
        })

        knowledgeCandidates = await runKnowledgeSearch(
          content,
          settings ? getEmbeddingModelConfig(settings) : null,
          settings ? getRerankModelConfig(settings) : null
        )
        knowledgeCandidates = [...mentionCandidates, ...knowledgeCandidates]
          .sort((left, right) => right.score - left.score)
          .filter((candidate, index, array) => array.findIndex(item => item.knowledgeItemId === candidate.knowledgeItemId && item.excerpt === candidate.excerpt && item.sourceKind === candidate.sourceKind) === index)
          .slice(0, 8)
        assistantMessage.toolEvents = [{
          id: 'knowledge-hybrid-search',
          toolName: 'knowledgeHybridSearch',
          status: knowledgeCandidates.length > 0 ? 'success' : 'error',
          message: knowledgeCandidates.length > 0
            ? `已召回 ${knowledgeCandidates.length} 条知识库候选证据`
            : '未召回到可用的知识库证据',
        }]
        assistantMessage.citations = knowledgeCandidates
      } else if (mentionCandidates.length > 0) {
        knowledgeCandidates = mentionCandidates
        assistantMessage.toolEvents = [{
          id: 'mention-focused-search',
          toolName: 'mentionFocusedSearch',
          status: 'success',
          message: `已按提及内容锁定 ${mentionCandidates.length} 条重点证据`,
        }]
        assistantMessage.citations = knowledgeCandidates
        setCurrentConversation(prev => {
          if (!prev) return prev
          return {
            ...prev,
            messages: [...updatedMessages, { ...assistantMessage }],
          }
        })
      }

      abortControllerRef.current = new AbortController()

      // 仅在文档编辑模式时获取文档结构
      const docStructure = useDocEditing ? getDocumentStructure() : null

      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...updatedMessages].map(m => ({
            role: m.role,
            content: m.content,
          })),
          modelConfig,
          systemPrompt: systemPrompt + docContextText + quoteContext,
          useKnowledge: shouldSendKnowledgeContext,
          knowledgeCandidates,
          assetContext,
          documentStructure: docStructure || undefined,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error('请求失败')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''
      let buffer = ''

      // Streaming tool detection
      const detector = useDocEditing ? new StreamingToolDetector() : null
      const executedToolIndices = new Set<number>()
      const shownToolIndices = new Set<number>()

      const executeDetectedTool = (idx: number, tool: { type: 'insert' | 'delete' | 'update'; params: Record<string, string>; contentSoFar: string }) => {
        if (executedToolIndices.has(idx)) return
        executedToolIndices.add(idx)

        if (!assistantMessage.checkpointId) {
          const checkpointId = createPreEditCheckpoint(assistantMessage)
          if (checkpointId) {
            applyAssistantUpdate(draft => {
              draft.checkpointId = checkpointId
            })
          }
        }

        const key = `${assistantMessage.id}:simple:${idx}`
        const call: ParsedToolCall = { type: tool.type, params: tool.params, content: tool.contentSoFar }
        const abort = new AbortController()
        editAbortRefs.current[key] = abort

        setEditStates(prev => ({ ...prev, [key]: { status: 'running', progress: '准备中…', error: '', toolCall: call } }))

        const req = convertToolCallsToRequest([call])
        applyEditOperations(
          req,
          (msg) => setEditStates(prev => ({ ...prev, [key]: { ...prev[key], progress: msg } })),
          abort.signal,
          key,
        ).then(result => {
          if (result.success) {
            setEditStates(prev => ({ ...prev, [key]: { status: 'reviewing', progress: '', error: '' } }))
          } else {
            setEditStates(prev => ({ ...prev, [key]: { status: 'error', progress: '', error: result.error || '操作失败' } }))
          }
        })
      }

      const applyAssistantUpdate = (updater: (draft: AssistantMessage) => void) => {
        updater(assistantMessage)
        setCurrentConversation(prev => {
          if (!prev) return prev
          return {
            ...prev,
            messages: [...updatedMessages, { ...assistantMessage }],
          }
        })
      }

      const upsertToolEvent = (nextEvent: AssistantToolEvent) => {
        const currentEvents = assistantMessage.toolEvents || []
        const existingIndex = currentEvents.findIndex(event => event.id === nextEvent.id)
        const nextEvents = [...currentEvents]

        if (existingIndex >= 0) {
          nextEvents[existingIndex] = nextEvent
        } else {
          nextEvents.push(nextEvent)
        }

        applyAssistantUpdate(draft => {
          draft.toolEvents = nextEvents
        })
      }

      const processLine = (line: string) => {
        if (!line.trim()) return
        const payload = JSON.parse(line) as {
          type: 'tool-status' | 'text-delta' | 'citations' | 'error' | 'done'
          id?: string
          toolName?: string
          status?: AssistantToolEvent['status']
          message?: string
          delta?: string
          citations?: AssistantCitation[]
          error?: string
        }

        if (payload.type === 'tool-status' && payload.id && payload.toolName && payload.status && payload.message) {
          upsertToolEvent({
            id: payload.id,
            toolName: payload.toolName,
            status: payload.status,
            message: payload.message,
          })
          return
        }

        if (payload.type === 'citations' && Array.isArray(payload.citations)) {
          applyAssistantUpdate(draft => {
            draft.citations = payload.citations
          })
          return
        }

        if (payload.type === 'text-delta' && payload.delta) {
          fullContent += payload.delta
          applyAssistantUpdate(draft => {
            draft.content = fullContent
          })

          // Streaming tool detection
          if (detector) {
            const { detected, completedIndices } = detector.process(fullContent)
            // Show in-progress tool cards
            detected.forEach((tool, idx) => {
              const key = `${assistantMessage.id}:simple:${idx}`
              if (!tool.isComplete && !executedToolIndices.has(idx) && !shownToolIndices.has(idx)) {
                shownToolIndices.add(idx)
                setEditStates(prev => ({
                  ...prev,
                  [key]: { status: 'running', progress: '正在接收内容…', error: '', toolCall: { type: tool.type, params: tool.params, content: tool.contentSoFar, isComplete: false } }
                }))
              }
            })
            // Execute newly completed tools
            completedIndices.forEach(idx => {
              const tool = detected[idx]
              if (tool) executeDetectedTool(idx, tool)
            })
          }
          return
        }

        if (payload.type === 'error') {
          throw new Error(payload.error || '助手响应失败')
        }
      }

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          buffer += decoder.decode(value, { stream: true })

          let lineBreakIndex = buffer.indexOf('\n')
          while (lineBreakIndex >= 0) {
            const line = buffer.slice(0, lineBreakIndex)
            buffer = buffer.slice(lineBreakIndex + 1)
            processLine(line)
            lineBreakIndex = buffer.indexOf('\n')
          }
        }

        if (buffer.trim()) {
          processLine(buffer)
        }
      }

      const finalConv: AssistantConversation = {
        ...conv,
        title: conv.messages.length === 0 
          ? content.slice(0, 20) + (content.length > 20 ? '...' : '')
          : conv.title,
        messages: [...updatedMessages, { ...assistantMessage }],
        agentId: selectedAgent?.id,
        updatedAt: new Date().toISOString(),
      }
      saveConversation(finalConv)
      setConversations(getConversations())
      setCurrentConversation(finalConv)
      setMentions([])
      setSelectedQuote(null)

      // Final detection pass for any tools that completed at the very end
      if (detector) {
        const { detected } = detector.process(assistantMessage.content)
        detected.forEach((tool, idx) => {
          if (tool.isComplete) executeDetectedTool(idx, tool)
        })
      } else {
        // Fallback: non-doc-editing mode, still handle legacy edit_document blocks
        triggerEditBlocks(assistantMessage.id, assistantMessage.content)
      }

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        if (currentConversation) {
          saveConversation(currentConversation)
        }
      } else {
        addToast({ title: '发送失败，请重试', color: 'danger' })
      }
    } finally {
      setKnowledgeBusy(false)
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [inputValue, isLoading, currentConversation, settings, selectedAgent, useKnowledge, useAssets, useDocEditing, agents, buildAssetContext, mentions, buildMentionKnowledgeCandidates, selectedQuote])

  const messages = currentConversation?.messages || []

  // Parse both simplified format (::insert, ::delete, ::update) and legacy edit_document JSON blocks
  const parseEditBlocks = useCallback((
    content: string,
    options?: { includeIncompleteTools?: boolean },
  ): { requests: EditDocumentRequest[]; toolCalls: ParsedToolCall[] } => {
    const requests: EditDocumentRequest[] = []
    const toolCalls: ParsedToolCall[] = []
    
    // Parse simplified format first
    const simpleCalls = parseSimpleToolCalls(content, {
      includeIncomplete: options?.includeIncompleteTools ?? false,
    })
    if (simpleCalls.length > 0) {
      toolCalls.push(...simpleCalls)
      // Don't add to requests - toolCalls will be handled separately
    }
    
    // Parse legacy format for backwards compatibility
    const regex = /```edit_document\s*([\s\S]*?)```/g
    let match
    while ((match = regex.exec(content)) !== null) {
      try {
        const req = JSON.parse(match[1].trim()) as EditDocumentRequest
        if (req.operations) requests.push(req)
      } catch { /* skip invalid */ }
    }
    
    return { requests, toolCalls }
  }, [])
  
  // Remove tool call syntax from content for display
  const removeToolCallsFromContent = useCallback((content: string): string => {
    return stripSimpleToolSyntax(content)
  }, [])

  // Auto-run edit blocks from a completed assistant message
  const triggerEditBlocks = useCallback((msgId: string, content: string) => {
    const { requests, toolCalls } = parseEditBlocks(content)
    
    // Handle simplified tool calls
    if (toolCalls.length > 0) {
      const msg = messages.find(item => item.id === msgId)
      if (msg && !msg.checkpointId) {
        const checkpointId = createPreEditCheckpoint(msg)
        if (checkpointId && currentConversation) {
          const updatedMessages = currentConversation.messages.map(item =>
            item.id === msgId ? { ...item, checkpointId } : item,
          )
          const updatedConversation: AssistantConversation = {
            ...currentConversation,
            messages: updatedMessages,
            updatedAt: new Date().toISOString(),
          }
          setCurrentConversation(updatedConversation)
          saveConversation(updatedConversation)
          setConversations(getConversations())
        }
      }

      toolCalls.forEach((call, idx) => {
        const key = `${msgId}:simple:${idx}`

        const abort = new AbortController()
        editAbortRefs.current[key] = abort

        setEditStates(prev => ({ ...prev, [key]: { status: 'running', progress: '准备中…', error: '', toolCall: call } }))

        // Convert single tool call to request
        const req = convertToolCallsToRequest([call])

        applyEditOperations(
          req,
          (msg) => setEditStates(prev => ({ ...prev, [key]: { ...prev[key], progress: msg } })),
          abort.signal,
          key,
        ).then(result => {
          if (result.success) {
            setEditStates(prev => ({ ...prev, [key]: { status: 'reviewing', progress: '', error: '' } }))
          } else {
            setEditStates(prev => ({ ...prev, [key]: { status: 'error', progress: '', error: result.error || '操作失败' } }))
          }
        })
      })
    }

    // Handle legacy format
    if (requests.length > 0) {
      const msg = messages.find(item => item.id === msgId)
      if (msg && !msg.checkpointId) {
        const checkpointId = createPreEditCheckpoint(msg)
        if (checkpointId && currentConversation) {
          const updatedMessages = currentConversation.messages.map(item =>
            item.id === msgId ? { ...item, checkpointId } : item,
          )
          const updatedConversation: AssistantConversation = {
            ...currentConversation,
            messages: updatedMessages,
            updatedAt: new Date().toISOString(),
          }
          setCurrentConversation(updatedConversation)
          saveConversation(updatedConversation)
          setConversations(getConversations())
        }
      }

      requests.forEach((req, idx) => {
        const key = `${msgId}:${idx}`
        const abort = new AbortController()
        editAbortRefs.current[key] = abort

        setEditStates(prev => ({ ...prev, [key]: { status: 'running', progress: '准备中…', error: '' } }))

        applyEditOperations(
          req,
          (msg) => setEditStates(prev => ({ ...prev, [key]: { ...prev[key], progress: msg } })),
          abort.signal,
          key,
        ).then(result => {
          if (result.success) {
            setEditStates(prev => ({ ...prev, [key]: { status: 'reviewing', progress: '', error: '' } }))
          } else {
            setEditStates(prev => ({ ...prev, [key]: { status: 'error', progress: '', error: result.error || '操作失败' } }))
          }
        })
      })
    }
  }, [parseEditBlocks, messages, createPreEditCheckpoint, currentConversation])

  // 停止生成
  const handleStop = () => {
    abortControllerRef.current?.abort()
  }

  // 获取模型列表
  const getModels = () => {
    if (!settings) return []
    const models: { id: string; name: string; config: ModelConfig }[] = []
    for (const provider of settings.providers) {
      for (const model of provider.models) {
        // 过滤掉禁用的模型 (enabled 默认为 true)
        if (model.enabled === false) continue
        models.push({
          id: model.id,
          name: `${provider.name} - ${model.name}`,
          config: {
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            modelName: model.modelId,
          },
        })
      }
    }
    return models
  }

  const models = getModels()

  // 标记是否已完成模型选择器的初始化
  const modelSelectorInitializedRef = useRef(false)

  // 仅在初始化时设置默认模型名称（一次性）
  useEffect(() => {
    if (
      !modelSelectorInitializedRef.current &&
      settings?.defaultLargeModelId &&
      models.length > 0
    ) {
      const defaultModel = models.find(m => m.id === settings.defaultLargeModelId)
      if (defaultModel) {
        setModelSearchQuery(defaultModel.name)
        modelSelectorInitializedRef.current = true
      }
    }
  }, [settings?.defaultLargeModelId, models])

  return (
    <div style={{ 
      display: 'flex', 
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* 历史对话侧栏 */}
      {showHistory && (
        <div style={{
          width: 200,
          borderRight: '1px solid var(--border-color)',
          background: 'var(--bg-secondary)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>历史对话</span>
            <Button size="sm" variant="flat" color="primary" onPress={handleNewConversation}>
              新建
            </Button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {conversations.length === 0 ? (
              <div style={{ 
                textAlign: 'center', 
                color: 'var(--text-muted)', 
                fontSize: 12,
                padding: 20,
              }}>
                暂无历史对话
              </div>
            ) : (
              conversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    marginBottom: 4,
                    background: currentConversation?.id === conv.id 
                      ? 'var(--bg-primary)' 
                      : 'transparent',
                    border: currentConversation?.id === conv.id 
                      ? '1px solid var(--accent-color)' 
                      : '1px solid transparent',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ 
                    flex: 1, 
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                  }}>
                    {conv.title}
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 2,
                      fontSize: 10,
                      opacity: 0.6,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.color = '#f44'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.6'
                      e.currentTarget.style.color = 'var(--text-muted)'
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 主区域 */}
      <div style={{ 
        flex: 1,
        display: 'flex', 
        flexDirection: 'column', 
        overflow: 'hidden',
      }}>
        {/* 顶部控制区 */}
        <div style={{ 
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}>
          {/* 模型选择器 + 历史按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip content={showHistory ? '隐藏历史对话' : '打开历史对话'}>
              <Button
                size="sm"
                variant="flat"
                isIconOnly
                onPress={() => setShowHistory(!showHistory)}
                style={{ minWidth: 'auto' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 3v5h5" />
                  <path d="M3.05 13a9 9 0 1 0 .5-4" />
                  <path d="M12 7v6l4 2" />
                </svg>
              </Button>
            </Tooltip>

            <Tooltip content="新建对话">
              <Button
                size="sm"
                variant="flat"
                isIconOnly
                onPress={handleNewConversation}
                style={{ minWidth: 'auto' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </Button>
            </Tooltip>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 40 }}>模型：</span>
            <Autocomplete
              size="sm"
              selectedKey={settings?.defaultLargeModelId || null}
              onSelectionChange={(key) => {
                if (settings && key) {
                  const newSettings = { ...settings, defaultLargeModelId: key as string }
                  setSettings(newSettings)
                  // 视觉回填：更新输入框显示为选中模型的名称
                  const selectedModel = models.find(m => m.id === key)
                  if (selectedModel) {
                    setModelSearchQuery(selectedModel.name)
                  }
                }
              }}
              onClear={() => {
                // 清空选中值和输入框
                setModelSearchQuery('')
                if (settings) {
                  const newSettings = { ...settings, defaultLargeModelId: '' }
                  setSettings(newSettings)
                }
              }}
              inputValue={modelSearchQuery}
              onInputChange={setModelSearchQuery}
              placeholder="搜索并选择模型..."
              style={{ flex: 1 }}
              inputProps={{
                classNames: {
                  input: 'bg-[var(--bg-secondary)]',
                  inputWrapper: 'bg-[var(--bg-secondary)]',
                },
              }}
              startContent={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              }
              allowsCustomValue={false}
            >
              {models.map(model => (
                <AutocompleteItem key={model.id} textValue={model.name}>{model.name}</AutocompleteItem>
              ))}
            </Autocomplete>
          </div>

        </div>

        {/* 对话区域 */}
        <div ref={messagesContainerRef} className="relative flex-1 overflow-hidden px-4 py-3">
          <ChatContainerRoot className="relative h-full w-full space-y-0 overflow-y-auto rounded-xl border border-border/60 bg-background/30">
            <ChatContainerContent className="space-y-8 px-2 py-6">
              {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="flex flex-1 items-center justify-center text-center text-[13px] text-[var(--text-muted)]"
            >
              <div>
                <p style={{ marginBottom: 8 }}>开始与 AI 助手对话</p>
                <p style={{ fontSize: 11, opacity: 0.7 }}>
                  输入 / 可快速切换智能体、知识库和资产库引用
                </p>
              </div>
            </motion.div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {messages.map((message, idx) => (
                <motion.div 
                  key={message.id}
                  ref={(el) => {
                    if (el) messageRefs.current.set(message.id, el)
                  }}
                  layout
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className={`group mx-auto w-full max-w-3xl px-0 md:px-6 ${message.role === 'assistant' ? 'items-start' : 'items-end'}`}
                >
                <Message className={`w-full flex-col gap-2 ${message.role === 'assistant' ? 'items-start' : 'items-end'}`}>
                {/* 角色标签 */}
                <div className="flex items-center gap-2">
                  <div style={{
                    fontSize: 10,
                    color: message.role === 'user' ? 'var(--accent-color)' : 'var(--text-muted)',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {message.role === 'user' ? '你' : '助手'}
                  </div>
                  {/* 助手加载动画 - 圆形旋转边框 */}
                  {message.role === 'assistant' && idx === messages.length - 1 && isLoading && (
                    <div style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      border: '2px solid transparent',
                      borderTopColor: '#3b82f6',
                      borderRightColor: '#3b82f6',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                  )}
                </div>
                
                {/* 内容 */}
                <MessageContent 
                  className="markdown-content"
                  style={message.role === 'assistant'
                    ? {
                        width: '100%',
                        fontSize: 13,
                        lineHeight: 1.7,
                        color: 'var(--text-secondary)',
                        background: 'transparent',
                        padding: 0,
                      }
                    : {
                        maxWidth: '85%',
                        fontSize: 13,
                        lineHeight: 1.7,
                        color: 'var(--text-primary)',
                        background: 'var(--bg-secondary)',
                        padding: '10px 14px',
                        borderRadius: 24,
                      }}
                >
                  {message.role === 'assistant' && message.checkpointId && (
                    <div style={{ marginBottom: 6 }}>
                      <motion.button
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => handleRestoreCheckpoint(message)}
                        style={{
                          background: 'rgba(0, 153, 255, 0.08)',
                          border: '1px solid rgba(0, 153, 255, 0.2)',
                          borderRadius: 6,
                          padding: '3px 10px',
                          fontSize: 11,
                          color: 'var(--accent-color)',
                          cursor: 'pointer',
                          fontWeight: 500,
                        }}
                      >
                        还原检查点
                      </motion.button>
                    </div>
                  )}
                  {message.role === 'assistant' && message.toolEvents && message.toolEvents.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <ChainOfThought>
                        {message.toolEvents.map(event => (
                          <ChainOfThoughtStep key={event.id}>
                            <ChainOfThoughtTrigger
                              leftIcon={
                                <span style={{ color: event.status === 'error' ? '#ef4444' : event.status === 'success' ? '#10b981' : '#f59e0b', fontSize: '10px' }}>●</span>
                              }
                            >
                              {event.message}
                            </ChainOfThoughtTrigger>
                            <ChainOfThoughtContent>
                              <ChainOfThoughtItem>
                                {event.message} - {event.status === 'success' ? '完成' : event.status === 'error' ? '失败' : '执行中'}
                              </ChainOfThoughtItem>
                            </ChainOfThoughtContent>
                          </ChainOfThoughtStep>
                        ))}
                      </ChainOfThought>
                    </div>
                  )}
                  {message.role === 'assistant' ? (
                    <>
                      {idx === messages.length - 1 && isLoading ? (
                        <StreamingTokenizedContent text={removeToolCallsFromContent(stripCitationsFromContent(message.content))} />
                      ) : (
                        <>
                          {(() => {
                            const renderMarkdownSegment = (segment: string, key: string) => {
                              if (!segment.trim()) {
                                return segment
                              }

                              return (
                                <ReactMarkdown
                                  key={key}
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                            code({ node, className, children, ...props }: any) {
                            const codeContent = String(children).replace(/\n$/, '')
                            const isBlock = node?.position?.start?.line !== node?.position?.end?.line || codeContent.includes('\n')
                            const lang = /language-(\w+)/.exec(className || '')?.[1]
                            
                            // Handle legacy edit_document format
                            if (isBlock && lang === 'edit_document') {
                              try {
                                const req: EditDocumentRequest = JSON.parse(codeContent.trim())
                                // find which index this block is in the message
                                const allBlocks = parseEditBlocks(message.content)
                                const blockIdx = allBlocks.requests.findIndex(b => JSON.stringify(b) === JSON.stringify(req))
                                const key = `${message.id}:${blockIdx >= 0 ? blockIdx : 0}`
                                const state = editStates[key] ?? { status: 'idle' as EditStatus, progress: '', error: '' }

                                const handleAccept = () => {
                                  try {
                                    acceptInsertionChanges(key)
                                  } catch {
                                    // ignore errors
                                  }
                                  setEditStates(prev => ({ ...prev, [key]: { status: 'accepted', progress: '', error: '' } }))
                                  const editor = getEditor()
                                  if (editor) {
                                    editor._tiptapEditor.view.dispatch(
                                      editor._tiptapEditor.view.state.tr.setMeta('force-refresh', true)
                                    )
                                  }
                                }
                                const handleReject = () => {
                                  try {
                                    rejectInsertionChanges(key)
                                  } catch (e) {
                                    console.warn('Reject changes failed:', e)
                                  }
                                  setEditStates(prev => ({ ...prev, [key]: { status: 'rejected', progress: '', error: '' } }))
                                  const editor = getEditor()
                                  if (editor) {
                                    editor._tiptapEditor.view.dispatch(
                                      editor._tiptapEditor.view.state.tr.setMeta('force-refresh', true)
                                    )
                                  }
                                }

                                return (
                                  <EditDocumentTool
                                    request={req}
                                    status={state.status}
                                    progress={state.progress}
                                    error={state.error}
                                    onAccept={handleAccept}
                                    onReject={handleReject}
                                  />
                                )
                              } catch {
                                // fall through to normal code block
                              }
                            }
                            
                            // 行内代码
                            if (!isBlock) {
                              return <code className={className} {...props}>{children}</code>
                            }

                            if (lang === 'mermaid') {
                              const blockKey = `${message.id}:mermaid:${getCodeHash(codeContent)}`
                              return <MermaidCodeBlock codeContent={codeContent} blockKey={blockKey} />
                            }
                            
                            // 代码块 - 添加复制按钮和运行按钮
                            // 使用代码内容的 hash 作为 key 的一部分，确保每个代码块有唯一的状态
                            const blockKey = `${message.id}:codeblock:${getCodeHash(codeContent)}`
                            const blockState = codeBlockStates[blockKey]
                            const isPython = lang === 'python' || lang === 'py'
                            
                            return (
                              <div style={{ position: 'relative', margin: '8px 0' }}>
                                {/* 代码块头部 */}
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  background: 'var(--bg-secondary)',
                                  borderBottom: '1px solid var(--border-color)',
                                  padding: '4px 12px',
                                  borderRadius: '6px 6px 0 0',
                                  fontSize: 11,
                                  color: 'var(--text-muted)',
                                }}>
                                  <span>{lang || '代码'}</span>
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    {isPython && (
                                      <button
                                        onClick={() => runPythonCode(codeContent, blockKey)}
                                        disabled={blockState?.isRunning}
                                        style={{
                                          background: 'transparent',
                                          border: '1px solid var(--border-color)',
                                          borderRadius: 4,
                                          padding: '2px 8px',
                                          fontSize: 10,
                                          color: blockState?.isRunning ? 'var(--text-muted)' : '#10b981',
                                          cursor: blockState?.isRunning ? 'not-allowed' : 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 4,
                                        }}
                                        onMouseEnter={(e) => {
                                          if (!blockState?.isRunning) {
                                            e.currentTarget.style.borderColor = '#10b981'
                                            e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'
                                          }
                                        }}
                                        onMouseLeave={(e) => {
                                          e.currentTarget.style.borderColor = 'var(--border-color)'
                                          e.currentTarget.style.background = 'transparent'
                                        }}
                                      >
                                        {blockState?.isRunning ? (
                                          <Spinner size="sm" color="success" />
                                        ) : (
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M8 5v14l11-7z"/>
                                          </svg>
                                        )}
                                        运行
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleCopy(codeContent)}
                                      style={{
                                        background: 'transparent',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 4,
                                        padding: '2px 8px',
                                        fontSize: 10,
                                        color: 'var(--text-muted)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--accent-color)'
                                        e.currentTarget.style.color = 'var(--accent-color)'
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--border-color)'
                                        e.currentTarget.style.color = 'var(--text-muted)'
                                      }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                      </svg>
                                      复制
                                    </button>
                                  </div>
                                </div>
                                
                                {/* 代码内容 */}
                                <pre style={{
                                  background: 'var(--bg-secondary)',
                                  padding: 12,
                                  margin: 0,
                                  borderRadius: '0 0 6px 6px',
                                  overflow: 'auto',
                                  fontSize: 12,
                                  lineHeight: 1.5,
                                }}>
                                  <code className={className} {...props}>{children}</code>
                                </pre>
                                
                                {/* 运行结果 */}
                                {blockState?.showOutput && blockState.result && (
                                  <div style={{
                                    marginTop: 8,
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 6,
                                    overflow: 'hidden',
                                  }}>
                                    <div style={{
                                      background: 'var(--bg-secondary)',
                                      padding: '4px 12px',
                                      borderBottom: '1px solid var(--border-color)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      fontSize: 11,
                                    }}>
                                      <span style={{ 
                                        color: blockState.result.success ? '#10b981' : '#ef4444',
                                        fontWeight: 500,
                                      }}>
                                        {blockState.result.success ? '✓ 执行成功' : '✗ 执行失败'}
                                      </span>
                                      <span style={{ color: 'var(--text-muted)' }}>
                                        耗时 {blockState.result.executionTime}ms
                                      </span>
                                    </div>
                                    
                                    {/* 标准输出 */}
                                    {blockState.result.stdout && (
                                      <div style={{
                                        padding: 12,
                                        background: 'var(--bg-primary)',
                                        borderBottom: '1px solid var(--border-color)',
                                      }}>
                                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>输出</div>
                                        <pre style={{
                                          margin: 0,
                                          fontSize: 12,
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-word',
                                          color: 'var(--text-primary)',
                                        }}>{blockState.result.stdout}</pre>
                                      </div>
                                    )}
                                    
                                    {/* 错误输出 */}
                                    {blockState.result.stderr && (
                                      <div style={{
                                        padding: 12,
                                        background: 'rgba(239, 68, 68, 0.05)',
                                      }}>
                                        <div style={{ fontSize: 10, color: '#ef4444', marginBottom: 4 }}>错误</div>
                                        <pre style={{
                                          margin: 0,
                                          fontSize: 12,
                                          whiteSpace: 'pre-wrap',
                                          wordBreak: 'break-word',
                                          color: '#ef4444',
                                        }}>{blockState.result.stderr}</pre>
                                      </div>
                                    )}
                                    
                                    {/* 输出的图片 */}
                                    {blockState.result.images.length > 0 && (
                                      <div style={{
                                        padding: 12,
                                        background: 'var(--bg-primary)',
                                      }}>
                                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
                                          生成图片 ({blockState.result.images.length}) - 点击可放大预览
                                        </div>
                                        {blockState.result.images.map((img, imgIdx) => (
                                          <div key={imgIdx} style={{ marginBottom: 12 }}>
                                            <img 
                                              src={img} 
                                              alt={`输出图片 ${imgIdx + 1}`}
                                              onClick={() => setPreviewImage(img)}
                                              style={{
                                                maxWidth: '100%',
                                                borderRadius: 4,
                                                border: '1px solid var(--border-color)',
                                                cursor: 'pointer',
                                                transition: 'transform 0.2s, box-shadow 0.2s',
                                              }}
                                              onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'scale(1.02)'
                                                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)'
                                              }}
                                              onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'scale(1)'
                                                e.currentTarget.style.boxShadow = 'none'
                                              }}
                                            />
                                            <div style={{ 
                                              display: 'flex', 
                                              gap: 6, 
                                              marginTop: 6,
                                            }}>
                                              <button
                                                onClick={() => insertImageToEditor(img)}
                                                style={{
                                                  background: 'var(--bg-secondary)',
                                                  border: '1px solid var(--border-color)',
                                                  borderRadius: 4,
                                                  padding: '4px 10px',
                                                  fontSize: 10,
                                                  color: 'var(--text-muted)',
                                                  cursor: 'pointer',
                                                }}
                                              >
                                                插入编辑器
                                              </button>
                                              <button
                                                onClick={() => addImageToAssets(img)}
                                                style={{
                                                  background: 'var(--bg-secondary)',
                                                  border: '1px solid var(--border-color)',
                                                  borderRadius: 4,
                                                  padding: '4px 10px',
                                                  fontSize: 10,
                                                  color: 'var(--text-muted)',
                                                  cursor: 'pointer',
                                                }}
                                              >
                                                添加到资产库
                                              </button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          },
                          // 图片组件
                          img({ src, alt }) {
                            if (!src || typeof src !== 'string') return null
                            
                            return (
                              <div style={{ 
                                position: 'relative', 
                                display: 'inline-block',
                                margin: '8px 0',
                              }}>
                                <img 
                                  src={src} 
                                  alt={alt || ''}
                                  style={{
                                    maxWidth: '100%',
                                    borderRadius: 6,
                                    border: '1px solid var(--border-color)',
                                  }}
                                />
                                {/* 图片操作按钮 */}
                                <div style={{
                                  position: 'absolute',
                                  top: 8,
                                  right: 8,
                                  display: 'flex',
                                  gap: 4,
                                  opacity: 0,
                                  transition: 'opacity 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                  (e.currentTarget as HTMLElement).style.opacity = '1'
                                }}
                                onMouseLeave={(e) => {
                                  (e.currentTarget as HTMLElement).style.opacity = '0'
                                }}
                                >
                                  <Tooltip content="插入编辑器">
                                    <button
                                      onClick={() => insertImageToEditor(src)}
                                      style={{
                                        background: 'rgba(0, 0, 0, 0.7)',
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: 6,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                                        <path d="M12 5v14M5 12h14"/>
                                      </svg>
                                    </button>
                                  </Tooltip>
                                  <Tooltip content="添加到资产库">
                                    <button
                                      onClick={() => addImageToAssets(src, alt || undefined)}
                                      style={{
                                        background: 'rgba(0, 0, 0, 0.7)',
                                        border: 'none',
                                        borderRadius: 4,
                                        padding: 6,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="17 8 12 3 7 8"/>
                                        <line x1="12" y1="3" x2="12" y2="15"/>
                                      </svg>
                                    </button>
                                  </Tooltip>
                                </div>
                              </div>
                            )
                          },
                          }}
                                >
                                  {segment}
                                </ReactMarkdown>
                              )
                            }

                            const cleanedContent = removeToolCallsFromContent(message.content)

                            return hasCitationMarkers(cleanedContent)
                              ? renderMessageWithCitations(cleanedContent, message.citations, renderMarkdownSegment)
                              : renderMarkdownSegment(stripCitationsFromContent(cleanedContent), `${message.id}-full`)
                          })()}
                        </>
                      )}
                      {/* Render simplified tool calls (::insert, ::delete, ::update) - 过滤掉工具调用格式 */}
                      {(() => {
                        const isStreamingMessage = idx === messages.length - 1 && isLoading
                        const { toolCalls } = parseEditBlocks(message.content, {
                          includeIncompleteTools: isStreamingMessage,
                        })
                        if (toolCalls.length === 0) return null

                        // 收集所有工具调用的状态
                        const toolCallStates = toolCalls.map((call, callIdx) => {
                          const key = `${message.id}:simple:${callIdx}`
                          const fallbackStatus: EditStatus = call.isComplete === false
                            ? (isStreamingMessage ? 'running' : 'error')
                            : 'idle'
                          const state = editStates[key] ?? {
                            status: fallbackStatus,
                            progress: call.isComplete === false && isStreamingMessage ? '正在接收内容…' : '',
                            error: call.isComplete === false && !isStreamingMessage ? '编辑指令未完整输出' : '',
                          }
                          return { call, callIdx, key, state }
                        })

                        // 计算 reviewing 状态的数量
                        const reviewingKeys = toolCallStates
                          .filter(item => item.state.status === 'reviewing')
                          .map(item => item.key)
                        const hasMultipleReviewing = reviewingKeys.length > 1

                        // 一键接受所有 reviewing 状态的操作
                        const handleAcceptAll = () => {
                          reviewingKeys.forEach(key => {
                            try {
                              acceptInsertionChanges(key)
                            } catch {
                              // ignore errors
                            }
                            setEditStates(prev => ({ ...prev, [key]: { status: 'accepted', progress: '', error: '' } }))
                          })
                          const editor = getEditor()
                          if (editor) {
                            editor._tiptapEditor.view.dispatch(
                              editor._tiptapEditor.view.state.tr.setMeta('force-refresh', true)
                            )
                          }
                        }

                        // 一键拒绝所有 reviewing 状态的操作
                        const handleRejectAll = () => {
                          reviewingKeys.forEach(key => {
                            try {
                              rejectInsertionChanges(key)
                            } catch (e) {
                              console.warn('Reject changes failed:', e)
                            }
                            setEditStates(prev => ({ ...prev, [key]: { status: 'rejected', progress: '', error: '' } }))
                          })
                          const editor = getEditor()
                          if (editor) {
                            editor._tiptapEditor.view.dispatch(
                              editor._tiptapEditor.view.state.tr.setMeta('force-refresh', true)
                            )
                          }
                        }
                        
                        return (
                          <>
                            {/* 多个 reviewing 时显示一键操作按钮 */}
                            {hasMultipleReviewing && (
                              <motion.div
                                initial={{ opacity: 0, y: -8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.2 }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  padding: '8px 12px',
                                  marginBottom: 8,
                                  background: 'rgba(0, 153, 255, 0.08)',
                                  border: '1px solid rgba(0, 153, 255, 0.2)',
                                  borderRadius: 8,
                                }}
                              >
                                <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                                  有 {reviewingKeys.length} 处编辑待确认
                                </span>
                                <motion.button
                                  whileHover={{ scale: 1.04 }}
                                  whileTap={{ scale: 0.96 }}
                                  onClick={handleAcceptAll}
                                  style={{
                                    background: 'var(--accent-color)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 6,
                                    padding: '5px 12px',
                                    fontSize: 11,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  全部接受
                                </motion.button>
                                <motion.button
                                  whileHover={{ scale: 1.04 }}
                                  whileTap={{ scale: 0.96 }}
                                  onClick={handleRejectAll}
                                  style={{
                                    background: 'transparent',
                                    color: 'var(--text-muted)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 6,
                                    padding: '5px 12px',
                                    fontSize: 11,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                  全部拒绝
                                </motion.button>
                              </motion.div>
                            )}
                            {toolCallStates.map(({ call, key, state }) => {
                              const handleAccept = () => {
                                try {
                                  acceptInsertionChanges(key)
                                } catch {
                                  // ignore errors
                                }
                                setEditStates(prev => ({ ...prev, [key]: { status: 'accepted', progress: '', error: '' } }))
                                const editor = getEditor()
                                if (editor) {
                                  editor._tiptapEditor.view.dispatch(
                                    editor._tiptapEditor.view.state.tr.setMeta('force-refresh', true)
                                  )
                                }
                              }
                              const handleReject = () => {
                                try {
                                  rejectInsertionChanges(key)
                                } catch (e) {
                                  console.warn('Reject changes failed:', e)
                                }
                                setEditStates(prev => ({ ...prev, [key]: { status: 'rejected', progress: '', error: '' } }))
                                const editor = getEditor()
                                if (editor) {
                                  editor._tiptapEditor.view.dispatch(
                                    editor._tiptapEditor.view.state.tr.setMeta('force-refresh', true)
                                  )
                                }
                              }
                              
                              return (
                                <SimpleTool
                                  key={key}
                                  type={call.type}
                                  params={call.params}
                                  content={call.content}
                                  status={state.status}
                                  progress={state.progress}
                                  error={state.error}
                                  onAccept={handleAccept}
                                  onReject={handleReject}
                                  opKey={key}
                                />
                              )
                            })}
                          </>
                        )
                      })()}
                      {idx === messages.length - 1 && isLoading && (
                        <span 
                          style={{
                            display: 'inline-block',
                            width: 6,
                            height: 14,
                            background: 'var(--accent-color)',
                            marginLeft: 2,
                            animation: 'blink 1s infinite',
                            verticalAlign: 'middle',
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
                  )}
                </MessageContent>

                {/* 操作按钮 */}
                <MessageActions
                  className={message.role === 'assistant'
                    ? `-ml-2 mt-1 gap-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100${idx === messages.length - 1 ? ' opacity-100' : ''}`
                    : 'mt-1 gap-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100'}
                >
                  <MessageAction tooltip="复制消息">
                    <UiButton
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => handleCopy(message.content)}
                      aria-label="复制消息"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    </UiButton>
                  </MessageAction>

                  {message.role === 'assistant' && (
                    <MessageAction tooltip="记到临时便签">
                      <UiButton
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleOpenNote(message.id, message.content)}
                        aria-label="记笔记"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </UiButton>
                    </MessageAction>
                  )}

                  {message.role === 'assistant' && (
                    <MessageAction tooltip="添加到资产库">
                      <UiButton
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleAddToAssets(message)}
                        aria-label="添加到资产库"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </UiButton>
                    </MessageAction>
                  )}
                </MessageActions>
                </Message>
                </motion.div>
                  ))}
                </AnimatePresence>
              )}
              <ChatContainerScrollAnchor />
              <div ref={messagesEndRef} />
            </ChatContainerContent>
            <div style={{ position: 'absolute', right: 24, bottom: 24, zIndex: 2 }}>
              <ScrollButton />
            </div>
          </ChatContainerRoot>
        </div>

        {/* 输入区域 */}
        <div
          ref={inputContainerRef}
          className="relative mx-auto w-full max-w-3xl shrink-0 border-t border-[var(--border-color)] px-3 pb-3 pt-2 md:px-5 md:pb-5"
        >
          {/* 选中文本引用 */}
          <AnimatePresence>
            {selectedQuote && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2 }}
                style={{
                  borderLeft: '3px solid var(--accent-color)',
                  background: 'var(--bg-secondary)',
                  borderRadius: '0 6px 6px 0',
                  padding: '6px 10px',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  position: 'relative',
                  maxHeight: 80,
                  overflow: 'auto',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 6,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-color)" strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/>
                    <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/>
                  </svg>
                  <span style={{
                    flex: 1,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {selectedQuote.length > 200 ? selectedQuote.slice(0, 200) + '…' : selectedQuote}
                  </span>
                  <button
                    onClick={() => setSelectedQuote(null)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      flexShrink: 0,
                      fontSize: 12,
                      opacity: 0.6,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6' }}
                  >
                    ✕
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* 输入框容器 */}
          <div style={{
            position: 'relative',
          }}>
            {showSlashMenu && (
              <Command className="absolute left-0 right-0 bottom-[calc(100%+8px)] z-30 !h-auto rounded border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg" style={{ padding: 0 }}>
                <CommandList className="max-h-[500px]">
                  <CommandGroup heading="快捷引用">
                    <CommandItem onSelect={() => handleSlashAction('command-knowledge')}>
                      {useKnowledge ? '关闭我的知识库检索' : '引用我的知识库'}
                    </CommandItem>
                    <CommandItem onSelect={() => handleSlashAction('command-assets')}>
                      {useAssets ? '关闭我的资产库引用' : '引用我的资产库'}
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup heading="使用智能体">
                    <CommandItem onSelect={() => handleSlashAction('agent:none')}>
                      不使用智能体
                    </CommandItem>
                    {agents.map(agent => (
                      <CommandItem key={agent.id} onSelect={() => handleSlashAction(`agent:${agent.id}`)}>
                        {agent.title}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}

            <PromptInput
              value={inputValue}
              onValueChange={handleInputValueChange}
              onSubmit={() => {
                if (!showSlashMenu) {
                  void handleSend()
                }
              }}
              isLoading={isLoading}
              className="border-input bg-popover relative z-10 w-full rounded-3xl border p-0 pt-1 shadow-xs"
            >
              {/* 智能体和引用标签 */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                padding: selectedAgent || useKnowledge ? '2px 6px 4px' : '0',
              }}>
                {selectedAgent && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'rgba(0, 153, 255, 0.1)',
                    border: '1px solid rgba(0, 153, 255, 0.3)',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#09f',
                    animation: 'fadeIn 0.2s ease',
                  }}>
                    <span>{selectedAgent.title}</span>
                    <button
                      onClick={handleRemoveAgent}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#09f',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: 11,
                        lineHeight: 1,
                        opacity: 0.7,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}

                {useKnowledge && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'rgba(168, 85, 247, 0.12)',
                    border: '1px solid rgba(168, 85, 247, 0.25)',
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontSize: 11,
                    color: 'var(--text-primary)',
                  }}>
                    <span>知识库检索</span>
                  </div>
                )}
              </div>

              <PromptInputTextarea
                onKeyDown={handleKeyDown}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder={selectedAgent ? '继续输入消息，按 / 切换智能体或用 @ 引用来源…' : '输入消息，按 / 使用智能体、知识库、资产库…'}
                disabled={isLoading}
                className="min-h-[44px] max-h-[180px] px-4 pt-3 text-base leading-[1.35] text-[var(--text-primary)]"
              />

              <PromptInputActions className="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
                <div className="flex items-center gap-2 min-w-0 flex-nowrap overflow-x-auto scrollbar-hide">
                  <PromptInputAction tooltip={showSlashMenu ? '关闭命令菜单' : '打开命令菜单'}>
                    <UiButton
                      type="button"
                      variant={showSlashMenu ? 'secondary' : 'outline'}
                      size="icon"
                      className="rounded-full"
                      onClick={() => setShowSlashMenu(current => !current)}
                      aria-label="命令菜单"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 6h16" />
                        <path d="M4 12h16" />
                        <path d="M4 18h10" />
                      </svg>
                    </UiButton>
                  </PromptInputAction>

                  <PromptInputAction tooltip="切换知识库检索">
                    <UiButton
                      type="button"
                      variant={useKnowledge ? 'secondary' : 'outline'}
                      size={useKnowledge ? 'default' : 'icon'}
                      className={cn("rounded-full transition-all duration-200", useKnowledge && "gap-1.5 px-3")}
                      onClick={() => setUseKnowledge(current => !current)}
                      disabled={knowledgeBusy}
                      aria-label="切换知识库检索"
                    >
                      <motion.svg
                        layout
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                      >
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </motion.svg>
                      <AnimatePresence>
                        {useKnowledge && (
                          <motion.span
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 'auto', opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden whitespace-nowrap"
                          >
                            知识库检索
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </UiButton>
                  </PromptInputAction>

                  <PromptInputAction tooltip="切换资产库引用">
                    <UiButton
                      type="button"
                      variant={useAssets ? 'secondary' : 'outline'}
                      size={useAssets ? 'default' : 'icon'}
                      className={cn("rounded-full transition-all duration-200", useAssets && "gap-1.5 px-3")}
                      onClick={() => setUseAssets(current => !current)}
                      aria-label="切换资产库引用"
                    >
                      <motion.svg
                        layout
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                      >
                        <path d="M3 7h18" />
                        <path d="M3 12h18" />
                        <path d="M3 17h18" />
                      </motion.svg>
                      <AnimatePresence>
                        {useAssets && (
                          <motion.span
                            initial={{ width: 0, opacity: 0 }}
                            animate={{ width: 'auto', opacity: 1 }}
                            exit={{ width: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden whitespace-nowrap"
                            style={{ color: '#10b981' }}
                          >
                            资产库引用
                          </motion.span>
                        )}
                      </AnimatePresence>
                      {useAssets && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      )}
                    </UiButton>
                  </PromptInputAction>

                  {getEditor() && (
                    <PromptInputAction tooltip="切换文档编辑模式">
                      <UiButton
                        type="button"
                        variant={useDocEditing ? 'secondary' : 'outline'}
                        size={useDocEditing ? 'default' : 'icon'}
                        className={cn("rounded-full transition-all duration-200", useDocEditing && "gap-1.5 px-3")}
                        onClick={() => setUseDocEditing(current => !current)}
                        aria-label="切换文档编辑模式"
                      >
                        <motion.svg
                          layout
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                        </motion.svg>
                        <AnimatePresence>
                          {useDocEditing && (
                            <motion.span
                              initial={{ width: 0, opacity: 0 }}
                              animate={{ width: 'auto', opacity: 1 }}
                              exit={{ width: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden whitespace-nowrap"
                            >
                              文档编辑
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </UiButton>
                    </PromptInputAction>
                  )}

                  <PromptInputAction tooltip={showMentionMenu ? '隐藏提及候选' : '显示提及候选'}>
                    <UiButton
                      type="button"
                      variant={showMentionMenu ? 'secondary' : 'outline'}
                      size="icon"
                      className="rounded-full"
                      onClick={() => {
                        if (mentionCandidates.length > 0) {
                          setShowMentionMenu(current => !current)
                        } else {
                          focusInput()
                        }
                      }}
                      aria-label="提及候选"
                    >
                      <span className="text-[13px] font-semibold">@</span>
                    </UiButton>
                  </PromptInputAction>
                </div>

                <div className="flex items-center gap-2">
                  {isLoading ? (
                    <PromptInputAction tooltip="停止生成">
                      <UiButton
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="rounded-full"
                        onClick={handleStop}
                        aria-label="停止生成"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                      </UiButton>
                    </PromptInputAction>
                  ) : (
                    <PromptInputAction tooltip="发送消息">
                      <UiButton
                        type="button"
                        variant="default"
                        size="icon"
                        className="rounded-full"
                        onClick={handleSend}
                        disabled={!inputValue.trim()}
                        aria-label="发送消息"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="22" y1="2" x2="11" y2="13" />
                          <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      </UiButton>
                    </PromptInputAction>
                  )}
                </div>
              </PromptInputActions>
            </PromptInput>

            {showMentionMenu && mentionCandidates.length > 0 && (
              <Command className="absolute left-0 right-0 bottom-[calc(100%+8px)] z-20 !h-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg" style={{ padding: 0 }}>
                <CommandList className="max-h-[280px]">
                  {mentionCandidates.map(candidate => (
                    <CommandItem key={`${candidate.type}:${candidate.id}`} onSelect={() => handleMentionSelect(candidate)}>
                      <div className="grid gap-0.5">
                        <span className="text-sm text-[var(--text-primary)]">
                          {candidate.title}
                        </span>
                        <span className="text-xs text-[var(--text-muted)] line-clamp-2">
                          {candidate.type === 'knowledge' ? '知识库' : '资产库'} · {candidate.subtitle}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            )}
          </div>

          {/* 便签列表 */}
          {notes.length > 0 && (
            <div style={{
              marginTop: 8,
            }}>
              <div 
                onClick={() => setShowNotesList(!showNotesList)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  padding: '4px 0',
                  userSelect: 'none',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {notes.length} 条临时便签
                </span>
                <svg 
                  width="12" 
                  height="12" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  style={{ 
                    color: 'var(--text-muted)',
                    transform: showNotesList ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                  }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
              
              {showNotesList && (
                <div style={{
                  marginTop: 6,
                  maxHeight: 150,
                  overflowY: 'auto',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  background: 'var(--bg-secondary)',
                }}>
                  {notes.map(note => (
                    <div
                      key={note.id}
                      onClick={() => handleNoteClick(note)}
                      style={{
                        padding: '8px 10px',
                        borderBottom: '1px solid var(--border-color)',
                        cursor: note.messageId ? 'pointer' : 'default',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        if (note.messageId) {
                          e.currentTarget.style.background = 'var(--bg-primary)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}>
                        <div style={{
                          flex: 1,
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          lineHeight: 1.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}>
                          {note.content}
                        </div>
                        <button
                          onClick={(e) => handleDeleteNote(note.id, e)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            padding: '2px 4px',
                            fontSize: 10,
                            opacity: 0.5,
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '1'
                            e.currentTarget.style.color = '#f44'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '0.5'
                            e.currentTarget.style.color = 'var(--text-muted)'
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                      }}>
                        {new Date(note.createdAt).toLocaleDateString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 动画样式和 Markdown 样式 */}
        <style>{`
          @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: scale(0.9); }
            to { opacity: 1; transform: scale(1); }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes spin-border {
            from { outline-color: transparent; }
            50% { outline-color: #3b82f6; }
            to { outline-color: transparent; }
          }
          @keyframes slideUp {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .markdown-content h1, .markdown-content h2, .markdown-content h3, 
          .markdown-content h4, .markdown-content h5, .markdown-content h6 {
            margin: 12px 0 8px 0;
            font-weight: 600;
            color: var(--text-primary);
          }
          .markdown-content h1 { font-size: 18px; }
          .markdown-content h2 { font-size: 16px; }
          .markdown-content h3 { font-size: 15px; }
          .markdown-content p {
            margin: 8px 0;
          }
          .markdown-content code {
            background: var(--bg-secondary);
            padding: 2px 6px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
          }
          .markdown-content pre {
            background: var(--bg-secondary);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 8px 0;
          }
          .markdown-content pre code {
            background: transparent;
            padding: 0;
          }
          .markdown-content ul, .markdown-content ol {
            margin: 8px 0;
            padding-left: 20px;
          }
          .markdown-content li {
            margin: 4px 0;
          }
          .markdown-content blockquote {
            border-left: 3px solid var(--accent-color);
            padding-left: 12px;
            margin: 8px 0;
            color: var(--text-muted);
          }
          .markdown-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 8px 0;
          }
          .markdown-content th, .markdown-content td {
            border: 1px solid var(--border-color);
            padding: 6px 10px;
            text-align: left;
          }
          .markdown-content th {
            background: var(--bg-secondary);
            font-weight: 500;
          }
          .markdown-content a {
            color: var(--accent-color);
            text-decoration: none;
          }
          .markdown-content a:hover {
            text-decoration: underline;
          }
        `}</style>
      </div>

      {/* 便签模态框 */}
      <Modal isOpen={isNoteModalOpen} onClose={onNoteModalClose} size="lg">
        <ModalContent>
          <ModalHeader>保存到临时便签</ModalHeader>
          <ModalBody>
            <Textarea
              value={noteContent}
              onValueChange={setNoteContent}
              placeholder="编辑便签内容..."
              minRows={6}
              maxRows={12}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onNoteModalClose}>取消</Button>
            <Button color="primary" onPress={handleSaveNote}>保存</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 图片预览模态框 */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            cursor: 'zoom-out',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <img
            src={previewImage}
            alt="预览图片"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: 8,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              cursor: 'default',
            }}
          />
          {/* 关闭按钮 */}
          <button
            onClick={() => setPreviewImage(null)}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
