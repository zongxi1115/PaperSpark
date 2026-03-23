'use client'
import { useState, useEffect } from 'react'
import type { Block } from '@blocknote/core'
import Link from 'next/link'
import { Button, Tooltip } from '@heroui/react'
import { motion, AnimatePresence } from 'framer-motion'
import { extractInlineText } from '@/lib/agentDocument'

interface TocEntry {
  id: string
  text: string
  level: number
}

function extractToc(blocks: Block[]): TocEntry[] {
  const entries: TocEntry[] = []
  for (const block of blocks) {
    if (block.type === 'heading') {
      const b = block as { type: 'heading'; id: string; props: { level: number }; content: unknown }
      const text = extractInlineText(b.content)
      if (text.trim()) {
        const level = b.props.level ?? 1
        entries.push({ id: b.id, text: text.trim(), level })
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
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const toc = extractToc(blocks)

  const scrollToBlock = (blockId: string) => {
    const el = document.querySelector(`[data-id="${blockId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSection(blockId)
    }
  }

  // Intersection Observer for active section tracking
  useEffect(() => {
    if (toc.length === 0) return

    const headingElements = toc
      .map(entry => document.querySelector(`[data-id="${entry.id}"]`))
      .filter(Boolean) as Element[]

    if (headingElements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const blockId = entry.target.getAttribute('data-id')
            if (blockId) setActiveSection(blockId)
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    )

    headingElements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [toc])

  return (
    <AnimatePresence initial={false}>
      {!isCollapsed && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 220, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          className="h-full border-r flex flex-col z-10 shrink-0 overflow-hidden"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
        >
          {/* Header */}
          <div className="p-4 flex items-center gap-2 w-[220px]">
            <Tooltip content="返回文档列表" placement="right">
              <Link href="/documents">
                <Button isIconOnly size="sm" variant="light" radius="lg">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15,18 9,12 15,6" />
                  </svg>
                </Button>
              </Link>
            </Tooltip>
            <span className="font-medium text-sm truncate flex-1" style={{ color: 'var(--text-primary)' }} title={docTitle}>
              {docTitle || '无标题文档'}
            </span>
          </div>

          {/* TOC */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 w-[220px]">
            <div className="text-[11px] font-bold uppercase tracking-widest mb-4 px-2" style={{ color: 'var(--text-muted)' }}>目录</div>
            
            {toc.length === 0 ? (
              <p className="text-xs px-2 italic" style={{ color: 'var(--text-muted)' }}>
                使用标题 (# ## ###) 生成目录
              </p>
            ) : (
              <nav className="space-y-0.5 relative">
                {toc.map((entry) => {
                  const indent = (entry.level - 1) * 12
                  return (
                    <button
                      key={entry.id}
                      onClick={() => scrollToBlock(entry.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors relative z-10 ${
                        activeSection === entry.id
                          ? 'font-medium'
                          : entry.level === 1
                            ? 'font-medium'
                            : ''
                      }`}
                      style={{
                        marginLeft: indent,
                        color: activeSection === entry.id
                          ? 'var(--accent-color)'
                          : entry.level === 1
                            ? 'var(--text-primary)'
                            : 'var(--text-secondary)',
                      }}
                    >
                      {activeSection === entry.id && (
                        <motion.div
                          layoutId="active-nav"
                          className="absolute inset-0 rounded-lg shadow-sm border -z-10"
                          style={{
                            background: 'var(--bg-primary)',
                            borderColor: 'var(--border-color)',
                          }}
                          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                        />
                      )}
                      <span className="block truncate">
                        {entry.text}
                      </span>
                    </button>
                  )
                })}
              </nav>
            )}
          </div>

          {/* Collapse button */}
          <div className="p-3 border-t w-[220px]" style={{ borderColor: 'var(--border-color)' }}>
            <button
              onClick={() => setIsCollapsed(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs rounded-lg transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="11,17 6,12 11,7" />
                <polyline points="18,17 13,12 18,7" />
              </svg>
              收起侧边栏
            </button>
          </div>
        </motion.aside>
      )}

      {/* Collapsed state - show expand button */}
      {isCollapsed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="h-full border-r flex flex-col items-center py-4 z-10 shrink-0"
          style={{ width: 48, background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}
        >
          <Tooltip content="展开侧边栏" placement="right">
            <button
              onClick={() => setIsCollapsed(false)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </button>
          </Tooltip>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
