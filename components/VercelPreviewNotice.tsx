'use client'

import { useMemo, useState } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'

const PREVIEW_NOTICE_ACK_DATE_KEY = 'paper_reader_vercel_preview_notice_ack_date'

function getTodayDateKey(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shouldShowTodayNotice(): boolean {
  if (typeof window === 'undefined') return false

  const ackDate = window.localStorage.getItem(PREVIEW_NOTICE_ACK_DATE_KEY)
  return ackDate !== getTodayDateKey()
}

function markTodayNoticeAcknowledged(): void {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(PREVIEW_NOTICE_ACK_DATE_KEY, getTodayDateKey())
}

function detectVercelEnvironment(): boolean {
  const envVercel = process.env.NEXT_PUBLIC_VERCEL === '1'
  const envVercelEnv = Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV)
  const envVercelUrl = Boolean(process.env.NEXT_PUBLIC_VERCEL_URL)

  if (envVercel || envVercelEnv || envVercelUrl) return true
  if (typeof window === 'undefined') return false

  return window.location.hostname.endsWith('.vercel.app')
}

export function VercelPreviewNotice() {
  const isVercel = useMemo(() => detectVercelEnvironment(), [])
  const [isOpen, setIsOpen] = useState(isVercel && shouldShowTodayNotice())

  const handleAcknowledge = () => {
    markTodayNoticeAcknowledged()
    setIsOpen(false)
  }

  if (!isVercel) return null

  return (
    <Modal isOpen={isOpen} onClose={handleAcknowledge} isDismissable={false} hideCloseButton>
      <ModalContent>
        <ModalHeader>预览版本说明</ModalHeader>
        <ModalBody>
          <p>
            当前仅为预览展示版本，无完整功能。
          </p>
          <p>
            由于Vercel未部署 Python 对应微服务，Python 代码运行、知识库精读、RAG 检索等功能均无法体验。
          </p>
          <p>
            如需完整体验请参考教程部署，同时也保障你的知识产权。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button color="primary" onPress={handleAcknowledge}>
            我知道了
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
