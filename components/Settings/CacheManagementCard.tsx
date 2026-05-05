'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Button, Card, CardBody, CardHeader, Divider, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  clearAllCache,
  clearCacheCategory,
  getCacheCategoryStats,
  type CacheCategoryStat,
} from '@/lib/pdfCache'

type CacheStats = Awaited<ReturnType<typeof getCacheCategoryStats>>

const EMPTY_STATS: CacheStats = {
  totalSize: 0,
  totalCount: 0,
  categories: [],
}

const RING_RADIUS = 52
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export function CacheManagementCard() {
  const prefersReducedMotion = useReducedMotion()
  const [stats, setStats] = useState<CacheStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [clearingAll, setClearingAll] = useState(false)
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refreshStats = useCallback(async () => {
    try {
      const next = await getCacheCategoryStats()
      setStats(next)
      setSelectedId((current) => {
        if (!next.categories.length) return null
        if (current && next.categories.some(item => item.id === current)) return current
        return next.categories[0].id
      })
    } catch (error) {
      addToast({
        title: '读取缓存统计失败',
        description: error instanceof Error ? error.message : '未知错误',
        color: 'warning',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  const selectedCategory = useMemo(
    () => stats.categories.find(item => item.id === selectedId) ?? stats.categories[0] ?? null,
    [selectedId, stats.categories],
  )

  const segments = useMemo(() => {
    if (stats.totalSize <= 0) return []

    let startRatio = 0
    return stats.categories
      .filter(item => item.size > 0)
      .map((item) => {
        const ratio = item.size / stats.totalSize
        const strokeLength = ratio * RING_CIRCUMFERENCE
        const dashOffset = -startRatio * RING_CIRCUMFERENCE
        startRatio += ratio
        return {
          ...item,
          ratio,
          strokeLength,
          dashOffset,
        }
      })
  }, [stats.categories, stats.totalSize])

  const handleClearAll = useCallback(async () => {
    setClearingAll(true)
    try {
      await clearAllCache()
      await refreshStats()
      addToast({ title: '已清空全部缓存', color: 'success' })
    } catch (error) {
      addToast({
        title: '清空缓存失败',
        description: error instanceof Error ? error.message : '未知错误',
        color: 'danger',
      })
    } finally {
      setClearingAll(false)
    }
  }, [refreshStats])

  const handleClearCategory = useCallback(async (category: CacheCategoryStat) => {
    setClearingId(category.id)
    try {
      await clearCacheCategory(category.id)
      await refreshStats()
      addToast({ title: `已清理${category.label}`, color: 'success' })
    } catch (error) {
      addToast({
        title: `清理${category.label}失败`,
        description: error instanceof Error ? error.message : '未知错误',
        color: 'danger',
      })
    } finally {
      setClearingId(null)
    }
  }, [refreshStats])

  return (
    <Card shadow="sm">
      <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon="solar:database-bold-duotone" width={18} style={{ color: 'var(--text-muted)' }} />
            <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>缓存管理</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="flat"
              color="default"
              onPress={() => void refreshStats()}
              isDisabled={loading || clearingAll || Boolean(clearingId)}
            >
              刷新统计
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="danger"
              onPress={() => void handleClearAll()}
              isLoading={clearingAll}
              isDisabled={loading || stats.totalSize === 0 || Boolean(clearingId)}
            >
              清空全部缓存
            </Button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          左侧看总体分布，右侧按类别选择并清理。
        </p>
      </CardHeader>
      <Divider />
      <CardBody style={{ padding: 16 }}>
        <div style={layoutStyle}>
          <div style={leftPanelStyle}>
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={visualPanelStyle}
            >
              <div style={ringWrapStyle}>
                <svg viewBox="0 0 140 140" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                  <g transform="rotate(-90 70 70)">
                    <circle
                      cx="70"
                      cy="70"
                      r={RING_RADIUS}
                      fill="none"
                      stroke="color-mix(in srgb, var(--border-color) 65%, transparent)"
                      strokeWidth="12"
                    />
                    {segments.map((segment, index) => (
                      <motion.circle
                        key={segment.id}
                        cx="70"
                        cy="70"
                        r={RING_RADIUS}
                        fill="none"
                        stroke={segment.color}
                        strokeWidth={12}
                        strokeLinecap="round"
                        strokeDasharray={`${segment.strokeLength} ${RING_CIRCUMFERENCE}`}
                        initial={prefersReducedMotion ? false : { strokeDasharray: `0 ${RING_CIRCUMFERENCE}` }}
                        animate={{ strokeDasharray: `${segment.strokeLength} ${RING_CIRCUMFERENCE}`, strokeDashoffset: segment.dashOffset }}
                        transition={{ duration: 0.65, delay: prefersReducedMotion ? 0 : index * 0.06, ease: 'easeOut' }}
                      />
                    ))}
                  </g>
                </svg>
                <div style={ringCenterStyle}>
                  <span style={ringLabelStyle}>总缓存</span>
                  <motion.span
                    key={stats.totalSize}
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.28 }}
                    style={ringValueStyle}
                  >
                    {formatBytes(stats.totalSize)}
                  </motion.span>
                </div>
              </div>

              {selectedCategory ? (
                <motion.div
                  key={selectedCategory.id}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  style={selectedMetaStyle}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: selectedCategory.color }} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedCategory.label}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.65, color: 'var(--text-muted)' }}>
                    {selectedCategory.description}
                  </p>
                  <div style={selectedStatsRowStyle}>
                    <span>{formatBytes(selectedCategory.size)}</span>
                    <span>{selectedCategory.count} 项</span>
                    <span>{formatPercent(selectedCategory.size, stats.totalSize)}</span>
                  </div>
                </motion.div>
              ) : null}
            </motion.div>
          </div>

          <div style={rightPanelStyle}>
            {loading ? (
              <div style={emptyStateStyle}>正在统计缓存占用…</div>
            ) : stats.categories.length === 0 ? (
              <div style={emptyStateStyle}>当前没有可管理的缓存数据。</div>
            ) : (
              <div style={listStyle}>
                {stats.categories.map((category, index) => {
                  const isSelected = category.id === selectedCategory?.id
                  return (
                    <motion.div
                      key={category.id}
                      initial={prefersReducedMotion ? false : { opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.28, delay: prefersReducedMotion ? 0 : index * 0.04 }}
                      style={{
                        ...listRowStyle,
                        borderColor: isSelected ? category.color : 'var(--border-color)',
                        background: isSelected ? 'color-mix(in srgb, var(--bg-secondary) 72%, white 28%)' : 'transparent',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(category.id)}
                        style={listButtonStyle}
                      >
                        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: category.color, flexShrink: 0 }} />
                          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={listTitleStyle}>{category.label}</span>
                            <span style={listValueStyle}>{formatBytes(category.size)}</span>
                          </span>
                        </span>
                        <span style={listCaptionStyle}>{category.count} 项</span>
                      </button>

                      <Button
                        size="sm"
                        variant="light"
                        color="danger"
                        onPress={() => void handleClearCategory(category)}
                        isLoading={clearingId === category.id}
                        isDisabled={category.size === 0 || clearingAll}
                      >
                        清理
                      </Button>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function formatPercent(value: number, total: number) {
  if (!total) return '0%'
  return `${((value / total) * 100).toFixed(value / total > 0.1 ? 0 : 1)}%`
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const decimals = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(decimals)} ${units[index]}`
}

const layoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 0.78fr) minmax(0, 1.72fr)',
  gap: 22,
  alignItems: 'stretch',
}

const leftPanelStyle: CSSProperties = {
  minWidth: 0,
}

const rightPanelStyle: CSSProperties = {
  minWidth: 0,
}

const visualPanelStyle: CSSProperties = {
  height: '100%',
  padding: 18,
  borderRadius: 18,
  border: '1px solid var(--border-color)',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 86%, white 14%), var(--bg-secondary))',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}

const ringWrapStyle: CSSProperties = {
  position: 'relative',
  width: 240,
  height: 240,
  alignSelf: 'center',
}

const ringCenterStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  textAlign: 'center',
}

const ringLabelStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
}

const ringValueStyle: CSSProperties = {
  fontSize: 30,
  fontWeight: 700,
  lineHeight: 1.05,
  color: 'var(--text-primary)',
}

const selectedMetaStyle: CSSProperties = {
  padding: '12px 14px',
  borderRadius: 14,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-primary)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const selectedStatsRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  fontSize: 12,
  color: 'var(--text-secondary)',
}

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderTop: '1px solid var(--border-color)',
}

const listRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 12,
  alignItems: 'center',
  padding: '10px 0',
  borderBottom: '1px solid var(--border-color)',
  transition: 'background 160ms ease, border-color 160ms ease',
}

const listButtonStyle: CSSProperties = {
  width: '100%',
  padding: '0 2px',
  background: 'transparent',
  border: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  textAlign: 'left',
  cursor: 'pointer',
  minWidth: 0,
}

const listTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--text-primary)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const listCaptionStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
  flexShrink: 0,
}

const listValueStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
}

const emptyStateStyle: CSSProperties = {
  minHeight: 220,
  borderRadius: 16,
  border: '1px dashed var(--border-color)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-muted)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 24,
}
