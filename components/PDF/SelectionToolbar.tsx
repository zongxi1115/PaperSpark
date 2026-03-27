'use client'

import { Button, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import type { HighlightColor } from '@/lib/types'
import { HIGHLIGHT_COLORS } from '@/lib/types'

interface SelectionToolbarProps {
  toolbarRef?: React.RefObject<HTMLDivElement | null>
  position: { x: number; y: number }
  selectionText: string
  noteMenuOpen: boolean
  noteText: string
  noteSelectedColor: HighlightColor
  onHighlight: (color: HighlightColor) => void
  onToggleNote: () => void
  onAskAI: () => void
  onDictionary: () => void
  onTranslate: () => void
  onExplain: () => void
  onNoteTextChange: (value: string) => void
  onNoteColorChange: (color: HighlightColor) => void
  onNoteCancel: () => void
  onNoteSave: () => void
}

function ToolbarIconButton({
  icon,
  label,
  tone = 'default',
  active = false,
  onPress,
}: {
  icon: string
  label: string
  tone?: 'default' | 'accent' | 'warm'
  active?: boolean
  onPress: () => void
}) {
  const toneClass = tone === 'warm'
    ? 'text-[#b45309] hover:text-[#92400e] hover:bg-[#fff3e6]'
    : tone === 'accent'
      ? 'text-[#2563eb] hover:text-[#1d4ed8] hover:bg-[#eff6ff]'
      : 'text-[#4b5563] hover:text-[#111827] hover:bg-[#f3f4f6]'

  return (
    <Tooltip content={label}>
      <Button
        isIconOnly
        size="sm"
        variant="light"
        radius="full"
        className={`h-8 min-w-8 ${active ? 'bg-[#eff6ff] text-[#1d4ed8]' : toneClass}`}
        onMouseDown={event => event.preventDefault()}
        onPress={onPress}
      >
        <Icon icon={icon} className="text-[17px]" />
      </Button>
    </Tooltip>
  )
}

export default function SelectionToolbar({
  toolbarRef,
  position,
  selectionText,
  noteMenuOpen,
  noteText,
  noteSelectedColor,
  onHighlight,
  onToggleNote,
  onAskAI,
  onDictionary,
  onTranslate,
  onExplain,
  onNoteTextChange,
  onNoteColorChange,
  onNoteCancel,
  onNoteSave,
}: SelectionToolbarProps) {
  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar-fadein absolute z-50"
      style={{
        left: position.x,
        top: position.y,
        minWidth: '320px',
        maxWidth: '360px',
      }}
    >
      <div className="rounded-2xl border border-[#d9dde5] bg-white/98 p-2 shadow-[0_18px_48px_rgba(15,23,42,0.18)] backdrop-blur">
        <div className="flex items-center gap-1">
          <ToolbarIconButton icon="mdi:book-open-page-variant-outline" label="词典" tone="default" onPress={onDictionary} />
          <ToolbarIconButton icon="mdi:translate" label="翻译" tone="warm" onPress={onTranslate} />
          <ToolbarIconButton icon="mdi:lightbulb-on-outline" label="解释" tone="accent" onPress={onExplain} />

          <div className="mx-1 h-5 w-px bg-[#e5e7eb]" />

          {(['yellow', 'green', 'blue', 'pink', 'purple'] as HighlightColor[]).map(color => (
            <button
              key={color}
              className="h-5 w-5 rounded-full border-2 border-transparent transition-transform hover:scale-110 hover:border-white"
              style={{ backgroundColor: HIGHLIGHT_COLORS[color].border }}
              onMouseDown={event => event.preventDefault()}
              onClick={() => onHighlight(color)}
              title={`高亮 ${color}`}
              type="button"
            />
          ))}

          <div className="mx-1 h-5 w-px bg-[#e5e7eb]" />

          <ToolbarIconButton
            icon="mdi:note-edit-outline"
            label="批注"
            tone="accent"
            active={noteMenuOpen}
            onPress={onToggleNote}
          />
          <ToolbarIconButton icon="mdi:robot-outline" label="问 AI" tone="accent" onPress={onAskAI} />
        </div>

        {noteMenuOpen && (
          <div className="mt-2 border-t border-[#eef1f4] pt-2">
            <p className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-[#6b7280]">
              &ldquo;{selectionText.slice(0, 96)}{selectionText.length > 96 ? '…' : ''}&rdquo;
            </p>
            <textarea
              className="w-full resize-none rounded-xl border border-[#d8dce3] bg-[#fafafa] px-3 py-2 text-sm text-[#111827] outline-none transition-colors focus:border-[#93c5fd] focus:bg-white"
              rows={3}
              placeholder="写下你的想法..."
              value={noteText}
              onChange={event => onNoteTextChange(event.target.value)}
              autoFocus
            />
            <div className="mt-2 flex items-center gap-1">
              <div className="flex gap-1">
                {(['yellow', 'green', 'blue', 'pink', 'purple'] as HighlightColor[]).map(color => (
                  <button
                    key={color}
                    className={`h-4 w-4 rounded-full transition-all ${
                      noteSelectedColor === color
                        ? 'ring-2 ring-[#111827] ring-offset-1 ring-offset-white scale-110'
                        : 'opacity-65 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: HIGHLIGHT_COLORS[color].border }}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => onNoteColorChange(color)}
                    title={color}
                    type="button"
                  />
                ))}
              </div>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="light"
                className="h-7 min-w-0 px-2 text-xs text-[#6b7280]"
                onMouseDown={event => event.preventDefault()}
                onPress={onNoteCancel}
              >
                取消
              </Button>
              <Button
                size="sm"
                color="primary"
                className="h-7 min-w-0 px-3 text-xs"
                onMouseDown={event => event.preventDefault()}
                onPress={onNoteSave}
              >
                保存
              </Button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .selection-toolbar-fadein {
          animation: selection-toolbar-fadein 180ms ease-out;
          transform-origin: center top;
        }

        @keyframes selection-toolbar-fadein {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  )
}
