'use client'
import { useState } from 'react'
import { Tooltip } from '@heroui/react'
import { KnowledgePanel } from '@/components/Knowledge/KnowledgePanel'
import { ThoughtNotesPanel } from '@/components/Thought/ThoughtNotesPanel'
import { AgentSettingsPanel } from '@/components/Agent/AgentSettingsPanel'

type SidebarTab = 'search' | 'knowledge' | 'notes' | 'agents' | 'read'

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
    id: 'agents',
    label: '智能体设定',
    icon: <AgentIcon />,
  },
  {
    id: 'read',
    label: '知识库精读',
    icon: <ReadIcon />,
  },
]

export function RightSidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab | null>(null)
  const [panelWidth, setPanelWidth] = useState(320)
  const [isResizing, setIsResizing] = useState(false)
  const [isHoveringHandle, setIsHoveringHandle] = useState(false)

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const startX = e.clientX
    const startWidth = panelWidth

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = startWidth - (e.clientX - startX)
      if (newWidth >= 220 && newWidth <= 680) {
        setPanelWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 展开的面板 */}
      {activeTab && (
        <div 
          style={{ 
            position: 'relative',
            width: panelWidth, 
            background: 'var(--bg-primary)', 
            borderLeft: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {/* 面板标题 */}
          <div style={{ 
            padding: '12px 16px', 
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {sidebarItems.find(i => i.id === activeTab)?.label}
            </span>
          </div>

          {/* 面板内容 */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {activeTab === 'knowledge' && <KnowledgePanel />}
            {activeTab === 'search' && <PlaceholderPanel title="资料漫游检索" desc="功能开发中..." />}
            {activeTab === 'notes' && <ThoughtNotesPanel />}
            {activeTab === 'agents' && <AgentSettingsPanel />}
            {activeTab === 'read' && <PlaceholderPanel title="知识库精读" desc="功能开发中..." />}
          </div>

          {/* 可拖拽调整宽度 */}
          <div
            onMouseDown={handleMouseDown}
            onMouseEnter={() => setIsHoveringHandle(true)}
            onMouseLeave={() => setIsHoveringHandle(false)}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 6,
              cursor: 'col-resize',
              zIndex: 10,
              background: (isResizing || isHoveringHandle)
                ? 'var(--accent-color)'
                : 'transparent',
              opacity: isResizing ? 1 : isHoveringHandle ? 0.5 : 0,
              transition: 'background 0.15s, opacity 0.15s',
            }}
          />
        </div>
      )}

      {/* 图标侧边栏 */}
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
              <button
                onClick={() => setActiveTab(activeTab === item.id ? null : item.id)}
                style={{
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: activeTab === item.id ? 'var(--accent-color)' : 'transparent',
                  color: activeTab === item.id ? 'white' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {item.icon}
              </button>
            </Tooltip>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Bottom section */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 0',
          gap: 4,
          borderTop: '1px solid var(--border-color)',
        }}>
          <Tooltip content="帮助" placement="left">
            <button
              style={{
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                color: 'var(--text-muted)',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <HelpIcon />
            </button>
          </Tooltip>
        </div>
      </aside>
    </div>
  )
}

function PlaceholderPanel({ title, desc }: { title: string; desc: string }) {
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      height: '100%',
      color: 'var(--text-muted)',
      padding: 20,
      textAlign: 'center',
    }}>
      <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 12 }}>{desc}</p>
    </div>
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

function AgentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 8V4H8" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 8h.01" />
      <path d="M8 8h.01" />
      <path d="M12 12h.01" />
      <rect x="6" y="8" width="12" height="12" rx="2" />
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
