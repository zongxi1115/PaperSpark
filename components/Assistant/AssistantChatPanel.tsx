'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button, Tooltip, Switch, Chip, Select, SelectItem, addToast, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, useDisclosure, Spinner } from '@heroui/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  convertToolCallsToRequest,
  getDocumentStructure,
  StreamingToolDetector,
  type EditDocumentRequest,
  type EditStatus,
  type ParsedToolCall,
} from './tools/EditDocumentTool'
import { getEditor } from '@/lib/editorContext'
import { 
  getAgents, 
  getSettings, 
  getKnowledgeItems,
  getAssets,
  getAssetTypes,
  saveAsset,
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
import type { Agent, AppSettings, ModelConfig, AssistantConversation, AssistantMessage, AssistantNote, AssistantToolEvent, AssistantCitation, AssetItem } from '@/lib/types'

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
  const [showNotesList, setShowNotesList] = useState(false)
  const [useDocEditing, setUseDocEditing] = useState(false)
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

  const { isOpen: isNoteModalOpen, onOpen: onNoteModalOpen, onClose: onNoteModalClose } = useDisclosure()
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // 加载数据
  useEffect(() => {
    setAgents(getAgents())
    setSettings(getSettings())
    setConversations(getConversations())
    setNotes(getAssistantNotes())
  }, [])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentConversation?.messages])

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value
    if ((nextValue === '/' || nextValue === '／') && !showSlashMenu && inputValue.trim().length === 0) {
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
  }

  // 处理输入框按键
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === '/' || e.key === '／') && !showSlashMenu && inputValue.trim().length === 0) {
      e.preventDefault()
      setShowSlashMenu(true)
      return
    }

    if (e.key === 'Escape' && (showSlashMenu || showMentionMenu)) {
      setShowSlashMenu(false)
      setShowMentionMenu(false)
    } else if (e.key === 'Enter' && !e.shiftKey && !showSlashMenu) {
      e.preventDefault()
      handleSend()
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
    inputRef.current?.focus()
  }, [agents])

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
    inputRef.current?.focus()
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
    inputRef.current?.focus()
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

  const handleMentionSelect = useCallback((candidate: { id: string; type: 'knowledge' | 'asset'; title: string }) => {
    setMentions(prev => [...prev, candidate])
    setInputValue(prev => prev.replace(/(?:^|\s)@([^\s@]*)$/, ''))
    setMentionQuery('')
    setShowMentionMenu(false)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
  }, [])

  const removeMention = useCallback((id: string, type: 'knowledge' | 'asset') => {
    setMentions(prev => prev.filter(item => !(item.id === id && item.type === type)))
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
      const response = await fetch('/api/upload/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64: imageSource,
          mimeType: imageSource.match(/data:(image\/\w+);/)?.[1] || 'image/png',
        }),
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
      
      // 使用 BlockNote API 插入图片块
      editor.insertBlocks([
        {
          type: 'image',
          props: {
            src: imageUrl,
            alt: 'AI 生成的图片',
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
          type: 'paragraph',
          content: [
            { type: 'text', text: '', styles: {} },
          ],
        }, {
          type: 'image',
          props: {
            src: imageUrl,
            alt: 'Python 生成的图片',
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

  // 复制内容
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
          systemPrompt: systemPrompt + docContextText,
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
      let streamDeltaCount = 0

      const executeDetectedTool = (idx: number, tool: { type: 'insert' | 'delete' | 'update'; params: Record<string, string>; contentSoFar: string }) => {
        if (executedToolIndices.has(idx)) return
        executedToolIndices.add(idx)

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

          // Streaming tool detection (every 5 deltas to avoid thrashing)
          if (detector) {
            streamDeltaCount++
            if (streamDeltaCount % 5 === 0 || payload.delta.includes('::')) {
              const { detected, completedIndices } = detector.process(fullContent)
              // Show in-progress tool cards
              detected.forEach((tool, idx) => {
                const key = `${assistantMessage.id}:simple:${idx}`
                if (!tool.isComplete && !executedToolIndices.has(idx) && !shownToolIndices.has(idx)) {
                  shownToolIndices.add(idx)
                  setEditStates(prev => ({
                    ...prev,
                    [key]: { status: 'running', progress: '正在接收内容…', error: '', toolCall: { type: tool.type, params: tool.params, content: tool.contentSoFar } }
                  }))
                }
              })
              // Execute newly completed tools
              completedIndices.forEach(idx => {
                const tool = detected[idx]
                if (tool) executeDetectedTool(idx, tool)
              })
            }
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
  }, [inputValue, isLoading, currentConversation, settings, selectedAgent, useKnowledge, useAssets, useDocEditing, agents, buildAssetContext, mentions, buildMentionKnowledgeCandidates])

  // Parse both simplified format (::insert, ::delete, ::update) and legacy edit_document JSON blocks
  const parseEditBlocks = useCallback((content: string): { requests: EditDocumentRequest[]; toolCalls: ParsedToolCall[] } => {
    const requests: EditDocumentRequest[] = []
    const toolCalls: ParsedToolCall[] = []
    
    // Parse simplified format first
    const simpleCalls = parseSimpleToolCalls(content)
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
    // Remove complete ::insert ... ::
    let result = content.replace(/::insert\s+(before|after)?\s*(\S*)?\n[\s\S]*?\n::/g, '')
    // Remove complete ::update blockId ... ::
    result = result.replace(/::update\s+\S+\n[\s\S]*?\n::/g, '')
    // Remove ::delete blockId
    result = result.replace(/^::delete\s+\S+\s*$/gm, '')
    // Remove trailing incomplete tool calls (during streaming)
    result = result.replace(/::(?:insert|update)\s+[^\n]*(?:\n[\s\S]*)?$/, '')
    // Clean up extra whitespace
    result = result.replace(/\n{3,}/g, '\n\n').trim()
    return result
  }, [])

  // Auto-run edit blocks from a completed assistant message
  const triggerEditBlocks = useCallback((msgId: string, content: string) => {
    const { requests, toolCalls } = parseEditBlocks(content)
    
    // Handle simplified tool calls
    if (toolCalls.length > 0) {
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
  }, [parseEditBlocks])

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

  const messages = currentConversation?.messages || []

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
            <Select
              size="sm"
              selectedKeys={settings?.defaultLargeModelId ? [settings.defaultLargeModelId] : []}
              onChange={(e) => {
                if (settings && e.target.value) {
                  const newSettings = { ...settings, defaultLargeModelId: e.target.value }
                  setSettings(newSettings)
                }
              }}
              placeholder="选择模型"
              style={{ flex: 1 }}
              classNames={{
                trigger: 'bg-[var(--bg-secondary)]',
              }}
            >
              {models.map(model => (
                <SelectItem key={model.id}>{model.name}</SelectItem>
              ))}
            </Select>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Tooltip content="输入 / 可切换智能体，也可以在输入框里直接用 / 打开命令菜单">
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {selectedAgent ? `当前智能体：${selectedAgent.title}` : '当前智能体：未指定'}
                </span>
              </Tooltip>
              {selectedAgent && (
                <Button size="sm" variant="light" onPress={handleRemoveAgent}>
                  清除
                </Button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Tooltip content="基于关键词 + RAG 混合检索知识库摘要与精读全文，并在回答中附规范引用">
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>我的知识库检索</span>
              </Tooltip>
              <Switch size="sm" isSelected={useKnowledge} onValueChange={setUseKnowledge} isDisabled={knowledgeBusy} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Tooltip content="引用资产库中与你问题相关的素材、摘要和标签，作为辅助回答上下文">
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>引用我的资产库</span>
              </Tooltip>
              <Switch size="sm" isSelected={useAssets} onValueChange={setUseAssets} />
            </div>

            {getEditor() && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <Tooltip content="开启后，AI 自动获取文档结构和内容，可读取和编辑当前文档">
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>可编辑文档内容</span>
                </Tooltip>
                <Switch size="sm" isSelected={useDocEditing} onValueChange={setUseDocEditing} />
              </div>
            )}
          </div>
        </div>

        {/* 对话区域 */}
        <div 
          ref={messagesContainerRef}
          style={{ 
            flex: 1, 
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {messages.length === 0 ? (
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
              textAlign: 'center',
            }}>
              <div>
                <p style={{ marginBottom: 8 }}>开始与 AI 助手对话</p>
                <p style={{ fontSize: 11, opacity: 0.7 }}>
                  输入 / 可快速切换智能体、知识库和资产库引用
                </p>
              </div>
            </div>
          ) : (
            messages.map((message, idx) => (
              <div 
                key={message.id}
                ref={(el) => {
                  if (el) messageRefs.current.set(message.id, el)
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: 8,
                  borderRadius: 6,
                }}
              >
                {/* 角色标签 */}
                <div style={{
                  fontSize: 10,
                  color: message.role === 'user' ? 'var(--accent-color)' : 'var(--text-muted)',
                  fontWeight: 500,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  {message.role === 'user' ? '你' : '助手'}
                </div>
                
                {/* 内容 */}
                <div 
                  className="markdown-content"
                  style={{
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: message.role === 'user' ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                >
                  {message.role === 'assistant' && message.toolEvents && message.toolEvents.length > 0 && (
                    <div style={{ display: 'grid', gap: 4, marginBottom: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                      {message.toolEvents.map(event => (
                        <div key={event.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ color: event.status === 'error' ? '#ef4444' : event.status === 'success' ? '#10b981' : '#f59e0b' }}>●</span>
                          <span>{event.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {message.role === 'assistant' ? (
                    <>
                      <ReactMarkdown
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
                            
                            // 代码块 - 添加复制按钮和运行按钮
                            // 使用代码内容的 hash 作为 key 的一部分，确保每个代码块有唯一的状态
                            const getCodeHash = (str: string) => {
                              let hash = 0
                              for (let i = 0; i < str.length; i++) {
                                hash = ((hash << 5) - hash) + str.charCodeAt(i)
                                hash |= 0
                              }
                              return Math.abs(hash).toString(36)
                            }
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
                                          生成图片 ({blockState.result.images.length})
                                        </div>
                                        {blockState.result.images.map((img, imgIdx) => (
                                          <div key={imgIdx} style={{ marginBottom: 12 }}>
                                            <img 
                                              src={img} 
                                              alt={`输出图片 ${imgIdx + 1}`}
                                              style={{
                                                maxWidth: '100%',
                                                borderRadius: 4,
                                                border: '1px solid var(--border-color)',
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
                        {removeToolCallsFromContent(message.content)}
                      </ReactMarkdown>
                      {/* Render simplified tool calls (::insert, ::delete, ::update) - 过滤掉工具调用格式 */}
                      {(() => {
                        const { toolCalls } = parseEditBlocks(message.content)
                        if (toolCalls.length === 0) return null
                        
                        return toolCalls.map((call, callIdx) => {
                          const key = `${message.id}:simple:${callIdx}`
                          const state = editStates[key] ?? { status: 'idle' as EditStatus, progress: '', error: '' }

                          const handleAccept = () => {
                            try {
                              acceptInsertionChanges(key)
                            } catch {
                              // ignore errors
                            }
                            setEditStates(prev => ({ ...prev, [key]: { status: 'accepted', progress: '', error: '' } }))
                            // 强制刷新编辑器视图
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
                            // 强制刷新编辑器视图
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
                        })
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
                </div>

                {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
                  <div style={{ display: 'grid', gap: 6, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    {message.citations.map(citation => (
                      <div key={citation.id} style={{ lineHeight: 1.6 }}>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{citation.id}</span>
                        {' · '}
                        <span>{citation.title}</span>
                        {citation.sourceKind === 'fulltext'
                          ? ` · 精读RAG${citation.pageNum ? ` · 第${citation.pageNum}页` : ''}`
                          : citation.sourceKind === 'asset'
                            ? ' · 资产库全文'
                            : ' · 概要'}
                      </div>
                    ))}
                  </div>
                )}

                {/* 操作按钮 */}
                <div style={{
                  display: 'flex',
                  gap: 6,
                  marginTop: 2,
                }}>
                  <button
                    onClick={() => handleCopy(message.content)}
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'all 0.15s',
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
                  
                  {message.role === 'assistant' && (
                    <button
                      onClick={() => handleOpenNote(message.id, message.content)}
                      style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#f90'
                        e.currentTarget.style.color = '#f90'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border-color)'
                        e.currentTarget.style.color = 'var(--text-muted)'
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                      记笔记
                    </button>
                  )}

                  {message.role === 'assistant' && (
                    <button
                      onClick={() => handleAddToAssets(message)}
                      style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 4,
                        padding: '3px 8px',
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        transition: 'all 0.15s',
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
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                      添加到资产库
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域 */}
        <div 
          ref={inputContainerRef}
          style={{ 
            padding: '8px 12px 12px',
            borderTop: '1px solid var(--border-color)',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          {/* 输入框容器 */}
          <div style={{
            position: 'relative',
          }}>
            {showSlashMenu && (
              <div style={{
                position: 'absolute',
                left: 0,
                right: 70,
                bottom: 62,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                boxShadow: '0 12px 24px rgba(0, 0, 0, 0.12)',
                padding: 6,
                display: 'grid',
                gap: 6,
                zIndex: 30,
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 6px' }}>快捷引用</div>
                <button
                  type="button"
                  onClick={() => handleSlashAction('command-knowledge')}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {useKnowledge ? '关闭我的知识库检索' : '引用我的知识库'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSlashAction('command-assets')}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  {useAssets ? '关闭我的资产库引用' : '引用我的资产库'}
                </button>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 6px', borderTop: '1px solid var(--border-color)', marginTop: 2 }}>使用智能体</div>
                <button
                  type="button"
                  onClick={() => handleSlashAction('agent:none')}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--text-primary)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  不使用智能体
                </button>

                {agents.map(agent => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleSlashAction(`agent:${agent.id}`)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {agent.title}
                  </button>
                ))}
              </div>
            )}

            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-color)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-color)'
            }}
            >
              {/* 智能体标签区域 */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                padding: selectedAgent || useKnowledge || useAssets || mentions.length > 0 ? '6px 8px 0' : '0',
              }}>
                {selectedAgent && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'rgba(0, 153, 255, 0.1)',
                    border: '1px solid rgba(0, 153, 255, 0.3)',
                    borderRadius: 4,
                    padding: '2px 6px 2px 8px',
                    fontSize: 12,
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
                        fontSize: 12,
                        lineHeight: 1,
                        opacity: 0.6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1'
                        e.currentTarget.style.background = 'rgba(0, 153, 255, 0.2)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0.6'
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                {useKnowledge && (
                  <Chip size="sm" variant="flat" color="secondary">知识库检索</Chip>
                )}
                {useAssets && (
                  <Chip size="sm" variant="flat" color="success">资产库引用</Chip>
                )}
                {mentions.map(mention => (
                  <div
                    key={`${mention.type}:${mention.id}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      background: mention.type === 'knowledge' ? 'rgba(168, 85, 247, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                      border: mention.type === 'knowledge' ? '1px solid rgba(168, 85, 247, 0.25)' : '1px solid rgba(16, 185, 129, 0.25)',
                      borderRadius: 999,
                      padding: '2px 8px',
                      fontSize: 11,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span>{mention.type === 'knowledge' ? '@知识' : '@资产'} · {mention.title}</span>
                    <button
                      onClick={() => removeMention(mention.id, mention.type)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        padding: 0,
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              
              {/* 输入框 */}
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={selectedAgent ? '继续输入消息，按 / 切换智能体或引用来源…' : '输入消息，按 / 使用智能体、知识库、资产库…'}
                disabled={isLoading}
                style={{
                  width: '100%',
                  minHeight: 48,
                  maxHeight: 150,
                  resize: 'none',
                  background: 'transparent',
                  border: 'none',
                  padding: '8px 70px 8px 12px',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
            </div>

            {showMentionMenu && mentionCandidates.length > 0 && (
              <div style={{
                position: 'absolute',
                left: 0,
                right: 70,
                bottom: 62,
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                boxShadow: '0 12px 24px rgba(0, 0, 0, 0.12)',
                padding: 6,
                display: 'grid',
                gap: 4,
                zIndex: 20,
              }}>
                {mentionCandidates.map(candidate => (
                  <button
                    key={`${candidate.type}:${candidate.id}`}
                    type="button"
                    onClick={() => handleMentionSelect(candidate)}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      display: 'grid',
                      gap: 2,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-secondary)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                      {candidate.title}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {candidate.type === 'knowledge' ? '知识库' : '资产库'} · {candidate.subtitle}
                    </span>
                  </button>
                ))}
              </div>
            )}
            
            {/* 发送/停止按钮 */}
            <div style={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              display: 'flex',
              gap: 4,
            }}>
              {isLoading ? (
                <Button
                  size="sm"
                  color="danger"
                  variant="flat"
                  onPress={handleStop}
                  style={{ minWidth: 'auto' }}
                >
                  停止
                </Button>
              ) : (
                <Button
                  size="sm"
                  color="primary"
                  onPress={handleSend}
                  isDisabled={!inputValue.trim()}
                  style={{ minWidth: 'auto' }}
                >
                  发送
                </Button>
              )}
            </div>
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
    </div>
  )
}
