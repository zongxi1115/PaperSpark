'use client'
import { useState, useCallback, useEffect } from 'react'
import { Button, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast, Tooltip } from '@heroui/react'
import { getAgents, saveAgent, deleteAgent, generateId } from '@/lib/storage'
import { AGENT_CAPABILITY_DEFINITIONS, getAgentCapabilityDefinitions, normalizeAgent } from '@/lib/agents'
import type { Agent, AgentCapabilityId } from '@/lib/types'

export function AgentSettingsPanel() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingDescription, setEditingDescription] = useState('')
  const [editingPrompt, setEditingPrompt] = useState('')
  const [editingCapabilities, setEditingCapabilities] = useState<AgentCapabilityId[]>([])
  const { isOpen, onOpen, onClose } = useDisclosure()

  // 加载
  useEffect(() => {
    setAgents(getAgents())
    const handleAgentsUpdated = () => setAgents(getAgents())
    window.addEventListener('agents-updated', handleAgentsUpdated)
    return () => window.removeEventListener('agents-updated', handleAgentsUpdated)
  }, [])

  // 新增自定义智能体
  const handleCreate = useCallback(() => {
    const newAgent: Agent = {
      id: generateId(),
      title: '',
      description: '',
      prompt: '',
      capabilities: [],
      isPreset: false,
    }
    setEditingAgent(newAgent)
    setEditingTitle('')
    setEditingDescription('')
    setEditingPrompt('')
    setEditingCapabilities([])
    onOpen()
  }, [onOpen])

  // 点击编辑
  const handleEdit = useCallback((agent: Agent) => {
    const normalizedAgent = normalizeAgent(agent)
    setEditingAgent(normalizedAgent)
    setEditingTitle(normalizedAgent.title)
    setEditingDescription(normalizedAgent.description ?? '')
    setEditingPrompt(normalizedAgent.prompt)
    setEditingCapabilities(normalizedAgent.capabilities ?? [])
    onOpen()
  }, [onOpen])

  // 删除
  const handleDelete = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const agent = agents.find(a => a.id === id)
    if (agent?.isPreset) {
      addToast({ title: '预设智能体不可删除', color: 'warning' })
      return
    }
    deleteAgent(id)
    setAgents(getAgents())
    addToast({ title: '已删除', color: 'success' })
  }, [agents])

  // 保存
  const handleSave = useCallback(() => {
    if (!editingAgent) return
    if (!editingTitle.trim()) {
      addToast({ title: '请填写智能体名称', color: 'warning' })
      return
    }
    const updated: Agent = {
      ...editingAgent,
      title: editingTitle.trim(),
      description: editingDescription.trim() || undefined,
      prompt: editingPrompt,
      capabilities: editingCapabilities,
    }
    saveAgent(updated)
    setAgents(getAgents())
    onClose()
    addToast({ title: '保存成功', color: 'success' })
  }, [editingAgent, editingTitle, editingDescription, editingPrompt, editingCapabilities, onClose])

  // 关闭
  const handleClose = useCallback(() => {
    setEditingAgent(null)
    onClose()
  }, [onClose])

  const handleToggleCapability = useCallback((capabilityId: AgentCapabilityId) => {
    setEditingCapabilities((current) => (
      current.includes(capabilityId)
        ? current.filter(item => item !== capabilityId)
        : [...current, capabilityId]
    ))
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 头部 */}
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
          {agents.length} 个智能体
        </span>
        <Button size="sm" color="primary" variant="flat" onPress={handleCreate}>
          + 新增
        </Button>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {/* 预设智能体 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ 
            fontSize: 11, 
            color: 'var(--text-muted)', 
            marginBottom: 6, 
            paddingLeft: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            预设智能体
          </div>
          {agents.filter(a => a.isPreset).map(agent => (
            <AgentCard 
              key={agent.id} 
              agent={agent} 
              onEdit={handleEdit} 
              onDelete={handleDelete} 
            />
          ))}
        </div>

        {/* 自定义智能体 */}
        <div>
          <div style={{ 
            fontSize: 11, 
            color: 'var(--text-muted)', 
            marginBottom: 6, 
            paddingLeft: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            自定义智能体
          </div>
          {agents.filter(a => !a.isPreset).length === 0 ? (
            <div style={{ 
              padding: 16, 
              textAlign: 'center', 
              color: 'var(--text-muted)',
              fontSize: 12,
              background: 'var(--bg-secondary)',
              borderRadius: 8,
            }}>
              暂无自定义智能体
            </div>
          ) : (
            agents.filter(a => !a.isPreset).map(agent => (
              <AgentCard 
                key={agent.id} 
                agent={agent} 
                onEdit={handleEdit} 
                onDelete={handleDelete} 
              />
            ))
          )}
        </div>
      </div>

      {/* 编辑模态框 */}
      <Modal isOpen={isOpen} onClose={handleClose} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {editingAgent?.isPreset ? '编辑预设智能体' : editingAgent?.id ? '编辑智能体' : '新增智能体'}
          </ModalHeader>
          <ModalBody>
            <div style={{ marginBottom: 16 }}>
              <label style={{ 
                display: 'block', 
                fontSize: 12, 
                color: 'var(--text-muted)', 
                marginBottom: 6 
              }}>
                智能体名称 *
              </label>
              <Input
                value={editingTitle}
                onValueChange={setEditingTitle}
                placeholder="例如：学术写作助手"
                size="sm"
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--text-muted)',
                marginBottom: 6
              }}>
                智能体定位
              </label>
              <Textarea
                value={editingDescription}
                onValueChange={setEditingDescription}
                placeholder="例如：侧重学术评审，可阅读文档并输出批注，不直接改写正文。"
                minRows={2}
                maxRows={4}
                style={{ fontSize: 13 }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                color: 'var(--text-muted)',
                marginBottom: 8
              }}>
                技能与权限
              </label>
              <div style={{ display: 'grid', gap: 8 }}>
                {(['assistant', 'document'] as const).map(group => (
                  <div key={group}>
                    <div style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      letterSpacing: '0.4px',
                    }}>
                      {group === 'assistant' ? '助手能力' : '文稿能力'}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {AGENT_CAPABILITY_DEFINITIONS
                        .filter(capability => capability.group === group)
                        .map(capability => {
                          const active = editingCapabilities.includes(capability.id)
                          return (
                            <button
                              key={capability.id}
                              type="button"
                              onClick={() => handleToggleCapability(capability.id)}
                              style={{
                                textAlign: 'left',
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: active ? '1px solid var(--accent-color)' : '1px solid var(--border-color)',
                                background: active ? 'rgba(0, 153, 255, 0.08)' : 'var(--bg-secondary)',
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                                  {capability.label}
                                </span>
                                <span style={{
                                  fontSize: 11,
                                  color: active ? 'var(--accent-color)' : 'var(--text-muted)',
                                  fontWeight: 600,
                                }}>
                                  {active ? '已启用' : '未启用'}
                                </span>
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                {capability.description}
                              </div>
                            </button>
                          )
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ 
                display: 'block', 
                fontSize: 12, 
                color: 'var(--text-muted)', 
                marginBottom: 6 
              }}>
                系统 Prompt
              </label>
              <Textarea
                value={editingPrompt}
                onValueChange={setEditingPrompt}
                placeholder="输入智能体的系统提示词，定义其角色、行为和专业领域..."
                minRows={8}
                maxRows={16}
                style={{ fontSize: 13 }}
              />
              {editingAgent?.isPreset && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                  这是预设智能体，您可以继续微调它的 prompt 与权限配置
                </p>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={handleClose}>取消</Button>
            <Button color="primary" onPress={handleSave}>保存</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

// 智能体卡片
function AgentCard({ 
  agent, 
  onEdit, 
  onDelete 
}: { 
  agent: Agent
  onEdit: (agent: Agent) => void
  onDelete: (id: string, e: React.MouseEvent) => void
}) {
  const normalizedAgent = normalizeAgent(agent)
  const capabilityLabels = getAgentCapabilityDefinitions(normalizedAgent).map(capability => capability.label)
  const previewText = normalizedAgent.description || normalizedAgent.prompt || '点击编辑填写 prompt...'

  return (
    <div
      onClick={() => onEdit(normalizedAgent)}
      style={{
        padding: '10px 12px',
        background: 'var(--bg-secondary)',
        borderRadius: 8,
        cursor: 'pointer',
        border: '1px solid var(--border-color)',
        marginBottom: 6,
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent-color)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border-color)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ 
            fontSize: 13, 
            fontWeight: 500, 
            color: 'var(--text-primary)',
          }}>
            {normalizedAgent.title || '未命名智能体'}
          </span>
          {normalizedAgent.isDefault && (
            <span style={{
              fontSize: 9,
              padding: '1px 4px',
              background: 'var(--accent-color)',
              color: 'white',
              borderRadius: 3,
            }}>
              默认
            </span>
          )}
          {normalizedAgent.isPreset && (
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
        <Tooltip content={normalizedAgent.isPreset ? '预设不可删除' : '删除'} placement="top">
          <button
            onClick={(e) => onDelete(normalizedAgent.id, e)}
            style={{
              background: 'transparent',
              border: 'none',
              color: normalizedAgent.isPreset ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: normalizedAgent.isPreset ? 'not-allowed' : 'pointer',
              padding: '2px 4px',
              fontSize: 11,
            }}
          >
            删除
          </button>
        </Tooltip>
      </div>
      {capabilityLabels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {capabilityLabels.slice(0, 4).map(label => (
            <span
              key={label}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 999,
                background: 'rgba(0, 153, 255, 0.08)',
                color: 'var(--accent-color)',
                border: '1px solid rgba(0, 153, 255, 0.16)',
              }}
            >
              {label}
            </span>
          ))}
          {capabilityLabels.length > 4 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              +{capabilityLabels.length - 4}
            </span>
          )}
        </div>
      )}
      <p style={{ 
        fontSize: 11, 
        color: 'var(--text-muted)', 
        margin: 0,
        lineHeight: 1.4,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {previewText}
      </p>
    </div>
  )
}
