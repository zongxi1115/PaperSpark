'use client'

import { useEffect, useRef } from 'react'

interface CanvasStencilProps {
  hostElement: HTMLElement | null
  collapsed: boolean
  isDark: boolean
  onToggle: () => void
}

export function CanvasStencil({ hostElement, collapsed, isDark, onToggle }: CanvasStencilProps) {
  const mountRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const mountNode = mountRef.current
    if (!mountNode || !hostElement) return

    mountNode.innerHTML = ''
    mountNode.appendChild(hostElement)

    return () => {
      if (mountNode.contains(hostElement)) {
        mountNode.removeChild(hostElement)
      }
    }
  }, [hostElement])

  return (
    <aside
      style={{
        width: collapsed ? 56 : 240,
        transition: 'width 220ms ease',
        borderRight: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(148, 163, 184, 0.22)'}`,
        background: isDark ? 'rgba(2, 6, 23, 0.86)' : 'rgba(248, 250, 252, 0.94)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          padding: collapsed ? '0 8px' : '0 14px',
          borderBottom: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.18)'}`,
        }}
      >
        {!collapsed ? (
          <div style={{ fontSize: 13, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>
            图形物料
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggle}
          style={{
            width: 30,
            height: 30,
            borderRadius: 999,
            border: 'none',
            cursor: 'pointer',
            color: isDark ? '#e2e8f0' : '#0f172a',
            background: isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.96)',
          }}
          aria-label={collapsed ? '展开物料库' : '收起物料库'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {collapsed ? (
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            color: isDark ? 'rgba(203, 213, 225, 0.72)' : 'rgba(71, 85, 105, 0.82)',
            writingMode: 'vertical-rl',
            letterSpacing: 2,
            fontSize: 12,
          }}
        >
          物料库
        </div>
      ) : (
        <div
          ref={mountRef}
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            padding: 8,
          }}
        />
      )}
    </aside>
  )
}
