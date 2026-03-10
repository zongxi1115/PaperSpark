'use client'
import { useState, useCallback, useEffect } from 'react'
import { Button, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast, Tooltip } from '@heroui/react'
import { getAgents, saveAgent, deleteAgent, generateId } from '@/lib/storage'
import type { Agent } from '@/lib/types'

export function AgentSettingsPanel() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingPrompt, setEditingPrompt] = useState('')
  const { isOpen, onOpen, onClose } = useDisclosure()

  // 加载
  useEffect(() => {
    setAgents(getAgents())
  }, [])

  // 新增自定义智能体
  const handleCreate = useCallback(() => {
    const newAgent: Agent = {
      id: generateId(),
      title: '',
      prompt: '',
      isPreset: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setEditingAgent(newAgent)
    setEditingTitle('')
    setEditingPrompt('')
    onOpen()
  }, [onOpen])

  // 点击编辑
  const handleEdit = useCallback((agent: Agent) => {
    setEditingAgent(agent)
    setEditingTitle(agent.title)
    setEditingPrompt(agent.prompt)
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
      prompt: editingPrompt,
      updatedAt: new Date().toISOString(),
    }
    saveAgent(updated)
    setAgents(getAgents())
    onClose()
    addToast({ title: '保存成功', color: 'success' })
  }, [editingAgent, editingTitle, editingPrompt, onClose])

  // 关闭
  const handleClose = useCallback(() => {
    setEditingAgent(null)
    onClose()
  }, [onClose])

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
                  这是预设智能体，prompt 留空供您自定义填写
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
  return (
    <div
      onClick={() => onEdit(agent)}
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
            {agent.title || '未命名智能体'}
          </span>
          {agent.isDefault && (
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
        <Tooltip content={agent.isPreset ? '预设不可删除' : '删除'} placement="top">
          <button
            onClick={(e) => onDelete(agent.id, e)}
            style={{
              background: 'transparent',
              border: 'none',
              color: agent.isPreset ? 'var(--text-muted)' : 'var(--text-secondary)',
              cursor: agent.isPreset ? 'not-allowed' : 'pointer',
              padding: '2px 4px',
              fontSize: 11,
            }}
          >
            删除
          </button>
        </Tooltip>
      </div>
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
        {agent.prompt || '点击编辑填写 prompt...'}
      </p>
    </div>
  )
}
