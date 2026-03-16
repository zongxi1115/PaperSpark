'use client'

import type React from 'react'
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button, addToast } from '@heroui/react'
import { generateId } from '@/lib/storage'
import type { AppSettings } from '@/lib/types'
import {
  deriveProviderNameFromCommand,
  getSelectedLiteratureProvider,
} from '@/lib/literatureProviders'
import type {
  LiteratureProviderConfig,
  LiteratureProviderTestResult,
} from '@/lib/literatureProviders'

interface LiteratureSourceStudioProps {
  isOpen: boolean
  onClose: () => void
  settings: AppSettings
  onSettingsChange: (nextSettings: AppSettings) => void
  reduceMotion: boolean | null
}

export function LiteratureSourceStudio({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  reduceMotion,
}: LiteratureSourceStudioProps) {
  const providers = settings.literatureProviders || []
  const selectedProvider = getSelectedLiteratureProvider(settings)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftCommand, setDraftCommand] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, LiteratureProviderTestResult>>({})

  const editingProvider = useMemo(
    () => providers.find(provider => provider.id === draftId) || null,
    [draftId, providers],
  )

  function beginCreate() {
    setDraftId('new')
    setDraftCommand('')
  }

  function beginEdit(provider: LiteratureProviderConfig) {
    setDraftId(provider.id)
    setDraftCommand(provider.command || '')
  }

  function resetDraft() {
    setDraftId(null)
    setDraftCommand('')
  }

  function saveDraft() {
    const command = draftCommand.trim()
    if (!command) {
      addToast({ title: '请输入 MCP 命令', color: 'warning' })
      return
    }

    const now = new Date().toISOString()
    const nextProvider: LiteratureProviderConfig = editingProvider
      ? {
          ...editingProvider,
          name: deriveProviderNameFromCommand(command),
          command,
          updatedAt: now,
        }
      : {
          id: `literature-provider-${generateId()}`,
          name: deriveProviderNameFromCommand(command),
          kind: 'mcp',
          transport: 'stdio',
          enabled: true,
          command,
          description: '通过命令启动的 MCP 文献源。',
          createdAt: now,
          updatedAt: now,
        }

    const nextProviders = editingProvider
      ? providers.map(provider => provider.id === nextProvider.id ? nextProvider : provider)
      : [...providers, nextProvider]

    onSettingsChange({
      ...settings,
      literatureProviders: nextProviders,
      defaultLiteratureProviderId: settings.defaultLiteratureProviderId || nextProvider.id,
    })

    resetDraft()
    addToast({ title: editingProvider ? '命令已更新' : 'MCP 数据源已添加', color: 'success' })
  }

  function removeProvider(provider: LiteratureProviderConfig) {
    if (provider.isBuiltIn) return
    const nextProviders = providers.filter(item => item.id !== provider.id)
    const fallback = nextProviders.find(item => item.enabled) || nextProviders[0] || null
    onSettingsChange({
      ...settings,
      literatureProviders: nextProviders,
      defaultLiteratureProviderId: settings.defaultLiteratureProviderId === provider.id
        ? fallback?.id || null
        : settings.defaultLiteratureProviderId,
    })
    setTests(current => {
      const next = { ...current }
      delete next[provider.id]
      return next
    })
    resetDraft()
  }

  function selectProvider(providerId: string) {
    onSettingsChange({
      ...settings,
      defaultLiteratureProviderId: providerId,
    })
  }

  async function testProvider(provider: LiteratureProviderConfig) {
    setTestingId(provider.id)
    try {
      const response = await fetch('/api/literature-providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const payload = await response.json() as LiteratureProviderTestResult
      setTests(current => ({ ...current, [provider.id]: payload }))
      addToast({
        title: response.ok ? '连接测试完成' : '连接测试失败',
        description: payload.message,
        color: response.ok ? 'success' : 'danger',
      })
    } catch (error) {
      addToast({
        title: '连接测试失败',
        description: error instanceof Error ? error.message : '未知错误',
        color: 'danger',
      })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: -10 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -10 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          style={{
            marginTop: 12,
            padding: 14,
            borderRadius: 22,
            border: '1px solid color-mix(in srgb, #0f766e 16%, var(--border-color))',
            background: 'linear-gradient(135deg, rgba(250,250,247,0.98), rgba(239,246,255,0.92))',
            boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',
            display: 'grid',
            gap: 14,
            maxHeight: 'min(68vh, 640px)',
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollbarGutter: 'stable',
            overscrollBehavior: 'contain',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: '#0f766e' }}>SOURCE STUDIO</div>
              <div style={{ marginTop: 6, fontSize: 15, fontWeight: 700, lineHeight: 1.45 }}>
                用户只配置命令，系统自动发现 MCP 工具并交给检索 agent 自主探索。
              </div>
              <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: 'rgba(15, 23, 42, 0.64)' }}>
                不需要字段映射。连通性测试会直接展示远端实际暴露的工具目录。
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button size="sm" variant="flat" onPress={beginCreate}>
                添加命令
              </Button>
              <Button size="sm" variant="light" onPress={onClose}>
                收起
              </Button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {providers.map(provider => {
              const test = tests[provider.id]
              const isCurrent = selectedProvider?.id === provider.id
              return (
                <article
                  key={provider.id}
                  style={{
                    padding: 14,
                    borderRadius: 18,
                    background: isCurrent
                      ? 'linear-gradient(180deg, rgba(255,255,255,0.98), color-mix(in srgb, var(--accent-color) 7%, white))'
                      : 'rgba(255,255,255,0.82)',
                    border: `1px solid ${isCurrent ? 'color-mix(in srgb, var(--accent-color) 22%, transparent)' : 'color-mix(in srgb, var(--border-color) 72%, transparent)'}`,
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{provider.name}</div>
                        {isCurrent && <Badge>当前</Badge>}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(15, 23, 42, 0.58)', lineHeight: 1.55 }}>
                        {provider.kind === 'openalex' ? '内置检索源' : provider.command}
                      </div>
                    </div>
                    <Badge>{provider.transport}</Badge>
                  </div>

                  {test && (
                    <div
                      style={{
                        padding: '8px 10px',
                        borderRadius: 12,
                        background: test.ok ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                        fontSize: 11,
                        lineHeight: 1.6,
                        color: test.ok ? '#047857' : '#b91c1c',
                      }}
                    >
                      {test.message}
                    </div>
                  )}

                  {test?.tools.length ? (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {test.tools.slice(0, 8).map(tool => (
                        <Badge key={`${provider.id}-${tool.name}`}>{tool.name}</Badge>
                      ))}
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button size="sm" color="primary" variant={isCurrent ? 'solid' : 'flat'} onPress={() => selectProvider(provider.id)}>
                      使用此源
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      isLoading={testingId === provider.id}
                      onPress={() => void testProvider(provider)}
                    >
                      测试
                    </Button>
                    {!provider.isBuiltIn && (
                      <Button size="sm" variant="light" onPress={() => beginEdit(provider)}>
                        编辑命令
                      </Button>
                    )}
                    {!provider.isBuiltIn && (
                      <Button size="sm" variant="light" color="danger" onPress={() => removeProvider(provider)}>
                        删除
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {draftId && (
            <div
              style={{
                padding: 14,
                borderRadius: 18,
                background: 'rgba(255,255,255,0.9)',
                border: '1px solid color-mix(in srgb, var(--border-color) 72%, transparent)',
                display: 'grid',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {editingProvider ? '编辑 MCP 命令' : '添加 MCP 命令'}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(15, 23, 42, 0.58)', lineHeight: 1.6 }}>
                例如：`uvx fwma-mcp`、`python server.py`。保存后即可做连通性测试。
              </div>
              <textarea
                value={draftCommand}
                onChange={event => setDraftCommand(event.target.value)}
                placeholder="输入完整命令行"
                style={{
                  width: '100%',
                  minHeight: 90,
                  resize: 'vertical',
                  borderRadius: 14,
                  border: '1px solid color-mix(in srgb, var(--border-color) 75%, transparent)',
                  background: 'rgba(255,255,255,0.96)',
                  padding: '10px 12px',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button size="sm" variant="light" onPress={resetDraft}>
                  取消
                </Button>
                <Button size="sm" color="primary" onPress={saveDraft}>
                  保存
                </Button>
              </div>
            </div>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: '5px 8px',
        borderRadius: 999,
        background: 'rgba(15, 23, 42, 0.05)',
        color: 'rgba(15, 23, 42, 0.62)',
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  )
}
