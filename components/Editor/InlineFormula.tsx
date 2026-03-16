'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createReactInlineContentSpec } from '@blocknote/react'
import type { ReactCustomInlineContentRenderProps } from '@blocknote/react'
import 'mathlive'
import { FormulaEditor } from './FormulaEditor'
import { configureMathliveFontsDirectory } from '@/lib/mathliveFonts'

// 全局状态管理：当前打开的公式编辑器
let currentOpenEditor: ((open: boolean) => void) | null = null

type FormulaInlineContentProps = ReactCustomInlineContentRenderProps<
  {
    type: 'formula'
    propSchema: {
      latex: {
        default: string
      }
      autoOpenToken: {
        default: string
      }
    }
    content: 'none'
  },
  any
>

function ensureMathliveFontsDirectory() {
  configureMathliveFontsDirectory()
}

// Configure as early as possible, before MathLive attempts to resolve fonts.
ensureMathliveFontsDirectory()

function MathLiveInline({ latex }: { latex: string }) {
  const spanRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    ensureMathliveFontsDirectory()
  }, [])

  useEffect(() => {
    const el = spanRef.current as (HTMLElement & { render?: () => Promise<void> }) | null
    if (!el) return
    el.textContent = latex || ''
    const renderPromise = el.render?.()
    if (renderPromise) {
      renderPromise.catch(() => {})
    }
  }, [latex])

  return (
    <math-span
      ref={(el) => {
        spanRef.current = el
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        lineHeight: 1.2,
      }}
    />
  )
}

// 行内公式渲染组件
function FormulaInlineContent({ inlineContent, updateInlineContent }: FormulaInlineContentProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const currentLatex = inlineContent.props.latex || ''
  const currentAutoOpenToken = inlineContent.props.autoOpenToken || ''
  const handledAutoOpenTokenRef = useRef<string>('')

  // 关闭其他编辑器
  const openEditor = useCallback(() => {
    if (currentOpenEditor && currentOpenEditor !== setIsEditing) {
      currentOpenEditor(false)
    }
    currentOpenEditor = setIsEditing
    setIsEditing(true)
  }, [])

  // 清理全局状态
  useEffect(() => {
    return () => {
      if (currentOpenEditor === setIsEditing) {
        currentOpenEditor = null
      }
    }
  }, [])

  const handleSave = useCallback((newLatex: string) => {
    updateInlineContent({
      type: 'formula',
      props: {
        latex: newLatex,
        autoOpenToken: '',
      },
    })
    setIsEditing(false)
  }, [updateInlineContent])

  // 新创建并带有 autoOpenToken 的公式节点会自动进入编辑态
  useEffect(() => {
    if (!currentAutoOpenToken) return
    if (handledAutoOpenTokenRef.current === currentAutoOpenToken) return

    handledAutoOpenTokenRef.current = currentAutoOpenToken
    openEditor()

    updateInlineContent({
      type: 'formula',
      props: {
        latex: currentLatex,
        autoOpenToken: '',
      },
    })
  }, [currentAutoOpenToken, currentLatex, openEditor, updateInlineContent])

  const handleClose = useCallback(() => {
    setIsEditing(false)
  }, [])

  // 渲染公式预览
  const renderFormula = () => {
    if (!currentLatex) {
      return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>点击编辑公式</span>
    }

    return (
      <MathLiveInline latex={currentLatex} />
    )
  }

  return (
    <>
      <span
        data-formula-inline="true"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          openEditor()
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '2px 8px',
          margin: '0 2px',
          borderRadius: '4px',
          backgroundColor: isHovered ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.05)',
          border: `1px solid ${isHovered ? 'rgba(59, 130, 246, 0.4)' : 'rgba(59, 130, 246, 0.2)'}`,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          verticalAlign: 'middle',
          minWidth: '20px',
          minHeight: '1.2em',
          userSelect: 'none',
        }}
        contentEditable={false}
        title="点击编辑公式"
      >
        {renderFormula()}
      </span>
      
      <FormulaEditor
        isOpen={isEditing}
        initialLatex={currentLatex}
        onSave={handleSave}
        onClose={handleClose}
      />
    </>
  )
}

// 创建 BlockNote 自定义内联内容规范
export const FormulaInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'formula',
    propSchema: {
      latex: {
        default: '',
      },
      autoOpenToken: {
        default: '',
      },
    },
    content: 'none',
  } as const,
  {
    render: (props) => <FormulaInlineContent {...(props as any)} />,
  }
)

// 导出一个更新 latex 的辅助函数（用于外部调用）
export function createFormulaInsertHandler(editor: any) {
  return (latex: string = '', autoOpen: boolean = false) => {
    editor.insertInlineContent([
      {
        type: 'formula',
        props: {
          latex,
          autoOpenToken: autoOpen ? `formula-open-${Date.now()}` : '',
        },
      },
    ])
  }
}
