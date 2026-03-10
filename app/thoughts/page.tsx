import { ThoughtPanel } from '@/components/Thought/ThoughtPanel'

export default function ThoughtsPage() {
  return (
    <div style={{ 
      maxWidth: 1200, 
      margin: '0 auto', 
      height: '100%',
      overflowY: 'auto',
      background: 'var(--bg-primary)',
    }}>
      <ThoughtPanel />
    </div>
  )
}
