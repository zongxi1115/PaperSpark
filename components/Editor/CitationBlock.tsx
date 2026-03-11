'use client'
import { createReactInlineContentSpec } from '@blocknote/react'
import type { ReactCustomInlineContentRenderProps } from '@blocknote/react'

/**
 * Citation Inline Content - 行内引用标记
 * 
 * 使用索引方式存储引用，只存储知识库条目的 ID
 * 实际引用内容根据设置动态渲染
 * 
 * Props:
 * - citationId: 知识库条目的 ID
 * - citationIndex: 引用索引号（如 [1], [2] 等）
 */

type CitationInlineContentProps = ReactCustomInlineContentRenderProps<
  {
    type: 'citation'
    propSchema: {
      citationId: {
        default: string
      }
      citationIndex: {
        default: number
      }
    }
    content: 'none'
  },
  any
>

// 行内引用渲染组件
function CitationInlineContent({ inlineContent }: CitationInlineContentProps) {
  const index = inlineContent.props.citationIndex as number
  const citationId = inlineContent.props.citationId as string
  
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 点击引用时滚动到对应的 Reference
    const event = new CustomEvent('citation-click', { 
      detail: { citationId, index } 
    })
    window.dispatchEvent(event)
    
    // 尝试滚动到对应的 Reference
    setTimeout(() => {
      const refElement = document.getElementById(`reference-${citationId}`)
      if (refElement) {
        refElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
        // 高亮效果
        refElement.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'
        setTimeout(() => {
          refElement.style.backgroundColor = ''
        }, 2000)
      }
    }, 100)
  }
  
  return (
    <span
      onClick={handleClick}
      style={{
        display: 'inline',
        color: 'var(--accent-color)',
        cursor: 'pointer',
        fontSize: '0.75em',
        verticalAlign: 'super',
        lineHeight: 0,
        margin: '0 1px',
        fontWeight: 500,
        userSelect: 'none',
      }}
      contentEditable={false}
      data-citation-id={citationId}
      data-citation-index={index}
      title={`引用 [${index}]`}
    >
      [{index}]
    </span>
  )
}

// 创建 BlockNote 自定义内联内容规范
export const CitationInlineContentSpec = createReactInlineContentSpec(
  {
    type: 'citation',
    propSchema: {
      citationId: {
        default: '',
      },
      citationIndex: {
        default: 1,
      },
    },
    content: 'none',
  } as const,
  {
    render: (props) => <CitationInlineContent {...(props as any)} />,
  }
)

/**
 * 引用数据类型
 */
export interface CitationData {
  citationId: string
  index: number
  title: string
  authors: string[]
  year: string
  journal: string
  doi: string
  url: string
  bib: string
}

/**
 * 发送引用插入事件
 */
export function dispatchCitationInsert(item: {
  id: string
  title: string
  authors: string[]
  year?: string
  journal?: string
  doi?: string
  url?: string
  bib?: string
}) {
  const event = new CustomEvent('citation-insert', {
    detail: {
      citationId: item.id,
      title: item.title,
      authors: item.authors,
      year: item.year || '',
      journal: item.journal || '',
      doi: item.doi || '',
      url: item.url || '',
      bib: item.bib || '',
    },
  })
  window.dispatchEvent(event)
}

/**
 * 创建引用插入处理器
 */
export function createCitationInsertHandler(editor: any) {
  return (citationId: string, citationIndex: number) => {
    editor.insertInlineContent([
      {
        type: 'citation',
        props: {
          citationId,
          citationIndex,
        },
      },
    ])
  }
}