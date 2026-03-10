import { EditorPageContent } from '@/components/Editor/EditorPage'
import { getSettings } from '@/lib/storage'

// 动态导入三线表样式
if (typeof window !== 'undefined' && getSettings().threeLineTable) {
  console.log('三线表功能已启用')
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function EditorRoute({ params }: Props) {
  const { id } = await params
  return <EditorPageContent key={id} docId={id} />
}
