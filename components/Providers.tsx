'use client'
import { HeroUIProvider, ToastProvider } from '@heroui/react'
import { useRouter } from 'next/navigation'
import { VercelPreviewNotice } from '@/components/VercelPreviewNotice'

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  return (
    <HeroUIProvider navigate={router.push}>
      <ToastProvider placement="top-right" />
      <VercelPreviewNotice />
      {children}
    </HeroUIProvider>
  )
}
