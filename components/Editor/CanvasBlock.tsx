'use client'

import dynamic from 'next/dynamic'
import { createReactBlockSpec } from '@blocknote/react'
import type { ReactCustomBlockRenderProps } from '@blocknote/react'
import { getCanvasBlockDefaults, type CanvasBlockProps, type CanvasOriginRect } from '@/lib/canvasX6'
import { useThemeContext } from '@/components/Providers'
import { useRef, useState } from 'react'

const CanvasEditor = dynamic(
  () => import('./CanvasEditor').then((mod) => mod.CanvasEditor),
  { ssr: false },
)

const defaultCanvasProps = getCanvasBlockDefaults()

const canvasBlockConfig = {
  type: 'canvas' as const,
  propSchema: {
    graphData: {
      default: defaultCanvasProps.graphData,
    },
    previewDataUrl: {
      default: defaultCanvasProps.previewDataUrl,
    },
    width: {
      default: defaultCanvasProps.width,
      type: 'number' as const,
    },
    height: {
      default: defaultCanvasProps.height,
      type: 'number' as const,
    },
  },
  content: 'none' as const,
}

type CanvasBlockRenderProps = ReactCustomBlockRenderProps<
  typeof canvasBlockConfig.type,
  typeof canvasBlockConfig.propSchema,
  typeof canvasBlockConfig.content
>

function CanvasPreview(props: CanvasBlockRenderProps) {
  const wrapperRef = useRef<HTMLButtonElement | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [originRect, setOriginRect] = useState<CanvasOriginRect | null>(null)
  const { isDark } = useThemeContext()
  const previewDataUrl = String(props.block.props.previewDataUrl || '')
  const width = Number(props.block.props.width || defaultCanvasProps.width)
  const height = Number(props.block.props.height || defaultCanvasProps.height)
  const aspectRatio = `${width} / ${height}`

  const openEditor = () => {
    const rect = wrapperRef.current?.getBoundingClientRect()
    if (rect) {
      setOriginRect({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
    }
    setEditorOpen(true)
  }

  const updateBlockProps = (nextProps: CanvasBlockProps) => {
    props.editor.updateBlock(props.block, {
      props: nextProps,
    } as any)
  }

  return (
    <>
      <button
        ref={wrapperRef}
        type="button"
        contentEditable={false}
        onClick={openEditor}
        style={{
          width: 'min(100%, 760px)',
          padding: 0,
          border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(148, 163, 184, 0.24)'}`,
          borderRadius: 20,
          background: isDark ? 'rgba(15, 23, 42, 0.86)' : 'rgba(248, 250, 252, 0.96)',
          boxShadow: isDark ? '0 12px 28px rgba(2, 6, 23, 0.24)' : '0 12px 28px rgba(15, 23, 42, 0.08)',
          cursor: 'pointer',
          overflow: 'hidden',
          display: 'block',
          position: 'relative',
          textAlign: 'left',
        }}
      >
        {previewDataUrl ? (
          <div style={{ position: 'relative', aspectRatio, minHeight: 220, background: isDark ? '#08111f' : '#f8fafc' }}>
            <img
              src={previewDataUrl}
              alt="画板预览"
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: 14,
                bottom: 14,
                padding: '6px 10px',
                borderRadius: 999,
                background: isDark ? 'rgba(2, 6, 23, 0.72)' : 'rgba(15, 23, 42, 0.72)',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 700,
                backdropFilter: 'blur(8px)',
              }}
            >
              点击编辑
            </div>
          </div>
        ) : (
          <div
            style={{
              aspectRatio,
              minHeight: 220,
              display: 'grid',
              placeItems: 'center',
              padding: 24,
              background: isDark
                ? 'radial-gradient(circle at top left, rgba(99, 102, 241, 0.18), rgba(15, 23, 42, 0.92) 56%)'
                : 'radial-gradient(circle at top left, rgba(99, 102, 241, 0.12), rgba(248, 250, 252, 0.98) 60%)',
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 18,
                  margin: '0 auto 14px',
                  display: 'grid',
                  placeItems: 'center',
                  background: isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.12)',
                  color: isDark ? '#c7d2fe' : '#4f46e5',
                  fontSize: 24,
                }}
              >
                ✦
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: isDark ? '#e2e8f0' : '#0f172a' }}>
                点击创建图表
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: isDark ? 'rgba(203, 213, 225, 0.76)' : 'rgba(71, 85, 105, 0.88)' }}>
                用于流程图、架构图、实验流程与论文插图
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderTop: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(148, 163, 184, 0.18)'}`,
            color: isDark ? '#cbd5e1' : '#475569',
            fontSize: 12,
          }}
        >
          <span>画板块</span>
          <span>{previewDataUrl ? '点击放大全屏编辑' : '新建图表'}</span>
        </div>
      </button>

      {editorOpen ? (
        <CanvasEditor
          graphData={String(props.block.props.graphData || '')}
          width={width}
          height={height}
          isDark={isDark}
          originRect={originRect}
          onSave={updateBlockProps}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </>
  )
}

function CanvasExternalHTML(props: CanvasBlockRenderProps) {
  const previewDataUrl = String(props.block.props.previewDataUrl || '')

  if (!previewDataUrl) {
    return <p>Canvas diagram</p>
  }

  return (
    <figure>
      <img
        src={previewDataUrl}
        alt="Canvas diagram"
        style={{ maxWidth: '100%', borderRadius: 12 }}
      />
    </figure>
  )
}

export const CanvasBlockSpec = createReactBlockSpec(canvasBlockConfig, {
  render: CanvasPreview,
  toExternalHTML: CanvasExternalHTML,
})()
