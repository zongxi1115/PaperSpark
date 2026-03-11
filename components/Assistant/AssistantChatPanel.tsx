'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Button, Switch, Select, SelectItem, addToast, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea, useDisclosure } from '@heroui/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { 
  getAgents, 
  getSettings, 
  getKnowledgeItems, 
  getSelectedLargeModel,
  getConversations,
  saveConversation,
  deleteConversation,
  generateId,
  getAssistantNotes,
  addAssistantNote,
  deleteAssistantNote,
} from '@/lib/storage'
import type { Agent, AppSettings, ModelConfig, AssistantConversation, AssistantMessage, AssistantNote } from '@/lib/types'

export function AssistantChatPanel() {
  const [conversations, setConversations] = useState<AssistantConversation[]>([])
  const [currentConversation, setCurrentConversation] = useState<AssistantConversation | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [useKnowledge, setUseKnowledge] = useState(false)
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [agentFilter, setAgentFilter] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [notes, setNotes] = useState<AssistantNote[]>([])
  const [noteContent, setNoteContent] = useState('')
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [showNotesList, setShowNotesList] = useState(false)
  
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
    if (nextValue === '/' && !showAgentPicker && inputValue.length === 0) {
      setShowAgentPicker(true)
      setAgentFilter('')
      setInputValue('')
      return
    }
    setInputValue(nextValue)
  }

  // 处理输入框按键
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === '/' && !showAgentPicker && inputValue.length === 0) {
      e.preventDefault()
      setShowAgentPicker(true)
      setAgentFilter('')
      return
    }

    if (e.key === 'Escape' && showAgentPicker) {
      setShowAgentPicker(false)
    } else if (e.key === 'Enter' && !e.shiftKey && !showAgentPicker) {
      e.preventDefault()
      handleSend()
    }
  }

  // 选择智能体
  const handleSelectAgent = (agent: Agent) => {
    setSelectedAgent(agent)
    setShowAgentPicker(false)
    setAgentFilter('')

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
    setIsLoading(true)

    const assistantMessage: AssistantMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
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

      let knowledgeContext = ''
      if (useKnowledge) {
        const items = getKnowledgeItems()
        if (items.length > 0) {
          const recentItems = items.slice(0, 5)
          knowledgeContext = recentItems.map(item => {
            const parts = [`标题：${item.title}`]
            if (item.abstract) parts.push(`摘要：${item.abstract}`)
            if (item.cachedSummary) parts.push(`总结：${item.cachedSummary}`)
            return parts.join('\n')
          }).join('\n\n---\n\n')
        }
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
          systemPrompt,
          knowledgeContext: useKnowledge ? knowledgeContext : undefined,
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok) {
        throw new Error('请求失败')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          const chunk = decoder.decode(value, { stream: true })
          fullContent += chunk
          
          assistantMessage.content = fullContent
          setCurrentConversation(prev => {
            if (!prev) return prev
            return {
              ...prev,
              messages: [...updatedMessages, assistantMessage],
            }
          })
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

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        if (currentConversation) {
          saveConversation(currentConversation)
        }
      } else {
        addToast({ title: '发送失败，请重试', color: 'danger' })
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [inputValue, isLoading, currentConversation, settings, selectedAgent, useKnowledge, agents])

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
  const filteredAgents = agents.filter(a => 
    a.title.toLowerCase().includes(agentFilter.toLowerCase())
  )

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

          {/* 知识库检索开关 */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              我的知识库检索
            </span>
            <Switch
              size="sm"
              isSelected={useKnowledge}
              onValueChange={setUseKnowledge}
            />
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
                  输入 / 可快速选择智能体人设
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
                  {message.role === 'assistant' ? (
                    <>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
            {/* 智能体选择器弹窗 */}
            {showAgentPicker && (
              <div style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 'calc(100% + 8px)',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                zIndex: 1000,
                maxHeight: 220,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}>
                <div style={{
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--border-color)',
                }}>
                  <input
                    type="text"
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                    placeholder="搜索智能体..."
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        setShowAgentPicker(false)
                        inputRef.current?.focus()
                      }
                    }}
                    style={{
                      width: '100%',
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 6,
                      padding: '6px 10px',
                      fontSize: 12,
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                </div>
                <div style={{
                  overflowY: 'auto',
                  maxHeight: 170,
                }}>
                  {filteredAgents.map(agent => (
                    <div
                      key={agent.id}
                      onClick={() => handleSelectAgent(agent)}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-secondary)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span style={{ 
                        fontSize: 12,
                        fontWeight: 500,
                      }}>
                        {agent.title}
                      </span>
                      {agent.isPreset && (
                        <span style={{
                          fontSize: 9,
                          padding: '1px 4px',
                          background: 'var(--text-muted)',
                          color: 'white',
                          borderRadius: 3,
                        }}>
                          预设
                        </span>
                      )}
                    </div>
                  ))}
                  {filteredAgents.length === 0 && (
                    <div style={{ 
                      padding: 16, 
                      textAlign: 'center', 
                      color: 'var(--text-muted)',
                      fontSize: 12,
                    }}>
                      未找到匹配的智能体
                    </div>
                  )}
                </div>
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
                padding: selectedAgent ? '6px 8px 0' : '0',
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
              </div>
              
              {/* 输入框 */}
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={selectedAgent ? '继续输入消息...' : '输入消息，按 / 选择智能体...'}
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
