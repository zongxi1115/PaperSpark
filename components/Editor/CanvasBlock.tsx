'use client'

import dynamic from 'next/dynamic'
import { createReactBlockSpec } from '@blocknote/react'
import type { ReactCustomBlockRenderProps } from '@blocknote/react'
import { getCanvasBlockDefaults, type CanvasBlockProps, type CanvasOriginRect } from '@/lib/canvas'
import { useThemeContext } from '@/components/Providers'
import { useRef, useState } from 'react'
import { PenTool, MousePointerSquareDashed, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

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
        className={cn(
          "group w-full max-w-[760px] block relative text-left overflow-hidden cursor-pointer",
          "rounded-2xl border transition-all duration-200 outline-none my-2",
          isDark
            ? "border-slate-800 hover:border-indigo-500/50 bg-slate-900/60 hover:bg-slate-900/80 shadow-[0_8px_30px_rgb(0,0,0,0.12)]"
            : "border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50/80 shadow-[0_2px_12px_rgb(0,0,0,0.04)] hover:shadow-lg"
        )}
      >
        {previewDataUrl ? (
          <div 
            className={cn(
              "relative flex items-center justify-center overflow-hidden",
              isDark ? "bg-[#080d19]" : "bg-slate-50/80"
            )} 
            style={{ aspectRatio, minHeight: 220 }}
          >
            <img
              src={previewDataUrl}
              alt="画板预览"
              draggable={false}
              className="w-full h-full object-contain drop-shadow-sm"
            />
            <div
              className={cn(
                "absolute right-4 bottom-4 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-md shadow-sm",
                isDark 
                  ? "bg-slate-800/80 text-slate-200 border border-slate-700/50" 
                  : "bg-white/90 text-slate-700 border border-slate-200/60"
              )}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              点击编辑
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col items-center justify-center p-12 transition-colors",
              isDark
                ? "bg-gradient-to-b from-slate-800/10 to-transparent text-slate-400 group-hover:text-slate-300"
                : "bg-gradient-to-b from-indigo-50/20 to-transparent text-slate-500 group-hover:text-slate-600"
            )}
            style={{ aspectRatio, minHeight: 220 }}
          >
            <div className={cn(
              "w-14 h-14 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300 group-hover:scale-110 group-hover:-rotate-3 shadow-sm",
              isDark ? "bg-indigo-500/20 text-indigo-400" : "bg-indigo-100 text-indigo-600"
            )}>
              <PenTool className="w-7 h-7" />
            </div>
            <div className={cn(
              "text-[17px] font-bold mb-1.5",
              isDark ? "text-slate-200" : "text-slate-800"
            )}>
              点击创建图表
            </div>
            <div className={cn(
              "text-[13px] text-center max-w-sm",
              isDark ? "text-slate-400/80" : "text-slate-500/90"
            )}>
              用于流程图、架构图、实验流程与论文插图
            </div>
          </div>
        )}

        <div
          className={cn(
            "flex items-center justify-between px-4 py-3 text-xs font-medium border-t transition-colors",
            isDark 
              ? "border-slate-800/60 bg-slate-950/40 text-slate-400 group-hover:bg-slate-900/60" 
              : "border-slate-200/60 bg-white/80 text-slate-500 group-hover:bg-white"
          )}
        >
          <div className="flex items-center gap-2">
            <MousePointerSquareDashed className="w-4 h-4 opacity-70" />
            <span>画布区块</span>
          </div>
          <span className={cn(
            "flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity",
            isDark ? "text-indigo-400" : "text-indigo-600"
          )}>
            {previewDataUrl ? '查看详情' : '新建图表'}
          </span>
        </div>
      </button>

      {editorOpen ? (
        <CanvasEditor
          graphData={String(props.block.props.graphData || '')}
          previewDataUrl={previewDataUrl}
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
