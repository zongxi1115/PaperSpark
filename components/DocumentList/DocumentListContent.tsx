'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
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

  return (
    <div style={{ padding: '32px', maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>我的文档</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            共 {documents.length} 篇文档
          </p>
        </div>
        <Button color="primary" startContent={<PlusIcon />} onPress={handleNew}>
          新建文档
        </Button>
      </div>

      <Divider style={{ marginBottom: 20 }} />

      {/* Document list */}
      {documents.length === 0 ? (
        <Card shadow="sm" style={{ padding: '40px 24px' }}>
          <CardBody style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <div style={{ color: 'var(--text-muted)' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>还没有文档，快来创建第一篇吧</p>
            <Button color="primary" variant="flat" onPress={handleNew}>创建文档</Button>
          </CardBody>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {documents.map(doc => (
            <Card
              key={doc.id}
              shadow="sm"
              style={{ transition: 'transform 0.15s, box-shadow 0.15s' }}
            >
              <CardHeader
                onClick={() => handleOpenDoc(doc.id)}
                style={{ padding: '14px 16px 6px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: 8 }}>
                  <div style={{ color: 'var(--accent-color)', flexShrink: 0, marginTop: 2 }}>
                    <DocIcon />
                  </div>
                  <p style={{ fontWeight: 500, fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word', flex: 1, margin: 0 }}>
                    {doc.title}
                  </p>
                </div>
              </CardHeader>
              <Divider />
              <CardBody style={{ padding: '8px 16px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    更新于 {formatDate(doc.updatedAt)}
                  </span>
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    isIconOnly
                    onPress={() => confirmDelete(doc)}
                    aria-label="删除文档"
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Delete confirm modal */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            <p>
              确定要删除文档 &ldquo;<strong>{deleteTarget?.title}</strong>&rdquo; 吗？此操作无法撤销。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>取消</Button>
            <Button color="danger" onPress={handleDelete}>删除</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
