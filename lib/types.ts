export interface AppDocument {
  id: string
  title: string
  content: unknown[]
  createdAt: string
  updatedAt: string
}

export interface ModelConfig {
  baseUrl: string
  apiKey: string
  modelName: string
}



/**
 * 功能选择项列表，后续增加功能只需在此处添加对应项，并在 AppSettings 中添加对应字段即可
 * autoCorrect: 自动纠错，停止输入 2.5 秒后，使用小参数模型自动检测并修复当前段落的错别字
 * autoComplete: 自动补全小片段，输入时自动补全当前段落的小片段内容，提升输入效率
 * threeLineTable: 三线表，用于创建符合学术规范的三线表
 */
export const selectFeatures = ['autoCorrect', 'autoComplete', 'threeLineTable'] as const
export type FeatureSelectItem = {
  label: string
  description: string
  settingKey: typeof selectFeatures[number]
}


export type AppSettings = {
  smallModel: ModelConfig
  largeModel: ModelConfig
} & { [key in typeof selectFeatures[number]]: boolean
}

function getDefaultSettings(): AppSettings {

  return {
    smallModel: {
      baseUrl: process.env.NEXT_PUBLIC_SMALL_MODEL_BASE_URL || 'https://openrouter.ai/api/v1',
      apiKey: process.env.NEXT_PUBLIC_SMALL_MODEL_API_KEY || '',
      modelName: process.env.NEXT_PUBLIC_SMALL_MODEL_NAME || 'stepfun/step-3.5-flash:free',
    },
    largeModel: {
      baseUrl: process.env.NEXT_PUBLIC_LARGE_MODEL_BASE_URL || 'https://api.openai.com/v1',
      apiKey: process.env.NEXT_PUBLIC_LARGE_MODEL_API_KEY || '',
      modelName: process.env.NEXT_PUBLIC_LARGE_MODEL_NAME || 'gpt-4o',
    },
    ...selectFeatures.reduce((acc, key) => ({ ...acc, [key]: false }), {} as Record<typeof selectFeatures[number], boolean>),
  }
}

export const defaultSettings: AppSettings = getDefaultSettings()
