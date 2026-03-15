'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
  Tooltip,
} from '@heroui/react'
import { formatDate, generateId, getDocuments, saveDocuments, deleteDocument } from '@/lib/storage'
import type { AppDocument } from '@/lib/types'

export function DocumentListContent() {
  const [documents, setDocuments] = useState<AppDocument[]>([])
  const [deleteTarget, setDeleteTarget] = useState<AppDocument | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const router = useRouter()

  useEffect(() => {
    setDocuments(getDocuments())
  }, [])

  const handleNew = useCallback(() => {
    const now = new Date().toISOString()
    const newDoc: AppDocument = {
      id: generateId(),
      title: '新建文档',
      content: [],
      createdAt: now,
      updatedAt: now,
    }
    const docs = [newDoc, ...getDocuments()]
    saveDocuments(docs)
    router.push(`/editor/${newDoc.id}`)
  }, [router])

  const handleOpenDoc = useCallback((docId: string) => {
    router.push(`/editor/${docId}`)
  }, [router])

  const confirmDelete = useCallback((doc: AppDocument) => {
    setDeleteTarget(doc)
    onOpen()
  }, [onOpen])

  const handleDelete = useCallback(() => {
    if (!deleteTarget) return
    deleteDocument(deleteTarget.id)
    setDocuments(prev => prev.filter(d => d.id !== deleteTarget.id))
    setDeleteTarget(null)
    onClose()
  }, [deleteTarget, onClose])

  // 格式化作者显示
  const formatAuthors = (doc: AppDocument): string => {
    if (doc.articleAuthors && doc.articleAuthors.length > 0) {
      const names = doc.articleAuthors.map(a => a.name)
      if (names.length <= 2) return names.join(', ')
      return `${names[0]}, ${names[1]} 等`
    }
    return '-'
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>我的文档</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            共 {documents.length} 篇文档
          </p>
        </div>
        <Button color="primary" size="sm" startContent={<PlusIcon />} onPress={handleNew}>
          新建文档
        </Button>
      </div>

      {/* Document list table */}
      {documents.length === 0 ? (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          gap: 12, 
          padding: '60px 24px',
          background: 'var(--bg-primary)',
          borderRadius: 12,
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ color: 'var(--text-muted)' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>还没有文档，快来创建第一篇吧</p>
          <Button color="primary" variant="flat" size="sm" onPress={handleNew}>创建文档</Button>
        </div>
      ) : (
        <div style={{ 
          background: 'var(--bg-primary)', 
          borderRadius: 12, 
          border: '1px solid var(--border-color)',
          overflow: 'hidden'
        }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 140px 160px 80px',
            padding: '12px 16px',
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: 12,
            color: 'var(--text-muted)',
            fontWeight: 500,
          }}>
            <div>标题</div>
            <div>作者</div>
            <div>修改时间</div>
            <div style={{ textAlign: 'center' }}>操作</div>
          </div>
          
          {/* Table body */}
          {documents.map((doc, index) => (
            <div
              key={doc.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 140px 160px 80px',
                padding: '14px 16px',
                borderBottom: index < documents.length - 1 ? '1px solid var(--border-color)' : 'none',
                fontSize: 14,
                alignItems: 'center',
                transition: 'background 0.15s',
                cursor: 'pointer',
              }}
              onClick={() => handleOpenDoc(doc.id)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-secondary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              {/* 标题 */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 10,
                overflow: 'hidden',
              }}>
                <div style={{ color: 'var(--accent-color)', flexShrink: 0 }}>
                  <DocIcon />
                </div>
                <span style={{ 
                  fontWeight: 500, 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  whiteSpace: 'nowrap' 
                }}>
                  {doc.title}
                </span>
              </div>
              
              {/* 作者 */}
              <div style={{ 
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {formatAuthors(doc)}
              </div>
              
              {/* 修改时间 */}
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                {formatDate(doc.updatedAt)}
              </div>
              
              {/* 操作 */}
              <div style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                <Dropdown>
                  <DropdownTrigger>
                    <Button
                      size="sm"
                      variant="light"
                      isIconOnly
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <MoreIcon />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu aria-label="文档操作">
                    <DropdownItem
                      key="open"
                      startContent={<EditIcon />}
                      onPress={() => handleOpenDoc(doc.id)}
                    >
                      编辑
                    </DropdownItem>
                    <DropdownItem
                      key="delete"
                      color="danger"
                      className="text-danger"
                      startContent={<TrashIcon />}
                      onPress={() => confirmDelete(doc)}
                    >
                      删除
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirm modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="sm">
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            <p style={{ fontSize: 14 }}>
              确定要删除文档 &ldquo;<strong>{deleteTarget?.title}</strong>&rdquo; 吗？此操作无法撤销。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" size="sm" onPress={onClose}>取消</Button>
            <Button color="danger" size="sm" onPress={handleDelete}>删除</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}