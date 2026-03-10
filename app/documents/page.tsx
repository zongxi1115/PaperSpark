import { DocumentListContent } from '@/components/DocumentList/DocumentListContent'

export default function DocumentsPage() {
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-secondary)' }}>
      <DocumentListContent />
    </div>
  )
}
