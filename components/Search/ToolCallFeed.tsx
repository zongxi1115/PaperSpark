'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ToolCallEvent } from '@/lib/literatureSearchTypes'
import { OdometerNumber } from './OdometerNumber'

const TOOL_CONFIG: Record<string, { icon: string; label: string }> = {
  searchWorks: { icon: 'search', label: '搜索文献' },
  getConceptTree: { icon: 'branch', label: '获取概念树' },
  getRelatedWorks: { icon: 'link', label: '关联文献' },
  filterWorks: { icon: 'filter', label: '筛选结果' },
  getAuthorWorks: { icon: 'author', label: '获取作者作品' },
  rankAndDeduplicate: { icon: 'rank', label: '排序去重' },
}

function ToolIcon({ type, size = 14 }: { type: string; size?: number }) {
  const iconPath = useMemo(() => {
    switch (type) {
      case 'search':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        )
      case 'branch':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 12a3 3 0 003 3h9a3 3 0 003-3m-6 0V4.5m0 7.5l-3-3m3 3l3-3"
          />
        )
      case 'link':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
          />
        )
      case 'filter':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z"
          />
        )
      case 'author':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.219-.047-7.499-1.632z"
          />
        )
      case 'rank':
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"
          />
        )
      default:
        return (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.964m11.49-9.642l1.149-.964M7.501 19.795l.75-1.3m7.5-12.99l.75-1.3m-6.063 16.656l.26-1.477m2.605-14.772l.26-1.477m0 17.726l-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205L12 12m6.894 5.785l-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864l-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495"
          />
        )
    }
  }, [type])

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      width={size}
      height={size}
      style={{ display: 'block' }}
    >
      {iconPath}
    </svg>
  )
}

function LoadingDots({ reduceMotion }: { reduceMotion: boolean | null }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 2 }}>
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          animate={!reduceMotion ? { opacity: [0.3, 1, 0.3] } : undefined}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
          style={{
            width: 3,
            height: 3,
            borderRadius: '50%',
            background: 'currentColor',
          }}
        />
      ))}
    </span>
  )
}

function formatInputSummary(inputSummary: string): string {
  try {
    const parsed = JSON.parse(inputSummary)
    const parts: string[] = []
    
    if (parsed.query) {
      parts.push(`"${parsed.query}"`)
    }
    if (parsed.keyword) {
      parts.push(`关键词: ${parsed.keyword}`)
    }
    if (parsed.concept) {
      parts.push(`概念: ${parsed.concept}`)
    }
    if (parsed.workId) {
      parts.push(`文献ID: ${parsed.workId.slice(0, 12)}...`)
    }
    if (parsed.authorId) {
      parts.push(`作者ID: ${parsed.authorId.slice(0, 12)}...`)
    }
    if (parsed.direction) {
      const dirMap: Record<string, string> = {
        references: '参考文献',
        citations: '引用文献',
        related: '相关文献',
      }
      parts.push(`方向: ${dirMap[parsed.direction] || parsed.direction}`)
    }
    if (parsed.maxResults) {
      parts.push(`上限: ${parsed.maxResults}`)
    }
    if (parsed.fromYear || parsed.toYear) {
      const yearRange = [parsed.fromYear || '?', parsed.toYear || '?'].join('-')
      parts.push(`年份: ${yearRange}`)
    }
    if (parsed.minCitations) {
      parts.push(`引用≥${parsed.minCitations}`)
    }
    if (parsed.openAccessOnly) {
      parts.push('仅开放获取')
    }
    
    if (parts.length > 0) {
      return parts.join(' · ')
    }
  } catch {
    // 不是 JSON，直接返回原文
  }
  
  // 截断过长的文本
  if (inputSummary.length > 60) {
    return inputSummary.slice(0, 58) + '...'
  }
  return inputSummary
}

interface ToolCallFeedItemProps {
  call: ToolCallEvent
  isLatest: boolean
  reduceMotion: boolean | null
}

function ToolCallFeedItem({ call, isLatest, reduceMotion }: ToolCallFeedItemProps) {
  const config = TOOL_CONFIG[call.name] || {
    icon: call.icon || 'default',
    label: call.displayName || call.name.replace(/^remote:/, ''),
  }
  const isRunning = call.status === 'running'
  const formattedInput = formatInputSummary(call.inputSummary)

  return (
    <motion.div
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 16, filter: 'blur(4px)' }}
      animate={reduceMotion ? undefined : {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
      }}
      exit={reduceMotion ? undefined : {
        opacity: 0,
        y: -12,
        transition: { duration: 0.2, ease: 'easeOut' }
      }}
      transition={{
        type: 'spring',
        stiffness: 320,
        damping: 28,
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 10px',
        borderRadius: 6,
        background: isRunning
          ? 'rgba(251, 191, 36, 0.06)'
          : call.status === 'error'
            ? 'rgba(239, 68, 68, 0.05)'
            : 'rgba(15, 23, 42, 0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <motion.div
          animate={isRunning && !reduceMotion ? {
            opacity: [0.5, 1, 0.5],
          } : undefined}
          transition={isRunning ? {
            duration: 1.8,
            repeat: Infinity,
            ease: 'easeInOut',
          } : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            flexShrink: 0,
            opacity: isRunning ? 0.75 : 0.55,
          }}
        >
          <ToolIcon type={config.icon} size={13} />
        </motion.div>

        <motion.div
          animate={isRunning && !reduceMotion ? {
            opacity: [0.55, 1, 0.55],
          } : undefined}
          transition={isRunning ? {
            duration: 1.8,
            repeat: Infinity,
            ease: 'easeInOut',
          } : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: isRunning
              ? '#b45309'
              : call.status === 'error'
                ? '#dc2626'
                : 'rgba(15, 23, 42, 0.6)',
          }}
        >
          <span>{config.label}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 20 }}>
            {call.resultCount !== undefined ? (
              <OdometerNumber value={call.resultCount} />
            ) : call.status === 'error' ? '失败' : isRunning ? (
              <>
                <span>执行中</span>
                <LoadingDots reduceMotion={reduceMotion} />
              </>
            ) : '完成'}
          </span>
        </motion.div>
      </div>
      
      {formattedInput && (
        <div
          style={{
            fontSize: 11,
            color: 'rgba(15, 23, 42, 0.45)',
            lineHeight: 1.4,
            paddingLeft: 22,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={call.inputSummary}
        >
          {formattedInput}
        </div>
      )}

      {call.providerLabel && (
        <div
          style={{
            fontSize: 10,
            color: 'rgba(15, 23, 42, 0.4)',
            lineHeight: 1.4,
            paddingLeft: 22,
          }}
        >
          {call.providerLabel}
        </div>
      )}
    </motion.div>
  )
}

interface ToolCallFeedProps {
  calls: ToolCallEvent[]
  isLoading: boolean
  reduceMotion: boolean | null
}

export function ToolCallFeed({ calls, isLoading, reduceMotion }: ToolCallFeedProps) {
  const [expanded, setExpanded] = useState(false)

  const visibleCalls = useMemo(() => {
    return expanded ? calls : calls.slice(0, 3)
  }, [calls, expanded])

  if (calls.length === 0 && !isLoading) {
    return null
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '6px 8px',
        borderRadius: 10,
        background: 'rgba(15, 23, 42, 0.015)',
        border: '1px solid rgba(15, 23, 42, 0.04)',
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {visibleCalls.map((call, index) => (
          <ToolCallFeedItem
            key={call.id}
            call={call}
            isLatest={index === 0}
            reduceMotion={reduceMotion}
          />
        ))}
      </AnimatePresence>

      {calls.length > 3 && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            height: 24,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 11,
            color: 'rgba(59, 130, 246, 0.7)',
            fontWeight: 500,
          }}
        >
          {expanded ? (
            <>
              <span>收起</span>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </>
          ) : (
            <>
              <span>+{calls.length - 3} 更多调用</span>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </>
          )}
        </motion.button>
      )}
    </div>
  )
}

export function ToolCallChainModal() {
  return null
}
