'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { createReactInlineContentSpec } from '@blocknote/react'
import { FormulaEditor } from './FormulaEditor'

// 全局状态管理：当前打开的公式编辑器
let currentOpenEditor: ((open: boolean) => void) | null = null

// 行内公式组件的 Props 类型
interface FormulaInlineContentProps {
  inlineContent: {
    type: 'formula'
    props: {
      latex: string
    }
  }
}

// 行内公式渲染组件
function FormulaInlineContent({ inlineContent }: FormulaInlineContentProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [currentLatex, setCurrentLatex] = useState(inlineContent.props.latex)
  const [isHovered, setIsHovered] = useState(false)

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
    setCurrentLatex(newLatex)
    setIsEditing(false)
  }, [])

  const handleClose = useCallback(() => {
    setIsEditing(false)
  }, [])

  // 使用 useMemo 优化渲染
  const formulaHtml = useMemo(() => {
    if (!currentLatex) return ''
    return renderLatexToHtml(currentLatex)
  }, [currentLatex])

  // 渲染公式预览
  const renderFormula = () => {
    if (!currentLatex) {
      return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>点击编辑公式</span>
    }

    return (
      <span 
        style={{ 
          fontFamily: "'Times New Roman', 'STIX Two Math', 'Latin Modern Math', serif",
          fontStyle: 'italic',
        }}
        dangerouslySetInnerHTML={{ __html: formulaHtml }}
      />
    )
  }

  return (
    <>
      <span
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

// 简单的 LaTeX 到 HTML 转换（用于预览）
function renderLatexToHtml(latex: string): string {
  if (!latex) return ''
  
  let html = latex
  
  // 希腊字母
  const greekLetters: Record<string, string> = {
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ',
    '\\epsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ',
    '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\mu': 'μ',
    '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ',
    '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
    '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
    '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ',
    '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Phi': 'Φ',
    '\\Psi': 'Ψ', '\\Omega': 'Ω',
  }
  
  // 替换希腊字母
  for (const [latex, symbol] of Object.entries(greekLetters)) {
    html = html.split(latex).join(symbol)
    html = html.split(latex + ' ').join(symbol + ' ')
  }
  
  // 分数 \frac{a}{b} -> a/b
  html = html.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
  
  // 上标 ^{x} -> <sup>x</sup>
  html = html.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>')
  html = html.replace(/\^([a-zA-Z0-9])/g, '<sup>$1</sup>')
  
  // 下标 _{x} -> <sub>x</sub>
  html = html.replace(/_\{([^}]*)\}/g, '<sub>$1</sub>')
  html = html.replace(/_([a-zA-Z0-9])/g, '<sub>$1</sub>')
  
  // 平方根 \sqrt{x} -> √x
  html = html.replace(/\\sqrt\{([^}]*)\}/g, '√($1)')
  
  // 求和符号
  html = html.replace(/\\sum/g, '∑')
  html = html.replace(/\\prod/g, '∏')
  html = html.replace(/\\int/g, '∫')
  
  // 常用运算符
  html = html.replace(/\\times/g, '×')
  html = html.replace(/\\div/g, '÷')
  html = html.replace(/\\pm/g, '±')
  html = html.replace(/\\mp/g, '∓')
  html = html.replace(/\\cdot/g, '·')
  html = html.replace(/\\leq/g, '≤')
  html = html.replace(/\\geq/g, '≥')
  html = html.replace(/\\neq/g, '≠')
  html = html.replace(/\\approx/g, '≈')
  html = html.replace(/\\equiv/g, '≡')
  html = html.replace(/\\infty/g, '∞')
  html = html.replace(/\\partial/g, '∂')
  html = html.replace(/\\nabla/g, '∇')
  
  // 箭头
  html = html.replace(/\\rightarrow/g, '→')
  html = html.replace(/\\leftarrow/g, '←')
  html = html.replace(/\\Rightarrow/g, '⇒')
  html = html.replace(/\\Leftarrow/g, '⇐')
  
  // 集合符号
  html = html.replace(/\\in/g, '∈')
  html = html.replace(/\\notin/g, '∉')
  html = html.replace(/\\subset/g, '⊂')
  html = html.replace(/\\supset/g, '⊃')
  html = html.replace(/\\cup/g, '∪')
  html = html.replace(/\\cap/g, '∩')
  html = html.replace(/\\emptyset/g, '∅')
  
  // 逻辑符号
  html = html.replace(/\\forall/g, '∀')
  html = html.replace(/\\exists/g, '∃')
  html = html.replace(/\\neg/g, '¬')
  html = html.replace(/\\land/g, '∧')
  html = html.replace(/\\lor/g, '∨')
  
  // 括号
  html = html.replace(/\\left\(/g, '(')
  html = html.replace(/\\right\)/g, ')')
  html = html.replace(/\\left\[/g, '[')
  html = html.replace(/\\right\]/g, ']')
  html = html.replace(/\\left\{/g, '{')
  html = html.replace(/\\right\}/g, '}')
  
  // 文本
  html = html.replace(/\\text\{([^}]*)\}/g, '$1')
  html = html.replace(/\\mathrm\{([^}]*)\}/g, '$1')
  
  // 空格和换行
  html = html.replace(/\\quad/g, ' ')
  html = html.replace(/\\qquad/g, '  ')
  html = html.replace(/\\,/g, ' ')
  html = html.replace(/\\;/g, ' ')
  html = html.replace(/\\!/g, '')
  html = html.replace(/\\ /g, ' ')
  
  // 清理剩余的反斜杠命令（保持原样显示）
  // html = html.replace(/\\[a-zA-Z]+/g, '')
  
  return html
}

// 创建 BlockNote 自定义内联内容规范
export const FormulaInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'formula',
    propSchema: {
      latex: {
        default: '',
      },
    },
    content: 'none',
  } as const,
  {
    render: (props: { inlineContent: any }) => (
      <FormulaInlineContent inlineContent={props.inlineContent} />
    ),
  }
)

// 导出一个更新 latex 的辅助函数（用于外部调用）
export function createFormulaInsertHandler(editor: any) {
  return (latex: string = '') => {
    editor.insertInlineContent([
      {
        type: 'formula',
        props: {
          latex,
        },
      },
    ])
  }
}
