'use client'
import { useState, useCallback, useEffect } from 'react'
import { Button, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, addToast } from '@heroui/react'
import { getThoughts, saveThought, deleteThought, generateId } from '@/lib/storage'
import type { Thought } from '@/lib/types'
import { ThoughtCard } from './ThoughtCard'
import { ThoughtEditor } from './ThoughtEditor'

export function ThoughtPanel() {
  const [thoughts, setThoughts] = useState<Thought[]>([])
  const [editingThought, setEditingThought] = useState<Thought | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [editingTitle, setEditingTitle] = useState('')
  const [editingSummary, setEditingSummary] = useState('')

  // 加载想法列表
  useEffect(() => {
    setThoughts(getThoughts())
  }, [])

  // 新增想法
  const handleCreate = useCallback(() => {
    const newThought: Thought = {
      id: generateId(),
      title: '新想法',
      summary: '',
      content: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    saveThought(newThought)
    setThoughts(getThoughts())
    setEditingThought(newThought)
    setEditingTitle(newThought.title)
    setEditingSummary(newThought.summary)
    onOpen()
  }, [onOpen])

  // 点击卡片进入编辑
  const handleCardClick = useCallback((thought: Thought) => {
    setEditingThought(thought)
    setEditingTitle(thought.title)
    setEditingSummary(thought.summary)
    onOpen()
  }, [onOpen])

  // 删除想法
  const handleDelete = useCallback((id: string) => {
    deleteThought(id)
    setThoughts(getThoughts())
    addToast({ title: '已删除', color: 'success' })
  }, [])

  // 保存编辑
  const handleSave = useCallback((thought: Thought) => {
    const updated = {
      ...thought,
      title: editingTitle,
      summary: editingSummary,
      updatedAt: new Date().toISOString(),
    }
    saveThought(updated)
    setThoughts(getThoughts())
  }, [editingTitle, editingSummary])

  // 关闭编辑器时保存
  const handleClose = useCallback(() => {
    if (editingThought) {
      handleSave(editingThought)
    }
    onClose()
    setEditingThought(null)
  }, [editingThought, handleSave, onClose])

  // 更新标题和概述
  const handleTitleChange = useCallback((value: string) => {
    setEditingTitle(value)
  }, [])

  const handleSummaryChange = useCallback((value: string) => {
    setEditingSummary(value)
  }, [])

  return (
    <div style={{ padding: 24 }}>
      {/* 头部 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: 24 
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
          随记想法
        </h1>
        <Button
          color="primary"
          size="sm"
          onPress={handleCreate}
        >
          + 新增想法
        </Button>
      </div>

      {/* 卡片列表 */}
      {thoughts.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          padding: '60px 20px', 
          color: 'var(--text-muted)',
          background: 'var(--bg-secondary)',
          borderRadius: 12,
          border: '2px dashed var(--border-color)'
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💭</div>
          <div style={{ fontSize: 16, marginBottom: 8 }}>还没有记录任何想法</div>
          <div style={{ fontSize: 14 }}>点击上方「新增想法」开始记录</div>
        </div>
      ) : (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16 
        }}>
          {thoughts.map(thought => (
            <ThoughtCard
              key={thought.id}
              thought={thought}
              onClick={() => handleCardClick(thought)}
              onDelete={() => handleDelete(thought.id)}
            />
          ))}
        </div>
      )}

      {/* 编辑模态框 */}
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        size="5xl"
        scrollBehavior="inside"
        placement="center"
      >
        <ModalContent>
          <ModalHeader style={{ paddingBottom: 8 }}>
            <div style={{ width: '100%' }}>
              <Input
                value={editingTitle}
                onValueChange={handleTitleChange}
                size="lg"
                variant="underlined"
                placeholder="想法标题..."
                style={{ fontSize: 20, fontWeight: 600 }}
              />
            </div>
          </ModalHeader>
          <ModalBody style={{ paddingTop: 0 }}>
            {editingThought && (
              <ThoughtEditor
                thought={editingThought}
                title={editingTitle}
                summary={editingSummary}
                onTitleChange={handleTitleChange}
                onSummaryChange={handleSummaryChange}
                onSave={handleSave}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={handleClose}>
              保存并关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
