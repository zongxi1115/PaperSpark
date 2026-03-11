'use client'
import { useState } from 'react'
import type { Block } from '@blocknote/core'
import Link from 'next/link'
import { Button, Divider, Tooltip } from '@heroui/react'

interface TocEntry {
  id: string
  text: string
  level: number
  number: string
}

function extractToc(blocks: Block[]): TocEntry[] {
  const entries: TocEntry[] = []
  const counters = [0, 0, 0] // 对应 level 1, 2, 3
  
  for (const block of blocks) {
    if (block.type === 'heading') {
      const b = block as { type: 'heading'; id: string; props: { level: number }; content: { type: string; text: string }[] }
      const text = b.content
        ?.filter(c => c.type === 'text')
        .map(c => c.text)
        .join('') ?? ''
      
      if (text.trim()) {
        const level = b.props.level ?? 1
        // 重置当前层级以下的计数器
        for (let i = level; i < 3; i++) {
          counters[i] = 0
        }
        // 增加当前层级计数
        counters[level - 1]++
        
        // 生成编号
        let number: string
        if (level === 1) {
          number = `${counters[0]}`
        } else if (level === 2) {
          number = `${counters[0]}.${counters[1]}`
        } else {
          number = `${counters[0]}.${counters[1]}.${counters[2]}`
        }
        
        entries.push({ id: b.id, text: text.trim(), level, number })
      }
    }
  }
  return entries
}

interface TocSidebarProps {
  blocks: Block[]
  docTitle: string
}

export function TocSidebar({ blocks, docTitle }: TocSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const toc = extractToc(blocks)

  const scrollToBlock = (blockId: string) => {
    // BlockNote renders blocks with data-id attribute
    const el = document.querySelector(`[data-id="${blockId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const collapsedWidth = 48
  const expandedWidth = 240

  return (
    <aside
      style={{
        width: isCollapsed ? collapsedWidth : expandedWidth,
        flexShrink: 0,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.2s ease',
      }}
    >
      {/* Header with collapse toggle */}
      <div style={{ 
        padding: isCollapsed ? '12px 8px' : '12px 12px 8px', 
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsed ? 'center' : 'flex-start',
      }}>
        {isCollapsed ? (
          <Tooltip content="展开侧边栏" placement="right">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              onPress={() => setIsCollapsed(false)}
            >
              <ExpandIcon />
            </Button>
          </Tooltip>
        ) : (
          <>
            <Tooltip content="返回文档列表" placement="right">
              <Link href="/documents">
                <Button size="sm" variant="light" color="default" startContent={<BackIcon />}
                  style={{ justifyContent: 'flex-start' }}
                >
                  文档列表
                </Button>
              </Link>
            </Tooltip>
            <div style={{ flex: 1 }} />
            <Tooltip content="收起侧边栏" placement="left">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => setIsCollapsed(true)}
              >
                <CollapseIcon />
              </Button>
            </Tooltip>
          </>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* TOC */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 16px 8px' }}>
              目录
            </p>

            {toc.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 16px', fontStyle: 'italic' }}>
                使用标题(# ## ###)生成目录
              </p>
            ) : (
              <nav style={{ padding: '0 8px' }}>
                {toc.map((entry) => {
                  const indent = (entry.level - 1) * 16
                  
                  return (
                    <button
                      key={entry.id}
                      onClick={() => scrollToBlock(entry.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        width: '100%',
                        textAlign: 'left',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '8px 10px',
                        marginBottom: 4,
                        marginLeft: indent,
                        fontSize: 13,
                        fontWeight: entry.level === 1 ? 600 : 400,
                        color: entry.level === 1 ? 'var(--text-primary)' : 'var(--text-secondary)',
                        lineHeight: 1.5,
                        borderRadius: 8,
                        transition: 'all 0.15s ease',
                        wordBreak: 'break-word',
                        position: 'relative',
                      }}
                      onMouseEnter={e => { 
                        e.currentTarget.style.background = 'var(--bg-tertiary)'
                      }}
                      onMouseLeave={e => { 
                        e.currentTarget.style.background = 'none'
                      }}
                    >
                      {/* 编号 */}
                      <span style={{
                        minWidth: entry.level === 1 ? 24 : 44,
                        fontWeight: entry.level === 1 ? 600 : 400,
                        color: entry.level === 1 ? 'var(--primary)' : 'var(--text-muted)',
                        marginRight: 8,
                        fontSize: entry.level === 1 ? 13 : 12,
                      }}>
                        {entry.number}
                      </span>
                      <span style={{ 
                        flex: 1, 
                        overflow: 'hidden', 
                        textOverflow: 'ellipsis', 
                        whiteSpace: 'nowrap',
                      }}>
                        {entry.text}
                      </span>
                    </button>
                  )
                })}
              </nav>
            )}
          </div>
        </>
      )}
    </aside>
  )
}



function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="11,17 6,12 11,7" />
      <polyline points="18,17 13,12 18,7" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="13,17 18,12 13,7" />
      <polyline points="6,17 11,12 6,7" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15,18 9,12 15,6" />
    </svg>
  )
}
