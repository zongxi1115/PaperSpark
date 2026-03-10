import { EditorPageContent } from '@/components/Editor/EditorPage'
import { getSettings } from '@/lib/storage'
// import './threeline.css'
if(getSettings().threeLineTable) {
  console.log('三线表功能已启用，加载样式...')
  import('./threeline.css')
}
interface Props {
  params: Promise<{ id: string }>
}

export default async function EditorRoute({ params }: Props) {
  const { id } = await params
  return <EditorPageContent key={id} docId={id} />
}
