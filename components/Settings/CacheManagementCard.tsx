'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Button, Card, CardBody, CardHeader, Divider, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
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

export function CacheManagementCard() {
  const [stats, setStats] = useState<CacheStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [clearingAll, setClearingAll] = useState(false)
  const [clearingId, setClearingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refreshStats = useCallback(async () => {
    try {
      const nextStats = await getCacheCategoryStats()
      setStats(nextStats)
      setSelectedId((current) => {
        if (!nextStats.categories.length) return null
        if (current && nextStats.categories.some(category => category.id === current)) return current
        return nextStats.categories[0].id
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
    () => stats.categories.find(category => category.id === selectedId) ?? stats.categories[0] ?? null,
    [selectedId, stats.categories],
  )

  const chartSegments = useMemo(() => {
    if (stats.totalSize <= 0) return []

    let offset = 0
    return stats.categories
      .filter(category => category.size > 0)
      .map((category) => {
        const ratio = category.size / stats.totalSize
        const dash = ratio * 283
        const segment = {
          ...category,
          dash,
          offset,
        }
        offset -= dash
        return segment
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
              color="danger"
              variant="flat"
              onPress={() => void handleClearAll()}
              isLoading={clearingAll}
              isDisabled={loading || stats.totalSize === 0 || Boolean(clearingId)}
            >
              清空全部缓存
            </Button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          查看本地缓存总占用与各类别明细，并按类别选择性清理。
        </p>
      </CardHeader>
      <Divider />
      <CardBody style={{ padding: 16 }}>
        <div style={layoutStyle}>
          <div style={leftPanelStyle}>
            <div style={summaryCardStyle}>
              <div style={{ position: 'relative', width: 220, height: 220, flexShrink: 0 }}>
                <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                  <circle cx="60" cy="60" r="45" fill="none" stroke="var(--bg-tertiary)" strokeWidth="12" />
                  {chartSegments.map(segment => (
                    <circle
                      key={segment.id}
                      cx="60"
                      cy="60"
                      r="45"
                      fill="none"
                      stroke={segment.color}
                      strokeWidth={selectedCategory?.id === segment.id ? 14 : 12}
                      strokeLinecap="round"
                      strokeDasharray={`${segment.dash} 283`}
                      strokeDashoffset={segment.offset}
                      style={{ transition: 'all 160ms ease' }}
                    />
                  ))}
                </svg>
                <div style={chartCenterStyle}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>总占用</span>
                  <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                    {formatBytes(stats.totalSize)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {stats.totalCount} 项缓存
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                <div style={miniTileStyle}>
                  <span style={miniLabelStyle}>最大类别</span>
                  <span style={miniValueStyle}>{getLargestCategoryLabel(stats.categories)}</span>
                </div>
                <div style={miniTileStyle}>
                  <span style={miniLabelStyle}>当前选择</span>
                  <span style={miniValueStyle}>{selectedCategory?.label || '暂无缓存'}</span>
                </div>
              </div>
            </div>
          </div>

          <div style={rightPanelStyle}>
            {loading ? (
              <div style={emptyStateStyle}>正在统计缓存占用…</div>
            ) : stats.categories.length === 0 ? (
              <div style={emptyStateStyle}>当前没有可管理的缓存数据。</div>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.categories.map(category => {
                    const isSelected = selectedCategory?.id === category.id
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setSelectedId(category.id)}
                        style={{
                          ...rowButtonStyle,
                          borderColor: isSelected ? category.color : 'var(--border-color)',
                          background: isSelected ? `color-mix(in srgb, ${category.color} 12%, var(--bg-secondary))` : 'var(--bg-secondary)',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 999, background: category.color, flexShrink: 0 }} />
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{category.label}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{category.count} 项</span>
                          </span>
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {formatBytes(category.size)}
                        </span>
                      </button>
                    )
                  })}
                </div>

                {selectedCategory ? (
                  <div style={detailCardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 12, height: 12, borderRadius: 999, background: selectedCategory.color }} />
                          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedCategory.label}</span>
                        </div>
                        <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)', margin: 0 }}>
                          {selectedCategory.description}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        color="danger"
                        variant="flat"
                        onPress={() => void handleClearCategory(selectedCategory)}
                        isLoading={clearingId === selectedCategory.id}
                        isDisabled={selectedCategory.size === 0 || clearingAll}
                      >
                        清理该类别
                      </Button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                      <div style={miniTileStyle}>
                        <span style={miniLabelStyle}>占用大小</span>
                        <span style={miniValueStyle}>{formatBytes(selectedCategory.size)}</span>
                      </div>
                      <div style={miniTileStyle}>
                        <span style={miniLabelStyle}>缓存数量</span>
                        <span style={miniValueStyle}>{selectedCategory.count} 项</span>
                      </div>
                      <div style={miniTileStyle}>
                        <span style={miniLabelStyle}>占总缓存</span>
                        <span style={miniValueStyle}>{formatPercent(selectedCategory.size, stats.totalSize)}</span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function getLargestCategoryLabel(categories: CacheCategoryStat[]) {
  if (categories.length === 0) return '暂无'
  const largest = [...categories].sort((a, b) => b.size - a.size)[0]
  if (!largest || largest.size <= 0) return '暂无'
  return largest.label
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
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
  alignItems: 'stretch',
}

const leftPanelStyle: CSSProperties = {
  minWidth: 0,
}

const rightPanelStyle: CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const summaryCardStyle: CSSProperties = {
  height: '100%',
  borderRadius: 16,
  border: '1px solid var(--border-color)',
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 86%, white 14%), var(--bg-secondary))',
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  alignItems: 'center',
  justifyContent: 'center',
}

const chartCenterStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  textAlign: 'center',
}

const miniTileStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 12,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const miniLabelStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
}

const miniValueStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary)',
}

const rowButtonStyle: CSSProperties = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid var(--border-color)',
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  cursor: 'pointer',
  transition: 'all 160ms ease',
  textAlign: 'left',
}

const detailCardStyle: CSSProperties = {
  borderRadius: 16,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-secondary)',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
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
