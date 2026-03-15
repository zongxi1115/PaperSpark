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

// 将 blocks 转换为纯文本（按段落）
function blocksToLines(blocks: Block[]): string[] {
  return blocks.map(b => {
    const block = b as { type: string; props?: { level?: number }; content?: { type: string; text: string }[] }
    const text = block.content
      ?.filter(c => c.type === 'text')
      .map(c => c.text)
      .join('') ?? ''
    
    if (block.type === 'heading') {
      const level = block.props?.level ?? 1
      return `${'#'.repeat(level)} ${text}`
    }
    return text
  }).filter(t => t.trim())
}

// LCS diff 算法
function diffLines(oldLines: string[], newLines: string[]): { type: 'same' | 'added' | 'removed'; text: string }[] {
  if (oldLines.length === 0 && newLines.length === 0) return []
  if (oldLines.length === 0) return newLines.map(text => ({ type: 'added' as const, text }))
  if (newLines.length === 0) return oldLines.map(text => ({ type: 'removed' as const, text }))
  
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  
  const result: { type: 'same' | 'added' | 'removed'; text: string }[] = []
  let i = m, j = n
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'same', text: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', text: newLines[j - 1] })
      j--
    } else if (i > 0) {
      result.unshift({ type: 'removed', text: oldLines[i - 1] })
      i--
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
    // 默认选中第一个
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
    const versionLines = blocksToLines(selectedVersion.content as Block[])
    const currentLines = blocksToLines(currentContent)
    return diffLines(versionLines, currentLines)
  }, [selectedVersion, currentContent])

  // 计算大纲 diff
  const outlineDiff = useMemo(() => {
    if (!selectedVersion) return []
    const versionHeadings = extractHeadings(selectedVersion.content as Block[])
    const currentHeadings = extractHeadings(currentContent)
    return diffLines(
      versionHeadings.map(h => `${'#'.repeat(h.level)} ${h.text}`),
      currentHeadings.map(h => `${'#'.repeat(h.level)} ${h.text}`)
    )
  }, [selectedVersion, currentContent])

  // 统计 diff 变化
  const diffStats = useMemo(() => {
    const diff = diffMode === 'content' ? contentDiff : outlineDiff
    let added = 0, removed = 0
    diff.forEach(d => {
      if (d.type === 'added') added++
      if (d.type === 'removed') removed++
    })
    return { added, removed }
  }, [contentDiff, outlineDiff, diffMode])

  // 渲染 diff
  const renderDiff = () => {
    const diff = diffMode === 'content' ? contentDiff : outlineDiff
    
    if (diff.length === 0) {
      return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>无差异</div>
    }
    
    return diff.map((d, index) => {
      const isHeading = d.text.startsWith('#')
      
      if (d.type === 'same') {
        return (
          <div 
            key={index}
            style={{ 
              padding: '3px 16px',
              color: 'var(--text-secondary)',
              fontWeight: isHeading ? 500 : 400,
              lineHeight: 1.6,
              fontSize: 13,
              fontFamily: 'Consolas, Monaco, monospace',
            }}
          >
            <span style={{ color: 'var(--text-muted)', marginRight: 12, userSelect: 'none' }}> </span>
            {d.text}
          </div>
        )
      } else if (d.type === 'added') {
        return (
          <div 
            key={index}
            style={{ 
              padding: '3px 16px',
              background: 'rgba(34, 197, 94, 0.12)',
              borderLeft: '3px solid #22c55e',
              color: 'var(--text-primary)',
              lineHeight: 1.6,
              fontSize: 13,
              fontFamily: 'Consolas, Monaco, monospace',
            }}
          >
            <span style={{ color: '#22c55e', marginRight: 8, fontWeight: 600 }}>+</span>
            {d.text}
          </div>
        )
      } else {
        return (
          <div 
            key={index}
            style={{ 
              padding: '3px 16px',
              background: 'rgba(239, 68, 68, 0.12)',
              borderLeft: '3px solid #ef4444',
              color: 'var(--text-muted)',
              textDecoration: 'line-through',
              lineHeight: 1.6,
              fontSize: 13,
              fontFamily: 'Consolas, Monaco, monospace',
            }}
          >
            <span style={{ color: '#ef4444', marginRight: 8, fontWeight: 600, textDecoration: 'none' }}>−</span>
            {d.text}
          </div>
        )
      }
    })
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
                          <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
                            <Button
                              size="sm"
                              variant="light"
                              color="danger"
                              isIconOnly
                              onPress={(e) => {
                                e.stopPropagation()
                                handleDeleteVersion(version.id)
                              }}
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
                    <div style={{ display: 'flex', gap: 8, fontSize: 12, marginRight: 12 }}>
                      {diffStats.added > 0 && (
                        <span style={{ color: '#22c55e' }}>+{diffStats.added}</span>
                      )}
                      {diffStats.removed > 0 && (
                        <span style={{ color: '#ef4444' }}>−{diffStats.removed}</span>
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
                      新增行
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
                      删除行
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