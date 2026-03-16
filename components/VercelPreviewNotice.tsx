'use client'

import { useMemo, useState } from 'react'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'

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
  const [isOpen, setIsOpen] = useState(isVercel)

  if (!isVercel) return null

  return (
    <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} isDismissable={false} hideCloseButton>
      <ModalContent>
        <ModalHeader>预览版本说明</ModalHeader>
        <ModalBody>
          <p>
            当前仅为预览展示版本，无完整功能。
          </p>
          <p>
            由于未部署 Python 对应微服务，Python 代码运行、知识库精读、RAG 检索等功能均无法体验。
          </p>
          <p>
            如需完整体验请自行部署，同时也保障你的知识产权。
          </p>
        </ModalBody>
        <ModalFooter>
          <Button color="primary" onPress={() => setIsOpen(false)}>
            我知道了
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
