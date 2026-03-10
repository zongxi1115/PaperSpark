'use client'
import { HeroUIProvider, ToastProvider } from '@heroui/react'
import { useRouter } from 'next/navigation'

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  return (
    <HeroUIProvider navigate={router.push}>
      <ToastProvider placement="top-right" />
      {children}
    </HeroUIProvider>
  )
}
