'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { formatDate, getKnowledgeItems } from '@/lib/storage'
import type { KnowledgeItem } from '@/lib/types'

function getRAGLabel(item: KnowledgeItem) {
  if (item.ragStatus === 'indexed') {
    return item.ragStoredLocally ? '已建库·本地' : '已建库·数据库'
  }

  if (item.ragStatus === 'indexing') {
    return '建库中'
  }

  if (item.ragStatus === 'failed') {
    return '建库失败'
  }

  return '待建库'
}

function getRAGColor(item: KnowledgeItem) {
  if (item.ragStatus === 'indexed') return '#10b981'
  if (item.ragStatus === 'indexing') return '#f59e0b'
  if (item.ragStatus === 'failed') return '#ef4444'
  return 'var(--text-muted)'
}

function getReadableSource(item: KnowledgeItem) {
  if (item.sourceType === 'zotero') return 'Zotero'
  if (item.sourceType === 'literature-search') return '漫游搜索'
  if (item.sourceType === 'url') return 'URL'
  return '上传'
}

export function ReadingPanel() {
  const router = useRouter()
  const [items, setItems] = useState<KnowledgeItem[]>([])

  useEffect(() => {
    const syncItems = () => setItems(getKnowledgeItems())

    syncItems()
    window.addEventListener('knowledge-items-updated', syncItems)
    window.addEventListener('storage', syncItems)

    return () => {
      window.removeEventListener('knowledge-items-updated', syncItems)
      window.removeEventListener('storage', syncItems)
    }
  }, [])

  const readingItems = useMemo(() => {
    return items
      .filter(item => item.hasImmersiveCache)
      .sort((left, right) => {
        const leftTime = new Date(left.immersiveCacheAt || left.updatedAt).getTime()
        const rightTime = new Date(right.immersiveCacheAt || right.updatedAt).getTime()
        return rightTime - leftTime
      })
  }, [items])

  const indexedCount = readingItems.filter(item => item.ragStatus === 'indexed').length

  if (readingItems.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16, gap: 12 }}>
        <div style={{ padding: 14, borderRadius: 12, background: 'linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.05))', border: '1px solid rgba(99,102,241,0.2)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>知识库精读</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            所有经过 Surya 成功解析的文献都会出现在这里，作为精读历史入口。
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.7 }}>
          还没有可精读的文献。<br />
          先去知识库打开一篇 PDF 进入沉浸式阅读并完成解析。
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border-color)', display: 'grid', gap: 12 }}>
        <div style={{ padding: 14, borderRadius: 12, background: 'linear-gradient(180deg, rgba(99,102,241,0.16), rgba(99,102,241,0.05))', border: '1px solid rgba(99,102,241,0.2)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>精读历史已接通</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            这里展示所有已完成 Surya 结构化解析的文献，可直接继续精读，也能看到建库状态。
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>精读文献</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{readingItems.length}</div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>已建库</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{indexedCount}</div>
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>最近解析</div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{formatDate(readingItems[0].immersiveCacheAt || readingItems[0].updatedAt)}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'grid', gap: 10, alignContent: 'start' }}>
        {readingItems.map(item => (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => router.push(`/immersive/${item.id}`)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                router.push(`/immersive/${item.id}`)
              }
            }}
            style={{
              textAlign: 'left',
              width: '100%',
              padding: 14,
              borderRadius: 12,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-primary)',
              cursor: 'pointer',
              display: 'grid',
              gap: 10,
            }}
            title="打开沉浸式阅读"
            aria-label={`打开 ${item.title} 的沉浸式阅读`}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5, color: 'var(--text-primary)', marginBottom: 4 }}>{item.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {(item.authors?.length ? item.authors.slice(0, 2).join(', ') : '未知作者')}
                  {item.authors && item.authors.length > 2 ? ' 等' : ''}
                </div>
              </div>
              <span style={{ fontSize: 10, color: getRAGColor(item), background: 'var(--bg-secondary)', borderRadius: 999, padding: '4px 8px', whiteSpace: 'nowrap' }}>
                {getRAGLabel(item)}
              </span>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              <span>{getReadableSource(item)}</span>
              {item.year ? <span>{item.year}</span> : null}
              <span>解析于 {formatDate(item.immersiveCacheAt || item.updatedAt)}</span>
              {typeof item.ragChunks === 'number' && item.ragChunks > 0 ? <span>{item.ragChunks} 块</span> : null}
            </div>

            {item.ragStatus === 'failed' && item.ragError ? (
              <div style={{ fontSize: 11, color: '#ef4444', lineHeight: 1.6 }}>{item.ragError}</div>
            ) : null}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {item.extractedMetadata?.journal || item.journal || '已完成结构化解析'}
              </div>
              <Button
                size="sm"
                color="secondary"
                variant="flat"
                onPress={() => router.push(`/immersive/${item.id}`)}
              >
                继续精读
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}