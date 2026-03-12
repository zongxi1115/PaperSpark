'use client'

import dynamic from 'next/dynamic'
import { use } from 'react'

// 动态导入编辑器组件，禁用 SSR 以避免 blocknote 的 window 访问错误
const EditorPageContent = dynamic(
  () => import('@/components/Editor/EditorPage').then(mod => mod.EditorPageContent),
  { ssr: false }
)

interface Props {
  params: Promise<{ id: string }>
}

export default function EditorRoute({ params }: Props) {
  const { id } = use(params)
  return <EditorPageContent key={id} docId={id} />
}
