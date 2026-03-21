'use client'

import { useMemo, useState } from 'react'
import { Button, Card, CardBody, Chip, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { CANVAS_DRAG_MIME, type CanvasPaletteGroup, type CanvasPaletteItem } from '@/lib/canvasX6'

interface CanvasStencilProps {
  groups: CanvasPaletteGroup[]
  collapsed: boolean
  isDark: boolean
  onToggle: () => void
  onInsert: (presetId: string) => void
}

function PaletteItemCard({
  item,
  isDark,
  onInsert,
}: {
  item: CanvasPaletteItem
  isDark: boolean
  onInsert: (presetId: string) => void
}) {
  return (
    <button
      type="button"
      draggable
      onClick={() => onInsert(item.id)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(CANVAS_DRAG_MIME, item.id)
      }}
      style={{
        width: '100%',
        border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(148, 163, 184, 0.18)'}`,
        borderRadius: 14,
        background: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.96)',
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'grab',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          color: item.color,
          background: isDark ? 'rgba(30, 41, 59, 0.96)' : 'rgba(248, 250, 252, 0.96)',
          flexShrink: 0,
        }}
      >
        {item.customIconSvg ? (
          <svg width={20} height={20} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.customIconSvg }} />
        ) : (
          <Icon icon={item.icon} width={20} />
        )}
      </div>
      <div style={{ minWidth: 0, flex: 1, fontSize: 12, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.label}
      </div>
    </button>
  )
}

function PaletteIconButton({
  item,
  isDark,
  onInsert,
}: {
  item: CanvasPaletteItem
  isDark: boolean
  onInsert: (presetId: string) => void
}) {
  return (
    <Tooltip content={item.label} placement="top">
      <button
        type="button"
        draggable
        onClick={() => onInsert(item.id)}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(CANVAS_DRAG_MIME, item.id)
        }}
        aria-label={item.label}
        style={{
          width: 32,
          height: 32,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          background: 'transparent',
          color: item.color,
          cursor: 'grab',
          borderRadius: 10,
          opacity: 0.92,
        }}
      >
        {item.customIconSvg ? (
          <svg width={20} height={20} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: item.customIconSvg }} />
        ) : (
          <Icon icon={item.icon} width={20} />
        )}
      </button>
    </Tooltip>
  )
}

export function CanvasStencil({ groups, collapsed, isDark, onToggle, onInsert }: CanvasStencilProps) {
  const defaultOpen = useMemo(() => groups.map((group) => group.id), [groups])
  const [openGroups, setOpenGroups] = useState<string[]>(defaultOpen)

  const toggleGroup = (groupId: string) => {
    setOpenGroups((current) =>
      current.includes(groupId)
        ? current.filter((value) => value !== groupId)
        : [...current, groupId],
    )
  }

  return (
    <aside
      style={{
        width: collapsed ? 52 : 196,
        transition: 'width 220ms ease',
        borderRight: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.2)'}`,
        background: isDark ? 'rgba(2, 6, 23, 0.86)' : 'rgba(248, 250, 252, 0.94)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 48,
          padding: collapsed ? '8px 6px' : '8px 10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
          borderBottom: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.18)'}`,
        }}
      >
        {!collapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Chip size="sm" variant="flat" color="primary">物料</Chip>
            <span style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>拖拽到画布</span>
          </div>
        ) : null}

        <Button
          isIconOnly
          size="sm"
          variant="light"
          onPress={onToggle}
          aria-label={collapsed ? '展开物料栏' : '收起物料栏'}
        >
          <Icon icon={collapsed ? 'mdi:chevron-right' : 'mdi:chevron-left'} width={18} />
        </Button>
      </div>

      {collapsed ? (
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            writingMode: 'vertical-rl',
            letterSpacing: 2,
            fontSize: 11,
            color: isDark ? 'rgba(203, 213, 225, 0.7)' : 'rgba(71, 85, 105, 0.82)',
          }}
        >
          图形库
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {groups.map((group) => {
            const isOpen = openGroups.includes(group.id)
            const regularItems = group.items.filter((item) => item.variant !== 'icon')
            const iconItems = group.items.filter((item) => item.variant === 'icon')

            return (
              <Card key={group.id} shadow="none" style={{ background: isDark ? 'rgba(15, 23, 42, 0.72)' : 'rgba(255, 255, 255, 0.84)', border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(148, 163, 184, 0.18)'}` }}>
                <CardBody style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Button
                    variant="light"
                    onPress={() => toggleGroup(group.id)}
                    style={{ justifyContent: 'space-between', fontWeight: 700 }}
                    endContent={<Icon icon={isOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'} width={16} />}
                  >
                    {group.title}
                  </Button>

                  {isOpen ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {regularItems.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {regularItems.map((item) => (
                            <PaletteItemCard key={item.id} item={item} isDark={isDark} onInsert={onInsert} />
                          ))}
                        </div>
                      ) : null}

                      {iconItems.length > 0 ? (
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
                            gap: 4,
                            padding: '2px 4px 0',
                          }}
                        >
                          {iconItems.map((item) => (
                            <PaletteIconButton key={item.id} item={item} isDark={isDark} onInsert={onInsert} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </aside>
  )
}
