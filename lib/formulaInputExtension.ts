import { createExtension } from '@blocknote/core'
import { Plugin, PluginKey } from 'prosemirror-state'

const FORMULA_INPUT_PLUGIN_KEY = new PluginKey('formulaInputRules')

/**
 * 公式输入规则扩展
 * 支持 $...$ 行内公式和 $$...$$ 块级公式
 */
export const FormulaInputExtension = createExtension(() => {
  return {
    key: 'formulaInputRules',
    prosemirrorPlugins: [
      new Plugin({
        key: FORMULA_INPUT_PLUGIN_KEY,
        props: {
          handleTextInput: (view: any, from: number, to: number, text: string) => {
            // 当输入 $ 时，检查是否形成了 $...$ 模式
            if (text !== '$') return false
            
            const state = view.state
            
            // 获取当前行文本（往前最多100个字符）
            const textBefore = state.doc.textBetween(
              Math.max(0, from - 100),
              from
            )
            
            // 检查是否有未闭合的 $
            const dollarCount = (textBefore.match(/\$/g) || []).length
            
            // 如果是奇数个 $，说明这是结束一个公式
            if (dollarCount % 2 === 1) {
              // 找到匹配的开始 $
              let startPos = from - 1
              let searchIndex = textBefore.length - 1
              
              while (searchIndex >= 0 && textBefore[searchIndex] !== '$') {
                searchIndex--
                startPos--
              }
              
              if (searchIndex < 0) return false
              
              // 检查是否是 $$...$$ 模式
              const isBlockFormula = searchIndex > 0 && textBefore[searchIndex - 1] === '$'
              
              if (isBlockFormula) {
                // 块级公式 $$...$$
                const formulaStart = startPos - 1
                const latex = state.doc.textBetween(formulaStart + 2, from)
                
                if (latex.trim()) {
                  const tr = state.tr
                  tr.delete(formulaStart, to + 1)
                  
                  const formulaType = state.schema.nodes.formula
                  if (formulaType) {
                    const formulaNode = formulaType.create({ latex: latex.trim() })
                    
                    // 包裹在居中的段落中
                    const paragraph = state.schema.nodes.paragraph
                    if (paragraph) {
                      const paragraphNode = paragraph.create(
                        { textAlignment: 'center' },
                        formulaNode
                      )
                      tr.insert(formulaStart, paragraphNode)
                    } else {
                      tr.insert(formulaStart, formulaNode)
                    }
                    
                    view.dispatch(tr)
                    return true
                  }
                }
              } else {
                // 行内公式 $...$
                const latex = state.doc.textBetween(startPos + 1, from)
                
                if (latex.trim()) {
                  const tr = state.tr
                  tr.delete(startPos, to + 1)
                  
                  const formulaType = state.schema.nodes.formula
                  if (formulaType) {
                    const formulaNode = formulaType.create({ latex: latex.trim() })
                    tr.insert(startPos, formulaNode)
                    view.dispatch(tr)
                    return true
                  }
                }
              }
            }
            
            return false
          },
        },
      }),
    ],
  } as const
})

/**
 * 解析 markdown 内容中的公式
 */
export function parseMarkdownWithFormulas(
  markdown: string
): Array<{ type: string; content?: string; latex?: string; isBlock?: boolean }> {
  const result: Array<{ type: string; content?: string; latex?: string; isBlock?: boolean }> = []
  
  const blockFormulaRegex = /\$\$([^$]+)\$\$/g
  const inlineFormulaRegex = /\$([^$]+)\$/g
  
  const formulas: Array<{ start: number; end: number; latex: string; isBlock: boolean }> = []
  
  let match
  while ((match = blockFormulaRegex.exec(markdown)) !== null) {
    formulas.push({
      start: match.index,
      end: match.index + match[0].length,
      latex: match[1].trim(),
      isBlock: true,
    })
  }
  
  while ((match = inlineFormulaRegex.exec(markdown)) !== null) {
    const overlaps = formulas.some(f => match!.index >= f.start && match!.index < f.end)
    if (!overlaps && match[1].trim()) {
      formulas.push({
        start: match.index,
        end: match.index + match[0].length,
        latex: match[1].trim(),
        isBlock: false,
      })
    }
  }
  
  formulas.sort((a, b) => a.start - b.start)
  
  let lastIndex = 0
  
  for (const formula of formulas) {
    if (formula.start > lastIndex) {
      const beforeText = markdown.slice(lastIndex, formula.start)
      if (beforeText) {
        result.push({ type: 'text', content: beforeText })
      }
    }
    
    result.push({
      type: 'formula',
      latex: formula.latex,
      isBlock: formula.isBlock,
    })
    
    lastIndex = formula.end
  }
  
  if (lastIndex < markdown.length) {
    const remaining = markdown.slice(lastIndex)
    if (remaining) {
      result.push({ type: 'text', content: remaining })
    }
  }
  
  return result
}

/**
 * 将解析后的公式内容转换为 BlockNote 可用的行内内容数组
 */
export function convertToInlineContent(
  parsed: Array<{ type: string; content?: string; latex?: string; isBlock?: boolean }>
): Array<{ type: string; text?: string; props?: { latex: string } }> {
  const result: Array<{ type: string; text?: string; props?: { latex: string } }> = []
  
  for (const item of parsed) {
    if (item.type === 'text' && item.content) {
      result.push({ type: 'text', text: item.content })
    } else if (item.type === 'formula' && item.latex) {
      result.push({
        type: 'formula',
        props: { latex: item.latex },
      })
    }
  }
  
  return result
}
