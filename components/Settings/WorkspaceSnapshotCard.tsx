'use client'

import { useState, type CSSProperties } from 'react'
import { Button, Card, CardBody, CardHeader, Divider, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  buildWorkspaceSnapshot,
  saveWorkspaceSnapshotToDisk,
  syncWorkspaceSnapshotToServer,
} from '@/lib/workspaceSnapshotClient'
import { DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME } from '@/lib/workspaceSnapshot'

const CLI_EXAMPLE = [
  '.\\paperspark-data.ps1 summary --server http://127.0.0.1:3000',
  '.\\paperspark-data.ps1 list knowledge --server http://127.0.0.1:3000',
  '.\\paperspark-data.ps1 get knowledge <knowledgeId> --field immersive.fullText --raw --server http://127.0.0.1:3000',
].join('\n')

export function WorkspaceSnapshotCard() {
  const [exporting, setExporting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const snapshot = await buildWorkspaceSnapshot()
      const result = await saveWorkspaceSnapshotToDisk(snapshot)
      addToast({
        title: result.method === 'file-picker' ? 'CLI 快照已保存' : 'CLI 快照已开始下载',
        description: `已导出 ${snapshot.stats.knowledgeItems} 篇知识项、${snapshot.stats.documents} 篇文档、${snapshot.stats.assets} 条资产到 ${DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME}`,
        color: 'success',
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        addToast({ title: '已取消导出', color: 'default' })
      } else {
        addToast({
          title: '导出失败',
          description: error instanceof Error ? error.message : '未知错误',
          color: 'danger',
        })
      }
    } finally {
      setExporting(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const snapshot = await buildWorkspaceSnapshot()
      const result = await syncWorkspaceSnapshotToServer(snapshot)
      addToast({
        title: '已同步到本地服务',
        description: `知识库 ${snapshot.stats.knowledgeItems} 篇，文档 ${snapshot.stats.documents} 篇，资产 ${snapshot.stats.assets} 条。服务端缓存位置：${result.filePath}`,
        color: 'success',
      })
    } catch (error) {
      addToast({
        title: '服务同步失败',
        description: error instanceof Error ? error.message : '未知错误',
        color: 'danger',
      })
    } finally {
      setSyncing(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CLI_EXAMPLE)
      addToast({ title: 'CLI 示例已复制', color: 'success' })
    } catch (error) {
      addToast({
        title: '复制失败',
        description: error instanceof Error ? error.message : '请手动复制命令',
        color: 'warning',
      })
    }
  }

  return (
    <Card shadow="sm">
      <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon icon="solar:database-export-linear" width={18} style={{ color: 'var(--text-muted)' }} />
          <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>CLI 数据快照</p>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          将本地知识库、精读全文、导读概要、资产库、文档、随记与助手会话统一导出为 JSON，方便其他 AI 工具通过 CLI 调用。
        </p>
      </CardHeader>
      <Divider />
      <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>包含内容</span>
            <span style={tileValueStyle}>知识库、全文、导读、资产、文档</span>
          </div>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>默认文件名</span>
            <code style={codeStyle}>{DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME}</code>
          </div>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>CLI 入口</span>
            <code style={codeStyle}>.\paperspark-data.ps1</code>
          </div>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>服务端同步</span>
            <span style={tileValueStyle}>同步后 CLI 可直接走 HTTP，不必读本地 JSON</span>
          </div>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 600, margin: '0 0 6px', color: 'var(--text-secondary)' }}>
            建议用法
          </p>
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono, Consolas, monospace)',
            }}
          >
            {CLI_EXAMPLE}
          </pre>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            color="secondary"
            variant="flat"
            onPress={handleSync}
            isLoading={syncing}
            startContent={!syncing ? <Icon icon="solar:cloud-upload-linear" width={16} /> : undefined}
          >
            同步到本地服务
          </Button>
          <Button
            color="primary"
            onPress={handleExport}
            isLoading={exporting}
            startContent={!exporting ? <Icon icon="solar:download-linear" width={16} /> : undefined}
          >
            导出 JSON 快照
          </Button>
          <Button
            variant="flat"
            color="default"
            onPress={handleCopy}
            startContent={<Icon icon="solar:copy-linear" width={16} />}
          >
            复制 CLI 示例
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

const tileStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 10,
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border-color)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const tileLabelStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--text-muted)',
}

const tileValueStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary)',
  lineHeight: 1.4,
}

const codeStyle: CSSProperties = {
  fontSize: 12,
  padding: '2px 6px',
  borderRadius: 6,
  background: 'var(--bg-tertiary)',
  width: 'fit-content',
}
