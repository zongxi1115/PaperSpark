'use client'
import { useState } from 'react'
import { Button, Tooltip } from '@heroui/react'

type SidebarTab = 'search' | 'knowledge' | 'notes' | 'read'

interface SidebarItem {
  id: SidebarTab
  label: string
  icon: React.ReactNode
}

const sidebarItems: SidebarItem[] = [
  {
    id: 'search',
    label: '资料漫游检索',
    icon: <SearchIcon />,
  },
  {
    id: 'knowledge',
    label: '我的知识库',
    icon: <KnowledgeIcon />,
  },
  {
    id: 'notes',
    label: '随记想法',
    icon: <NotesIcon />,
  },
  {
    id: 'read',
    label: '知识库精读',
    icon: <ReadIcon />,
  },
]

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>(null)

  return (
    <aside
      style={{
        width: 48,
        flexShrink: 0,
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Icon buttons */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center',
        padding: '12px 0',
        gap: 4,
      }}>
        {sidebarItems.map(item => (
          <Tooltip key={item.id} content={item.label} placement="left">
            <Button
              isIconOnly
              size="sm"
              variant={activeTab === item.id ? 'solid' : 'light'}
              color={activeTab === item.id ? 'primary' : 'default'}
              onPress={() => setActiveTab(activeTab === item.id ? null : item.id)}
              style={{
                borderRadius: 8,
              }}
            >
              {item.icon}
            </Button>
          </Tooltip>
        ))}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Bottom section - can add more items later */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        gap: 4,
        borderTop: '1px solid var(--border-color)',
      }}>
        <Tooltip content="帮助" placement="left">
          <Button
            isIconOnly
            size="sm"
            variant="light"
          >
            <HelpIcon />
          </Button>
        </Tooltip>
      </div>
    </aside>
  )
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function KnowledgeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  )
}

function NotesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  )
}

function ReadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
