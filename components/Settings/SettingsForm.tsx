'use client'
import setting from './setting-block.module.css'
import { useEffect, useState } from 'react'
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    Divider,
    Input,
    Switch,
    addToast,
} from '@heroui/react'
import { getSettings, saveSettings } from '@/lib/storage'
import type { AppSettings, FeatureSelectItem, ModelConfig } from '@/lib/types'
import { defaultSettings } from '@/lib/types'

function ModelSection({
    title,
    subtitle,
    value,
    onChange,
}: {
    title: string
    subtitle: string
    value: ModelConfig
    onChange: (v: ModelConfig) => void
}) {
    return (
        <Card shadow="sm">
            <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>{title}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{subtitle}</p>
            </CardHeader>
            <Divider />
            <CardBody style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Input
                    label="Base URL"
                    placeholder="https://api.openai.com/v1"
                    value={value.baseUrl}
                    onValueChange={v => onChange({ ...value, baseUrl: v })}
                    size="sm"
                    variant="bordered"
                    description="API 端点地址，兼容 OpenAI 格式"
                />
                <Input
                    label="API Key"
                    placeholder="sk-..."
                    type="password"
                    value={value.apiKey}
                    onValueChange={v => onChange({ ...value, apiKey: v })}
                    size="sm"
                    variant="bordered"
                    description="密钥不会上传到服务器，仅存储在本地"
                />
                <Input
                    label="模型名称"
                    placeholder="gpt-4o-mini"
                    value={value.modelName}
                    onValueChange={v => onChange({ ...value, modelName: v })}
                    size="sm"
                    variant="bordered"
                    description="填写具体的模型标识符"
                />
            </CardBody>
        </Card>
    )
}





export function SettingsForm() {
    const [settings, setSettings] = useState<AppSettings>(defaultSettings)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        setSettings(getSettings())
    }, [])

    const handleSave = () => {
        saveSettings(settings)
        setSaved(true)
        addToast({ title: '设置已保存', color: 'success' })
        setTimeout(() => setSaved(false), 2000)
    }

    const handleReset = () => {
        setSettings(defaultSettings)
        saveSettings(defaultSettings)
        addToast({ title: '已恢复默认设置', color: 'default' })
    }
    const featureSelectItems: FeatureSelectItem[] = [
        { label: '自动纠错', description: '停止输入 2.5 秒后，使用小参数模型自动检测并修复当前段落的错别字', settingKey: 'autoCorrect' },
        { label: "自动补全小片段", description: "输入时自动补全当前段落的小片段内容，提升输入效率", settingKey: 'autoComplete' },
        { label: "三线表", description: "用于创建符合学术规范的三线表", settingKey: 'threeLineTable' },
    ]
    return (
        <div style={{ padding: '32px', maxWidth: 640, margin: '0 auto' }}>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>设置</h1>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    配置 AI 模型与功能偏好，数据仅保存在本地
                </p>
            </div>

            <Divider style={{ marginBottom: 24 }} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Small model */}
                <ModelSection
                    title="小参数模型"
                    subtitle="用于自动纠错、快速补全等轻量任务"
                    value={settings.smallModel}
                    onChange={v => setSettings(s => ({ ...s, smallModel: v }))}
                />

                {/* Large model */}
                <ModelSection
                    title="大参数模型"
                    subtitle="用于深度分析、长文改写等复杂任务"
                    value={settings.largeModel}
                    onChange={v => setSettings(s => ({ ...s, largeModel: v }))}
                />

                {/* Feature toggles */}
                <Card shadow="sm">
                    <CardHeader style={{ padding: '14px 16px 8px', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>功能设置</p>
                    </CardHeader>
                    <Divider />
                    <CardBody style={{ padding: 16 }}>
                        {/* <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                            <div>
                                <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>自动纠错</p>
                                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                                    停止输入 2.5 秒后，使用小参数模型自动检测并修复当前段落的错别字
                                </p>
                            </div>
                            <Switch
                                isSelected={settings.autoCorrect}
                                onValueChange={v => setSettings(s => ({ ...s, autoCorrect: v }))}
                                size="sm"
                                color="primary"
                            />
                        </div> */}
                        {featureSelectItems.map(item => (
                            <div key={item.settingKey}  className={setting.block}  >
                                <div>
                                    <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>{item.label}</p>
                                    <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                                        {item.description}
                                    </p>
                                </div>
                                <Switch
                                    isSelected={settings[item.settingKey]}
                                    onValueChange={v => setSettings(s => ({ ...s, [item.settingKey]: v }))}
                                    size="sm"
                                    color="primary"
                                />
                            </div>
                        ))}

                    </CardBody>
                </Card>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
                    <Button color="primary" onPress={handleSave} isDisabled={saved}>
                        {saved ? '已保存 ✓' : '保存设置'}
                    </Button>
                    <Button variant="light" color="default" onPress={handleReset}>
                        恢复默认
                    </Button>
                </div>
            </div>
        </div>
    )
}
