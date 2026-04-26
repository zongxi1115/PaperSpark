'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { Button, Card, CardBody, CardHeader, Divider, addToast } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  buildWorkspaceSnapshot,
  getWorkspaceBridgeStatus,
  saveWorkspaceSnapshotToDisk,
  syncWorkspaceSnapshotToServer,
} from '@/lib/workspaceSnapshotClient'
import { DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME } from '@/lib/workspaceSnapshot'

const CLI_EXAMPLE = [
  '.\\paperspark-data.ps1 summary',
  '.\\paperspark-data.ps1 list knowledge',
  '.\\paperspark-data.ps1 get knowledge <knowledgeId> --field immersive.fullText --raw',
].join('\n')

type BridgeStatus = Awaited<ReturnType<typeof getWorkspaceBridgeStatus>>

export function WorkspaceSnapshotCard() {
  const [exporting, setExporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  const refreshStatus = async (showErrorToast = false) => {
    try {
      const nextStatus = await getWorkspaceBridgeStatus()
      setStatus(nextStatus)
    } catch (error) {
      if (showErrorToast) {
        addToast({
          title: '读取桥接状态失败',
          description: error instanceof Error ? error.message : '未知错误',
          color: 'warning',
        })
      }
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    void refreshStatus()
    const intervalId = window.setInterval(() => {
      void refreshStatus()
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [])

  const handleExport = async () => {
    setExporting(true)
    try {
      const snapshot = await buildWorkspaceSnapshot()
      const result = await saveWorkspaceSnapshotToDisk(snapshot)
      addToast({
        title: result.method === 'file-picker' ? '离线备份已保存' : '离线备份已开始下载',
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
        description: `知识库 ${snapshot.stats.knowledgeItems} 篇，文档 ${snapshot.stats.documents} 篇，资产 ${snapshot.stats.assets} 条。桥接缓存位置：${result.filePath}`,
        color: 'success',
      })
      await refreshStatus()
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

  const statusLabel = getStatusLabel(status, statusLoading)
  const syncedLabel = status?.syncedAt ? formatDateTime(status.syncedAt) : '尚未桥接'
  const statsLabel = status?.stats
    ? `知识库 ${status.stats.knowledgeItems} 篇 / 文档 ${status.stats.documents} 篇 / 资产 ${status.stats.assets} 条`
    : '等待本地服务收到工作区数据'

  return (
    <Card shadow="sm">
      <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon icon="solar:server-square-cloud-linear" width={18} style={{ color: 'var(--text-muted)' }} />
          <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>CLI 实时桥接</p>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          应用打开时会自动把浏览器里的工作区数据桥接到本地服务，CLI 直接请求 HTTP 接口拿最新内容。JSON 导出只作为离线备份。
        </p>
      </CardHeader>
      <Divider />
      <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>桥接状态</span>
            <span style={tileValueStyle}>{statusLabel}</span>
          </div>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>上次同步</span>
            <span style={tileValueStyle}>{syncedLabel}</span>
          </div>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>CLI 入口</span>
            <code style={codeStyle}>.\paperspark-data.ps1</code>
          </div>
          <div style={tileStyle}>
            <span style={tileLabelStyle}>离线备份</span>
            <code style={codeStyle}>{DEFAULT_WORKSPACE_SNAPSHOT_FILE_NAME}</code>
          </div>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: 'var(--text-secondary)' }}>
            当前桥接概况
          </p>
          <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0, color: 'var(--text-muted)' }}>
            {statsLabel}
          </p>
          {!status?.available && status?.message ? (
            <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0, color: 'var(--text-muted)' }}>
              {status.message}
            </p>
          ) : null}
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
            立即同步
          </Button>
          <Button
            color="primary"
            onPress={handleExport}
            isLoading={exporting}
            startContent={!exporting ? <Icon icon="solar:download-linear" width={16} /> : undefined}
          >
            导出离线备份
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

function getStatusLabel(status: BridgeStatus | null, loading: boolean) {
  if (loading) return '正在检测'
  if (!status?.available) return '等待连接'
  if (typeof status.ageMs === 'number' && status.ageMs <= 30000) return '已连接，内容较新'
  return '已连接，可能需要刷新'
}

function formatDateTime(input: string) {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) return input
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
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
