'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, addToast, Chip } from '@heroui/react'
import type { DocumentVersion, ArticleAuthor } from '@/lib/types'
import { getDocumentVersions, deleteDocumentVersion, calculateWordCount } from '@/lib/storage'
import type { Block } from '@blocknote/core'

interface VersionHistoryPanelProps {
  documentId: string
  currentContent: Block[]
  articleTitle?: string
  articleAuthors?: ArticleAuthor[]
  articleAbstract?: string
  articleKeywords?: string[]
  articleDate?: string
  onRestoreVersion: (version: DocumentVersion) => void
  onSaveVersion: (title: string) => void
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function SaveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function formatVersionDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// 提取标题块
function extractHeadings(blocks: Block[]): { id: string; level: number; text: string }[] {
  return blocks
    .filter(b => b.type === 'heading')
    .map(b => {
      const block = b as { id: string; type: string; props?: { level?: number }; content?: { type: string; text: string }[] }
      const text = block.content
        ?.filter(c => c.type === 'text')
        .map(c => c.text)
        .join('') ?? ''
      return {
        id: block.id,
        level: block.props?.level ?? 1,
        text,
      }
    })
    .filter(h => h.text.trim())
}

// 行内内容类型（公式、引用等）
interface InlineContentData {
  type: 'text' | 'formula' | 'citation' | string
  text?: string
  latex?: string
  citationIndex?: number
  citationTitle?: string
}

// 表格单元格
interface TableCell {
  content: InlineContentData[]
}

// 表格行
interface TableRow {
  cells: TableCell[]
}

// Block 结构
interface BlockData {
  type: string
  level?: number
  text: string
  // 表格数据
  table?: {
    rows: TableRow[]
    columnWidths?: number[]
  }
  // 行内内容（用于渲染公式等）
  inlineContent?: InlineContentData[]
}

// 提取行内内容（包括公式）
function extractInlineContent(content: unknown): InlineContentData[] {
  if (!Array.isArray(content)) return []
  
  return content.map(c => {
    const item = c as { type: string; text?: string; props?: { latex?: string; citationIndex?: number; citationTitle?: string } }
    if (item.type === 'formula') {
      return {
        type: 'formula',
        latex: item.props?.latex || '',
      }
    } else if (item.type === 'citation') {
      return {
        type: 'citation',
        citationIndex: item.props?.citationIndex,
        citationTitle: item.props?.citationTitle,
      }
    } else {
      return {
        type: 'text',
        text: item.text || '',
      }
    }
  })
}

// 从行内内容提取纯文本（包含公式标记）
function extractTextFromInlineContent(inlineContent: InlineContentData[]): string {
  return inlineContent
    .map(c => {
      if (c.type === 'formula') {
        return `$${c.latex || ''}$` // 用 $ 包裹公式标识
      } else if (c.type === 'citation') {
        return `[${c.citationIndex || '?'}]`
      }
      return c.text || ''
    })
    .join('')
}

// 提取表格数据
function extractTableData(block: unknown): BlockData['table'] {
  const b = block as {
    type: string
    content?: unknown
    props?: {
      columnWidths?: number[]
    }
  }
  
  // 表格块的 content 可能是 { type: 'tableContent', rows: [...] }
  const content = b.content as { type?: string; rows?: unknown[] } | undefined
  
  if (!content || content.type !== 'tableContent' || !Array.isArray(content.rows)) {
    return undefined
  }
  
  const rows: TableRow[] = content.rows.map((row: unknown) => {
    const r = row as { cells?: unknown[] }
    const cells: TableCell[] = (r.cells || []).map((cell: unknown) => {
      const c = cell as { content?: unknown }
      return {
        content: extractInlineContent(c.content),
      }
    })
    return { cells }
  })
  
  return {
    rows,
    columnWidths: b.props?.columnWidths,
  }
}

// 将 blocks 转换为结构化数据
function blocksToData(blocks: Block[]): BlockData[] {
  return blocks.map(b => {
    const block = b as { type: string; props?: { level?: number }; content?: unknown }
    
    // 处理表格块
    if (block.type === 'table') {
      const tableData = extractTableData(block)
      // 提取表格文本用于 diff
      let text = '[表格]'
      if (tableData?.rows) {
        const cellTexts = tableData.rows.flatMap(row => 
          row.cells.map(cell => extractTextFromInlineContent(cell.content))
        )
        text = cellTexts.filter(t => t.trim()).join(' | ') || '[表格]'
      }
      
      return {
        type: block.type,
        text,
        table: tableData,
      }
    }
    
    // 处理普通块（段落、标题等）
    const inlineContent = extractInlineContent(block.content)
    const text = extractTextFromInlineContent(inlineContent)
    
    return {
      type: block.type,
      level: block.props?.level,
      text,
      inlineContent: inlineContent.length > 0 ? inlineContent : undefined,
    }
  }).filter(b => b.text.trim() || b.table || (b.inlineContent && b.inlineContent.length > 0))
}

// 字符级 LCS diff
function diffChars(oldStr: string, newStr: string): { type: 'same' | 'added' | 'removed'; text: string }[] {
  if (!oldStr && !newStr) return []
  if (!oldStr) return [{ type: 'added', text: newStr }]
  if (!newStr) return [{ type: 'removed', text: oldStr }]
  
  const oldChars = [...oldStr]
  const newChars = [...newStr]
  
  const m = oldChars.length
  const n = newChars.length
  
  // 优化：如果字符串太长，限制 diff 范围
  if (m > 5000 || n > 5000) {
    if (oldStr === newStr) return [{ type: 'same', text: oldStr }]
    // 对于长字符串，简单的开头/结尾匹配
    const commonPrefix = commonPrefixLength(oldStr, newStr)
    const commonSuffix = commonSuffixLength(oldStr.slice(commonPrefix), newStr.slice(commonPrefix))
    
    const result: { type: 'same' | 'added' | 'removed'; text: string }[] = []
    if (commonPrefix > 0) {
      result.push({ type: 'same', text: oldStr.slice(0, commonPrefix) })
    }
    
    const oldMiddle = oldStr.slice(commonPrefix, oldStr.length - commonSuffix)
    const newMiddle = newStr.slice(commonPrefix, newStr.length - commonSuffix)
    
    if (oldMiddle) result.push({ type: 'removed', text: oldMiddle })
    if (newMiddle) result.push({ type: 'added', text: newMiddle })
    
    if (commonSuffix > 0) {
      result.push({ type: 'same', text: oldStr.slice(oldStr.length - commonSuffix) })
    }
    
    return result
  }
  
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldChars[i - 1] === newChars[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = []
  let i = m, j = n
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldChars[i - 1] === newChars[j - 1]) {
      result.unshift({ type: 'same', text: oldChars[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', text: newChars[j - 1] })
      j--
    } else if (i > 0) {
      result.unshift({ type: 'removed', text: oldChars[i - 1] })
      i--
    }
  }
  
  // 合并相邻的同类型片段
  return mergeDiffResult(result)
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

function mergeDiffResult(diff: { type: 'same' | 'added' | 'removed'; text: string }[]): { type: 'same' | 'added' | 'removed'; text: string }[] {
  if (diff.length === 0) return []
  
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = [diff[0]]
  
  for (let i = 1; i < diff.length; i++) {
    const last = result[result.length - 1]
    if (last.type === diff[i].type) {
      last.text += diff[i].text
    } else {
      result.push(diff[i])
    }
  }
  
  return result
}

// 行级 LCS diff
function diffLines(oldLines: BlockData[], newLines: BlockData[]): { 
  type: 'same' | 'added' | 'removed'
  oldLine?: BlockData
  newLine?: BlockData
  charDiff?: { type: 'same' | 'added' | 'removed'; text: string }[]
}[] {
  if (oldLines.length === 0 && newLines.length === 0) return []
  if (oldLines.length === 0) return newLines.map(line => ({ type: 'added' as const, newLine: line }))
  if (newLines.length === 0) return oldLines.map(line => ({ type: 'removed' as const, oldLine: line }))
  
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1].text === newLines[j - 1].text && oldLines[i - 1].type === newLines[j - 1].type) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  const result: { 
    type: 'same' | 'added' | 'removed'
    oldLine?: BlockData
    newLine?: BlockData
    charDiff?: { type: 'same' | 'added' | 'removed'; text: string }[]
  }[] = []
  let i = m, j = n
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1].text === newLines[j - 1].text && oldLines[i - 1].type === newLines[j - 1].type) {
      result.unshift({ type: 'same', oldLine: oldLines[i - 1], newLine: newLines[j - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', newLine: newLines[j - 1] })
      j--
    } else if (i > 0) {
      result.unshift({ type: 'removed', oldLine: oldLines[i - 1] })
      i--
    }
  }
  
  // 对修改的行进行字符级 diff
  // 找到相邻的 added/removed，可能是修改
  for (let k = 0; k < result.length - 1; k++) {
    if (result[k].type === 'removed' && result[k + 1].type === 'added') {
      const oldLine = result[k].oldLine!
      const newLine = result[k + 1].newLine!
      
      // 如果类型相同，可能是修改
      if (oldLine.type === newLine.type) {
        const charDiff = diffChars(oldLine.text, newLine.text)
        // 如果有一定相似度，标记为修改
        const sameChars = charDiff.filter(d => d.type === 'same').reduce((sum, d) => sum + d.text.length, 0)
        const totalChars = Math.max(oldLine.text.length, newLine.text.length)
        
        if (totalChars > 0 && sameChars / totalChars > 0.3) {
          result[k] = { type: 'removed', oldLine, newLine, charDiff }
          result[k + 1] = { type: 'added', oldLine, newLine, charDiff }
        }
      }
    }
  }
  
  return result
}

export function VersionHistoryPanel({
  documentId,
  currentContent,
  onRestoreVersion,
  onSaveVersion,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState<DocumentVersion | null>(null)
  const [newVersionTitle, setNewVersionTitle] = useState('')
  const [diffMode, setDiffMode] = useState<'content' | 'outline'>('content')
  
  const { isOpen: isHistoryOpen, onOpen: onHistoryOpen, onClose: onHistoryClose } = useDisclosure()
  const { isOpen: isSaveOpen, onOpen: onSaveOpen, onClose: onSaveClose } = useDisclosure()
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure()

  const loadVersions = useCallback(() => {
    const loaded = getDocumentVersions(documentId)
    setVersions(loaded)
    if (loaded.length > 0 && !selectedVersion) {
      setSelectedVersion(loaded[0])
    }
  }, [documentId, selectedVersion])

  useEffect(() => {
    if (isHistoryOpen) {
      loadVersions()
    }
  }, [isHistoryOpen, loadVersions])

  useEffect(() => {
    const handleVersionsUpdate = () => loadVersions()
    window.addEventListener('document-versions-updated', handleVersionsUpdate)
    return () => window.removeEventListener('document-versions-updated', handleVersionsUpdate)
  }, [loadVersions])

  const handleSaveVersion = useCallback(() => {
    if (!newVersionTitle.trim()) {
      addToast({ title: '请输入版本名称', color: 'warning' })
      return
    }
    onSaveVersion(newVersionTitle.trim())
    setNewVersionTitle('')
    onSaveClose()
    loadVersions()
  }, [newVersionTitle, onSaveVersion, onSaveClose, loadVersions])

  const handleDeleteVersion = useCallback((versionId: string) => {
    deleteDocumentVersion(versionId)
    loadVersions()
    if (selectedVersion?.id === versionId) {
      setSelectedVersion(versions.find(v => v.id !== versionId) ?? null)
    }
    addToast({ title: '版本已删除', color: 'success' })
  }, [loadVersions, selectedVersion, versions])

  const handleConfirmRestore = useCallback(() => {
    if (selectedVersion) {
      onRestoreVersion(selectedVersion)
      onConfirmClose()
      onHistoryClose()
      addToast({ title: '已恢复到历史版本', color: 'success' })
    }
  }, [selectedVersion, onRestoreVersion, onConfirmClose, onHistoryClose])

  // 计算正文 diff
  const contentDiff = useMemo(() => {
    if (!selectedVersion) return []
    const versionData = blocksToData(selectedVersion.content as Block[])
    const currentData = blocksToData(currentContent)
    return diffLines(versionData, currentData)
  }, [selectedVersion, currentContent])

  // 计算大纲 diff
  const outlineDiff = useMemo(() => {
    if (!selectedVersion) return []
    const versionHeadings = extractHeadings(selectedVersion.content as Block[])
    const currentHeadings = extractHeadings(currentContent)
    return diffLines(
      versionHeadings.map(h => ({ type: 'heading', level: h.level, text: h.text })),
      currentHeadings.map(h => ({ type: 'heading', level: h.level, text: h.text }))
    )
  }, [selectedVersion, currentContent])

  // 统计 diff 变化
  const diffStats = useMemo(() => {
    const diff = diffMode === 'content' ? contentDiff : outlineDiff
    let added = 0, removed = 0, charsAdded = 0, charsRemoved = 0
    diff.forEach(d => {
      if (d.type === 'added') {
        added++
        charsAdded += d.newLine?.text.length || 0
      }
      if (d.type === 'removed') {
        removed++
        charsRemoved += d.oldLine?.text.length || 0
      }
    })
    return { added, removed, charsAdded, charsRemoved }
  }, [contentDiff, outlineDiff, diffMode])

  // 渲染行内内容（包括公式）
  const renderInlineContent = (inlineContent: InlineContentData[], diffType?: 'added' | 'removed' | 'same') => {
    return inlineContent.map((item, idx) => {
      if (item.type === 'formula') {
        // 渲染公式
        return (
          <span
            key={idx}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 6px',
              margin: '0 2px',
              borderRadius: '3px',
              backgroundColor: 'rgba(139, 92, 246, 0.1)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              fontFamily: 'monospace',
              fontSize: '0.9em',
            }}
            title={item.latex}
          >
            {item.latex || '∅'}
          </span>
        )
      } else if (item.type === 'citation') {
        // 渲染引用
        return (
          <span
            key={idx}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '1px 6px',
              margin: '0 2px',
              borderRadius: '3px',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              fontSize: '0.85em',
            }}
            title={item.citationTitle}
          >
            [{item.citationIndex || '?'}]
          </span>
        )
      } else {
        // 普通文本
        return <span key={idx}>{item.text}</span>
      }
    })
  }

  // 渲染表格
  const renderTable = (table: NonNullable<BlockData['table']>, diffType?: 'added' | 'removed' | 'same') => {
    if (!table.rows || table.rows.length === 0) return null
    
    const diffBg = diffType === 'added' 
      ? 'rgba(34, 197, 94, 0.08)' 
      : diffType === 'removed' 
        ? 'rgba(239, 68, 68, 0.08)' 
        : 'transparent'
    
    return (
      <div style={{
        overflowX: 'auto',
        margin: '8px 0',
        borderRadius: 6,
        border: '1px solid var(--border-color)',
        background: diffBg,
      }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 14,
        }}>
          <tbody>
            {table.rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.cells.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    style={{
                      padding: '8px 12px',
                      border: '1px solid var(--border-color)',
                      verticalAlign: 'top',
                      minWidth: 60,
                      backgroundColor: rowIdx === 0 ? 'var(--bg-secondary)' : undefined,
                      fontWeight: rowIdx === 0 ? 500 : 400,
                    }}
                  >
                    {cell.content.length > 0 
                      ? renderInlineContent(cell.content, diffType) 
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // 渲染单个 block 的 Markdown 样式
  const renderBlockStyle = (block: BlockData, diffType?: 'added' | 'removed' | 'same') => {
    const isHeading = block.type === 'heading'
    const level = block.level || 1
    
    const baseStyle: React.CSSProperties = {
      lineHeight: 1.8,
      marginBottom: isHeading ? 8 : 4,
      color: 'var(--text-primary)',
    }
    
    if (isHeading) {
      return {
        ...baseStyle,
        fontSize: level === 1 ? 24 : level === 2 ? 20 : 16,
        fontWeight: 600,
        marginTop: level === 1 ? 20 : 16,
        paddingBottom: 4,
        borderBottom: level === 1 || level === 2 ? '1px solid var(--border-color)' : 'none',
      }
    }
    
    return {
      ...baseStyle,
      fontSize: 15,
      fontWeight: 400,
    }
  }

  // 渲染字符级 diff
  const renderCharDiff = (charDiff: { type: 'same' | 'added' | 'removed'; text: string }[]) => {
    return charDiff.map((d, idx) => {
      if (d.type === 'same') {
        return <span key={idx}>{d.text}</span>
      } else if (d.type === 'added') {
        return (
          <span 
            key={idx} 
            style={{ 
              background: 'rgba(34, 197, 94, 0.3)', 
              color: '#166534',
              borderRadius: 2,
            }}
          >
            {d.text}
          </span>
        )
      } else {
        return (
          <span 
            key={idx} 
            style={{ 
              background: 'rgba(239, 68, 68, 0.3)', 
              color: '#991b1b',
              textDecoration: 'line-through',
              borderRadius: 2,
            }}
          >
            {d.text}
          </span>
        )
      }
    })
  }

  // 渲染单个块的内容（包含公式等）
  const renderBlockContent = (block: BlockData, diffType?: 'added' | 'removed' | 'same') => {
    // 如果是表格，渲染表格
    if (block.type === 'table' && block.table) {
      return renderTable(block.table, diffType)
    }
    
    // 如果有行内内容（包含公式），使用行内渲染
    if (block.inlineContent && block.inlineContent.length > 0) {
      return renderInlineContent(block.inlineContent, diffType)
    }
    
    // 否则返回纯文本
    return block.text
  }

  // 渲染 diff
  const renderDiff = () => {
    const diff = diffMode === 'content' ? contentDiff : outlineDiff
    
    if (diff.length === 0) {
      return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>无差异</div>
    }
    
    return (
      <div style={{ padding: '20px 32px', maxWidth: 800, margin: '0 auto' }}>
        {diff.map((d, index) => {
          if (d.type === 'same') {
            const block = d.newLine!
            return (
              <div key={index} style={renderBlockStyle(block, 'same')}>
                {renderBlockContent(block, 'same')}
              </div>
            )
          } else if (d.type === 'added') {
            const block = d.newLine!
            // 如果有行内内容（公式），不使用 charDiff，保持公式渲染
            const hasInlineContent = block.inlineContent && block.inlineContent.length > 0
            const hasCharDiff = d.charDiff && d.oldLine && !block.table && !hasInlineContent
            
            return (
              <div 
                key={index} 
                style={{ 
                  ...renderBlockStyle(block, 'added'),
                  background: 'rgba(34, 197, 94, 0.08)',
                  borderLeft: '3px solid #22c55e',
                  marginLeft: -16,
                  paddingLeft: 13,
                  borderRadius: '0 4px 4px 0',
                }}
              >
                {hasCharDiff ? renderCharDiff(d.charDiff!) : renderBlockContent(block, 'added')}
              </div>
            )
          } else {
            const block = d.oldLine!
            
            // 表格删除时直接渲染表格
            if (block.type === 'table' && block.table) {
              return (
                <div 
                  key={index}
                  style={{ 
                    opacity: 0.6,
                    marginLeft: -16,
                    paddingLeft: 13,
                  }}
                >
                  {renderTable(block.table, 'removed')}
                </div>
              )
            }
            
            return (
              <div 
                key={index} 
                style={{ 
                  ...renderBlockStyle(block, 'removed'),
                  background: 'rgba(239, 68, 68, 0.08)',
                  borderLeft: '3px solid #ef4444',
                  marginLeft: -16,
                  paddingLeft: 13,
                  borderRadius: '0 4px 4px 0',
                  opacity: 0.7,
                }}
              >
                <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>
                  {block.text}
                </span>
              </div>
            )
          }
        })}
      </div>
    )
  }

  return (
    <>
      {/* 工具栏按钮 */}
      <Button
        size="sm"
        color="default"
        variant="flat"
        startContent={<HistoryIcon />}
        onPress={onHistoryOpen}
      >
        版本历史
      </Button>
      <Button
        size="sm"
        color="secondary"
        variant="flat"
        startContent={<SaveIcon />}
        onPress={() => {
          const now = new Date()
          const defaultTitle = `版本 ${now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
          setNewVersionTitle(defaultTitle)
          onSaveOpen()
        }}
      >
        保存版本
      </Button>

      {/* 版本历史弹窗 - 全屏左右分栏 */}
      <Modal 
        isOpen={isHistoryOpen} 
        onClose={onHistoryClose} 
        size="full"
        scrollBehavior="outside"
      >
        <ModalContent style={{ height: '92vh' }}>
          <ModalHeader style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12,
            padding: '12px 20px',
            borderBottom: '1px solid var(--border-color)',
          }}>
            <HistoryIcon />
            <span>版本历史</span>
            <Chip size="sm" variant="flat">{versions.length}/20</Chip>
            <div style={{ flex: 1 }} />
            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={<SaveIcon />}
              onPress={() => {
                const now = new Date()
                const defaultTitle = `版本 ${now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                setNewVersionTitle(defaultTitle)
                onSaveOpen()
              }}
            >
              保存当前版本
            </Button>
            <Button variant="light" size="sm" onPress={onHistoryClose}>关闭</Button>
          </ModalHeader>
          <ModalBody style={{ 
            flex: 1, 
            padding: 0, 
            display: 'flex', 
            flexDirection: 'row',
            overflow: 'hidden',
          }}>
            {/* 左侧版本列表 */}
            <div style={{
              width: 300,
              borderRight: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
            }}>
              <div style={{
                padding: '8px 12px',
                fontSize: 12,
                color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border-color)',
                background: 'var(--bg-secondary)',
              }}>
                选择版本查看差异
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {versions.length === 0 ? (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: 40, 
                    color: 'var(--text-muted)' 
                  }}>
                    <HistoryIcon />
                    <p style={{ marginTop: 12 }}>暂无历史版本</p>
                    <p style={{ fontSize: 12, marginTop: 4 }}>点击上方按钮保存版本</p>
                  </div>
                ) : (
                  versions.map((version) => {
                    const headings = extractHeadings(version.content as Block[])
                    const isSelected = selectedVersion?.id === version.id
                    
                    return (
                      <div
                        key={version.id}
                        onClick={() => setSelectedVersion(version)}
                        style={{
                          padding: '10px 14px',
                          background: isSelected ? 'var(--accent-color-light, rgba(59, 130, 246, 0.1))' : 'transparent',
                          borderLeft: isSelected ? '3px solid var(--accent-color)' : '3px solid transparent',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                          <div style={{ 
                            fontWeight: 500, 
                            fontSize: 13,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}>
                            {version.title}
                          </div>
                          <div style={{ display: 'flex', gap: 2, marginLeft: 8 }} onClick={(e) => e.stopPropagation()}>
                            <Button
                              size="sm"
                              variant="light"
                              color="danger"
                              isIconOnly
                              onPress={() => handleDeleteVersion(version.id)}
                              style={{ minWidth: 24, height: 24 }}
                            >
                              <TrashIcon />
                            </Button>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                          {formatVersionDate(version.createdAt)}
                          {version.wordCount && ` · ${version.wordCount} 字`}
                          {headings.length > 0 && ` · ${headings.length} 标题`}
                        </div>
                        {version.isAuto && (
                          <Chip size="sm" color="primary" variant="flat" style={{ height: 18, fontSize: 10 }}>自动</Chip>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* 右侧 Diff 展示 */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              {selectedVersion ? (
                <>
                  {/* 工具栏 */}
                  <div style={{
                    padding: '8px 16px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'var(--bg-secondary)',
                  }}>
                    <span style={{ fontWeight: 500 }}>{selectedVersion.title}</span>
                    {selectedVersion.isAuto && (
                      <Chip size="sm" color="primary" variant="flat">自动保存</Chip>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(selectedVersion.createdAt).toLocaleString('zh-CN')}
                    </span>
                    <div style={{ flex: 1 }} />
                    
                    {/* Diff 模式切换 */}
                    <div style={{ display: 'flex', gap: 4, marginRight: 12 }}>
                      <Button
                        size="sm"
                        variant={diffMode === 'content' ? 'solid' : 'light'}
                        color={diffMode === 'content' ? 'primary' : 'default'}
                        onPress={() => setDiffMode('content')}
                      >
                        正文对比
                      </Button>
                      <Button
                        size="sm"
                        variant={diffMode === 'outline' ? 'solid' : 'light'}
                        color={diffMode === 'outline' ? 'primary' : 'default'}
                        onPress={() => setDiffMode('outline')}
                      >
                        大纲对比
                      </Button>
                    </div>

                    {/* 变化统计 */}
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, marginRight: 12 }}>
                      {diffStats.added > 0 && (
                        <span style={{ color: '#22c55e' }}>+{diffStats.added} 行 ({diffStats.charsAdded} 字)</span>
                      )}
                      {diffStats.removed > 0 && (
                        <span style={{ color: '#ef4444' }}>−{diffStats.removed} 行 ({diffStats.charsRemoved} 字)</span>
                      )}
                      {diffStats.added === 0 && diffStats.removed === 0 && (
                        <span style={{ color: 'var(--text-muted)' }}>无变化</span>
                      )}
                    </div>

                    <Button
                      size="sm"
                      color="primary"
                      variant="flat"
                      startContent={<RestoreIcon />}
                      onPress={onConfirmOpen}
                    >
                      恢复此版本
                    </Button>
                  </div>

                  {/* Diff 内容 */}
                  <div style={{
                    flex: 1,
                    overflow: 'auto',
                    background: 'var(--bg-primary)',
                  }}>
                    {renderDiff()}
                  </div>

                  {/* 图例 */}
                  <div style={{
                    padding: '8px 16px',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    gap: 20,
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    background: 'var(--bg-secondary)',
                  }}>
                    <span>
                      <span style={{ 
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        background: 'rgba(34, 197, 94, 0.2)',
                        borderLeft: '2px solid #22c55e',
                        borderRadius: 2,
                        marginRight: 4,
                        verticalAlign: 'middle',
                      }}></span>
                      新增
                    </span>
                    <span>
                      <span style={{ 
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        background: 'rgba(239, 68, 68, 0.2)',
                        borderLeft: '2px solid #ef4444',
                        borderRadius: 2,
                        marginRight: 4,
                        verticalAlign: 'middle',
                      }}></span>
                      删除
                    </span>
                    <span>
                      <span style={{ 
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        background: 'rgba(34, 197, 94, 0.3)',
                        borderRadius: 2,
                        marginRight: 4,
                        verticalAlign: 'middle',
                      }}></span>
                      字符级新增
                    </span>
                    <span>
                      <span style={{ 
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        background: 'rgba(239, 68, 68, 0.3)',
                        textDecoration: 'line-through',
                        borderRadius: 2,
                        marginRight: 4,
                        verticalAlign: 'middle',
                      }}></span>
                      字符级删除
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      对比：历史版本 → 当前版本
                    </span>
                  </div>
                </>
              ) : (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-muted)',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <HistoryIcon />
                    <p style={{ marginTop: 12 }}>选择左侧版本查看差异</p>
                  </div>
                </div>
              )}
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* 保存版本弹窗 */}
      <Modal isOpen={isSaveOpen} onClose={onSaveClose} size="sm">
        <ModalContent>
          <ModalHeader>保存版本快照</ModalHeader>
          <ModalBody>
            <Input
              label="版本名称"
              placeholder="输入版本名称..."
              value={newVersionTitle}
              onValueChange={setNewVersionTitle}
              autoFocus
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              当前文档共 {calculateWordCount(currentContent)} 字
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onSaveClose}>取消</Button>
            <Button color="primary" onPress={handleSaveVersion}>保存</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 确认恢复弹窗 */}
      <Modal isOpen={isConfirmOpen} onClose={onConfirmClose} size="sm">
        <ModalContent>
          <ModalHeader>确认恢复</ModalHeader>
          <ModalBody>
            <p>确定要恢复到版本「{selectedVersion?.title}」吗？</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              当前内容将被替换，恢复前会自动保存当前版本。
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onConfirmClose}>取消</Button>
            <Button color="primary" onPress={handleConfirmRestore}>确认恢复</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
