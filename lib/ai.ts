import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import type { ModelConfig } from './types'

/**
 * 通用 AI 文本生成函数
 */
export async function generateAIText(
  prompt: string,
  systemPrompt: string,
  modelConfig: ModelConfig
): Promise<{ success: boolean; text?: string; error?: string }> {
  if (!modelConfig?.apiKey || !modelConfig?.modelName) {
    return { success: false, error: '模型未配置，请先在设置页面填写 API Key 和模型名称' }
  }

  try {
    const provider = createOpenAI({
      baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
      apiKey: modelConfig.apiKey,
    })

    const { text } = await generateText({
      model: provider.chat(modelConfig.modelName),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    })

    return { success: true, text }
  } catch (err) {
    const message = err instanceof Error ? err.message : '请求失败'
    return { success: false, error: message }
  }
}

/**
 * 文本纠错（修正错别字）
 */
export async function correctText(
  text: string,
  modelConfig: ModelConfig
): Promise<{ success: boolean; corrected?: string; error?: string }> {
  if (!text || text.trim().length < 2) {
    return { success: true, corrected: text }
  }

  const systemPrompt = `你是一个精准的文字校对助手。请改正输入文本中的错别字和拼写错误，保持原文的格式、标点和意思完全不变。只返回修正后的文本，不要添加任何解释、前缀或后缀。如果文本没有错误，原样返回。`

  const result = await generateAIText(text, systemPrompt, modelConfig)
  return {
    success: result.success,
    corrected: result.text,
    error: result.error,
  }
}

/**
 * 翻译文本（英译中，学术风格）
 */
export async function translateText(
  text: string,
  modelConfig: ModelConfig,
  options?: { sourceLang?: string; targetLang?: string; style?: string }
): Promise<{ success: boolean; translated?: string; error?: string }> {
  if (!text || text.trim().length < 2) {
    return { success: true, translated: text }
  }

  const sourceLang = options?.sourceLang || '英文'
  const targetLang = options?.targetLang || '中文'
  const style = options?.style || '学术'

  const systemPrompt = `你是一个专业的学术翻译助手。请将输入的${sourceLang}文本翻译成${targetLang}，保持${style}风格。要求：
1. 准确传达原文含义，不要遗漏或添加内容
2. 使用规范的学术术语和表达方式
3. 保持专业、严谨的语言风格
4. 只返回翻译后的文本，不要添加任何解释、前缀或后缀`

  const result = await generateAIText(text, systemPrompt, modelConfig)
  return {
    success: result.success,
    translated: result.text,
    error: result.error,
  }
}

/**
 * 生成摘要
 */
export async function generateSummary(
  content: string,
  modelConfig: ModelConfig,
  options?: { maxLength?: number; language?: string }
): Promise<{ success: boolean; summary?: string; error?: string }> {
  if (!content || content.trim().length < 10) {
    return { success: false, error: '内容太短，无法生成摘要' }
  }

  const maxLength = options?.maxLength || 500
  const language = options?.language || '中文'

  const systemPrompt = `你是一个学术文献摘要生成助手。请为给定的文献内容生成一份精炼的摘要，要求：
1. 用${language}撰写，字数控制在${maxLength}字以内
2. 概括研究背景、方法、主要发现和结论
3. 语言简洁、专业，突出核心贡献
4. 只返回摘要内容，不要添加任何标题、解释或前缀`

  const prompt = `请为以下文献内容生成摘要：\n\n${content.slice(0, 8000)}`

  const result = await generateAIText(prompt, systemPrompt, modelConfig)
  return {
    success: result.success,
    summary: result.text,
    error: result.error,
  }
}

/**
 * 提取文献元数据
 */
export async function extractMetadata(
  content: string,
  modelConfig: ModelConfig,
  fileName?: string
): Promise<{ 
  success: boolean
  metadata?: { title: string; authors: string[]; abstract: string; year: string; journal: string }
  error?: string 
}> {
  if (!content || content.trim().length < 50) {
    return { 
      success: false, 
      metadata: { title: fileName || '未知标题', authors: [], abstract: '', year: '', journal: '' }
    }
  }

  const systemPrompt = `你是一个学术文献元数据提取助手。请从给定的文献内容中提取以下信息，并以 JSON 格式返回：
{
  "title": "文献标题",
  "authors": ["作者1", "作者2"],
  "abstract": "摘要内容（如果没有找到摘要，请根据内容生成一个简短的摘要，100字以内）",
  "year": "发表年份",
  "journal": "期刊或会议名称"
}

要求：
1. 只返回 JSON 对象，不要添加任何解释或 markdown 代码块标记
2. 如果某项信息无法确定，使用空字符串
3. 作者列表最多保留前5位`

  const prompt = `请从以下文献内容中提取元数据：\n\n${content.slice(0, 6000)}`

  const result = await generateAIText(prompt, systemPrompt, modelConfig)
  
  if (!result.success || !result.text) {
    return {
      success: false,
      metadata: { title: fileName || '未知标题', authors: [], abstract: '', year: '', journal: '' },
      error: result.error,
    }
  }

  try {
    // 尝试解析 JSON
    let jsonStr = result.text.trim()
    // 移除可能的 markdown 代码块标记
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    const metadata = JSON.parse(jsonStr)
    return {
      success: true,
      metadata: {
        title: metadata.title || fileName || '未知标题',
        authors: metadata.authors || [],
        abstract: metadata.abstract || '',
        year: metadata.year || '',
        journal: metadata.journal || '',
      },
    }
  } catch {
    return {
      success: false,
      metadata: { title: fileName || '未知标题', authors: [], abstract: '', year: '', journal: '' },
      error: '解析元数据失败',
    }
  }
}

/**
 * 随记想法 - AI 处理类型
 */
export type ThoughtAIAction = 'summarize' | 'organize' | 'refine' | 'expand'

/**
 * 随记想法 - 生成标题和概述
 */
export async function generateThoughtSummary(
  content: string,
  modelConfig: ModelConfig
): Promise<{ success: boolean; title?: string; summary?: string; error?: string }> {
  if (!content || content.trim().length < 10) {
    return { success: false, error: '内容太短，无法生成概述' }
  }

  const systemPrompt = `你是一个思维整理助手。请分析用户的随记内容，生成一个简短的标题和概述。

要求：
1. 标题：10字以内，精准概括核心主题
2. 概述：50-100字，提炼关键要点和核心思想
3. 以 JSON 格式返回：{"title": "标题", "summary": "概述"}
4. 只返回 JSON，不要添加任何解释或 markdown 标记`

  const result = await generateAIText(content.slice(0, 3000), systemPrompt, modelConfig)
  
  if (!result.success || !result.text) {
    return { success: false, error: result.error }
  }

  try {
    let jsonStr = result.text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    const parsed = JSON.parse(jsonStr)
    return {
      success: true,
      title: parsed.title || '无标题',
      summary: parsed.summary || '',
    }
  } catch {
    return { success: false, error: '解析结果失败' }
  }
}

/**
 * 随记想法 - AI 整理
 */
export async function organizeThought(
  content: string,
  modelConfig: ModelConfig
): Promise<{ success: boolean; result?: string; error?: string }> {
  if (!content || content.trim().length < 5) {
    return { success: false, error: '内容太短' }
  }

  const systemPrompt = `你是一个思维整理助手。请将用户的碎片化想法整理成更有条理、更清晰的表达。

要求：
1. 保持原文的核心意思不变
2. 调整语序和结构，使逻辑更清晰
3. 修正明显的语病和错别字
4. 保留用户的个人风格和语气
5. 只返回整理后的文本，不要添加任何解释`

  const result = await generateAIText(content, systemPrompt, modelConfig)
  return {
    success: result.success,
    result: result.text,
    error: result.error,
  }
}

/**
 * 随记想法 - AI 提炼
 */
export async function refineThought(
  content: string,
  modelConfig: ModelConfig
): Promise<{ success: boolean; result?: string; error?: string }> {
  if (!content || content.trim().length < 5) {
    return { success: false, error: '内容太短' }
  }

  const systemPrompt = `你是一个思维提炼助手。请提炼用户想法中的核心观点和关键信息。

要求：
1. 用精炼的语言概括核心观点
2. 删除冗余和重复的内容
3. 突出最重要的信息
4. 保持简洁，控制在原文长度的1/3以内
5. 只返回提炼后的文本，不要添加任何解释`

  const result = await generateAIText(content, systemPrompt, modelConfig)
  return {
    success: result.success,
    result: result.text,
    error: result.error,
  }
}

/**
 * 随记想法 - AI 思维扩展
 */
export async function expandThought(
  content: string,
  modelConfig: ModelConfig
): Promise<{ success: boolean; result?: string; error?: string }> {
  if (!content || content.trim().length < 5) {
    return { success: false, error: '内容太短' }
  }

  const systemPrompt = `你是一个思维扩展助手。请基于用户的想法进行思维扩展，帮助用户发现更多可能性和关联。

要求：
1. 分析用户想法的深层含义
2. 提供相关的思考角度和扩展方向
3. 可能的关联主题或延伸问题
4. 保持启发性，激发用户的进一步思考
5. 输出格式：
   - 深层含义：...
   - 扩展方向：...
   - 关联主题：...
   - 延伸问题：...`

  const result = await generateAIText(content, systemPrompt, modelConfig)
  return {
    success: result.success,
    result: result.text,
    error: result.error,
  }
}
