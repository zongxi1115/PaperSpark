'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button, Tooltip, Switch, Chip, Select, SelectItem, Dropdown, DropdownTrigger, DropdownMenu, DropdownSection, DropdownItem, addToast, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, useDisclosure } from '@heroui/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { readDocument, type DocumentReadResult } from './tools/ReadDocumentTool'
import { EditDocumentTool, type EditDocumentRequest } from './tools/EditDocumentTool'
import { getEditor } from '@/lib/editorContext'
import { 
  getAgents, 
  getSettings, 
  getKnowledgeItems,
  getAssets,
  getAssetTypes,
  getSelectedLargeModel,
  getConversations,
  saveConversation,
  deleteConversation,
  generateId,
  getAssistantNotes,
  addAssistantNote,
  deleteAssistantNote,
} from '@/lib/storage'
import { getVectorDocumentsByDocumentId } from '@/lib/pdfCache'
import { getFullTextByKnowledgeId } from '@/lib/pdfCache'
import { searchMyKnowledgeBase as runKnowledgeSearch } from '@/lib/assistantKnowledge'
import { indexKnowledgeForRAG } from '@/lib/rag'
import type { Agent, AppSettings, ModelConfig, AssistantConversation, AssistantMessage, AssistantNote, AssistantToolEvent, AssistantCitation } from '@/lib/types'

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
  const [docContext, setDocContext] = useState<DocumentReadResult | null>(null)
  const [useDocContext, setUseDocContext] = useState(false)

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
    if (nextValue === '/' && !showSlashMenu && inputValue.length === 0) {
      setShowSlashMenu(true)
      setInputValue('')
      return
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
    if (e.key === '/' && !showSlashMenu && inputValue.length === 0) {
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
          pageNum: doc.pageNum ?? undefined,
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
      const docContextText = useDocContext && docContext
        ? `\n\n当前编辑器文档内容（Markdown格式）：\n\`\`\`\n${docContext.markdown.slice(0, 8000)}\n\`\`\``
        : ''
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

        knowledgeCandidates = await runKnowledgeSearch(content)
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
  }, [inputValue, isLoading, currentConversation, settings, selectedAgent, useKnowledge, useAssets, agents, buildAssetContext, mentions, buildMentionKnowledgeCandidates])

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
            <Button
              size="sm"
              variant="flat"
              onPress={() => setShowHistory(!showHistory)}
              style={{ minWidth: 'auto' }}
            >
              {showHistory ? '隐藏' : '历史'}
            </Button>
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
                <Tooltip content="读取当前编辑器文档内容，作为对话上下文">
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>引用当前文档</span>
                </Tooltip>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {docContext && (
                    <span style={{ fontSize: 10, color: '#10b981' }}>
                      {docContext.blockCount}块/{docContext.charCount}字
                    </span>
                  )}
                  <button
                    onClick={() => {
                      const result = readDocument()
                      if (result) {
                        setDocContext(result)
                        setUseDocContext(true)
                        addToast({ title: `已读取文档 (${result.blockCount} 块)`, color: 'success' })
                      } else {
                        addToast({ title: '未找到编辑器', color: 'warning' })
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      borderRadius: 4,
                      padding: '2px 7px',
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    读取
                  </button>
                  <Switch size="sm" isSelected={useDocContext} onValueChange={setUseDocContext} isDisabled={!docContext} />
                </div>
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
                            const isBlock = node?.position?.start?.line !== node?.position?.end?.line || String(children).includes('\n')
                            const lang = /language-(\w+)/.exec(className || '')?.[1]
                            if (isBlock && lang === 'edit_document') {
                              try {
                                const req: EditDocumentRequest = JSON.parse(String(children).trim())
                                return <EditDocumentTool request={req} />
                              } catch {
                                // fall through to normal code block
                              }
                            }
                            return <code className={className} {...props}>{children}</code>
                          }
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
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
            <Dropdown isOpen={showSlashMenu} onOpenChange={setShowSlashMenu} placement="top-start">
              <DropdownTrigger>
                <button
                  type="button"
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 12,
                    bottom: 56,
                    width: 1,
                    height: 1,
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                />
              </DropdownTrigger>
              <DropdownMenu aria-label="快捷命令" onAction={handleSlashAction}>
                <DropdownSection title="快捷引用" showDivider>
                  <DropdownItem key="command-knowledge">{useKnowledge ? '关闭我的知识库检索' : '引用我的知识库'}</DropdownItem>
                  <DropdownItem key="command-assets">{useAssets ? '关闭我的资产库引用' : '引用我的资产库'}</DropdownItem>
                </DropdownSection>
                <DropdownSection title="使用智能体">
                  <DropdownItem key="agent:none">不使用智能体</DropdownItem>
                  {agents.map(agent => (
                    <DropdownItem key={`agent:${agent.id}`}>{agent.title}</DropdownItem>
                  ))}
                </DropdownSection>
              </DropdownMenu>
            </Dropdown>

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
