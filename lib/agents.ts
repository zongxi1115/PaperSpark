import type { Agent, AgentCapabilityId, EditorComment } from './types'

export interface AgentCapabilityDefinition {
  id: AgentCapabilityId
  label: string
  description: string
  group: 'assistant' | 'document'
}

export const REVIEWER_AGENT_ID = 'preset-paper-reviewer'

export const AGENT_CAPABILITY_DEFINITIONS: AgentCapabilityDefinition[] = [
  {
    id: 'knowledge_search',
    label: '知识库检索',
    description: '允许在回答时检索本地知识库与 RAG 证据。',
    group: 'assistant',
  },
  {
    id: 'asset_reference',
    label: '引用资产库',
    description: '允许引用资产库中的素材、标签与摘要作为上下文。',
    group: 'assistant',
  },
  {
    id: 'literature_search',
    label: '论文搜索 API',
    description: '预留论文搜索能力，后续可接入联网文献发现与筛选。',
    group: 'assistant',
  },
  {
    id: 'document_read',
    label: '读取文稿',
    description: '允许读取当前 BlockNote 文档内容与块结构。',
    group: 'document',
  },
  {
    id: 'document_edit',
    label: '修改文稿',
    description: '允许对当前文档执行插入、更新、删除等编辑操作。',
    group: 'document',
  },
  {
    id: 'document_comment',
    label: '添加批注',
    description: '允许基于文档片段生成评论、批注或修改意见。',
    group: 'document',
  },
  {
    id: 'document_issue_mark',
    label: '问题标记',
    description: '允许在编辑器中为问题段落打风险态或高亮标识。',
    group: 'document',
  },
  {
    id: 'document_review',
    label: '执行审稿',
    description: '允许以审稿流程读取文稿、定位问题并生成结构化意见。',
    group: 'document',
  },
]

const PRESET_AGENT_DEFAULTS: Record<string, Pick<Agent, 'description' | 'capabilities'>> = {
  'preset-academic-writer': {
    description: '擅长学术写作、结构扩写与知识证据整合。',
    capabilities: ['knowledge_search', 'asset_reference', 'literature_search', 'document_read', 'document_edit'],
  },
  'preset-drop-ai-rate': {
    description: '专注论文改写与降 AI 痕迹，偏向逐段润色。',
    capabilities: ['document_read', 'document_edit'],
  },
  'preset-mermaid-drawer': {
    description: '根据现有内容抽取结构并生成 Mermaid 图示。',
    capabilities: ['document_read'],
  },
  [REVIEWER_AGENT_ID]: {
    description: '像审稿人一样阅读全文，输出批注并标记风险段落。',
    capabilities: ['document_read', 'document_comment', 'document_issue_mark', 'document_review'],
  },
}

const LEGACY_CUSTOM_AGENT_CAPABILITIES: AgentCapabilityId[] = [
  'knowledge_search',
  'asset_reference',
  'document_read',
  'document_edit',
]

function uniqueCapabilities(capabilities?: AgentCapabilityId[]): AgentCapabilityId[] {
  if (!Array.isArray(capabilities)) return []
  return Array.from(new Set(capabilities.filter(Boolean)))
}

export function getCapabilityDefinition(capabilityId: AgentCapabilityId): AgentCapabilityDefinition {
  return AGENT_CAPABILITY_DEFINITIONS.find(item => item.id === capabilityId) ?? {
    id: capabilityId,
    label: capabilityId,
    description: capabilityId,
    group: 'assistant',
  }
}

export function normalizeAgent(agent: Agent): Agent {
  const presetDefaults = PRESET_AGENT_DEFAULTS[agent.id]
  const fallbackCapabilities = presetDefaults?.capabilities
    ?? (agent.capabilities === undefined ? LEGACY_CUSTOM_AGENT_CAPABILITIES : [])
  const capabilities = uniqueCapabilities(agent.capabilities ?? fallbackCapabilities)

  return {
    ...presetDefaults,
    ...agent,
    description: agent.description ?? presetDefaults?.description ?? '',
    capabilities,
  }
}

export function normalizeAgents(agents: Agent[]): Agent[] {
  return agents.map(normalizeAgent)
}

export function agentHasCapability(agent: Agent | null | undefined, capabilityId: AgentCapabilityId): boolean {
  if (!agent) return false
  return normalizeAgent(agent).capabilities?.includes(capabilityId) ?? false
}

export function getAgentCapabilityDefinitions(agent: Agent | null | undefined): AgentCapabilityDefinition[] {
  if (!agent) return []
  return (normalizeAgent(agent).capabilities ?? []).map(getCapabilityDefinition)
}

export function canAgentUseKnowledge(agent: Agent | null | undefined): boolean {
  return agentHasCapability(agent, 'knowledge_search')
}

export function canAgentUseAssets(agent: Agent | null | undefined): boolean {
  return agentHasCapability(agent, 'asset_reference')
}

export function canAgentReadDocument(agent: Agent | null | undefined): boolean {
  return agentHasCapability(agent, 'document_read')
    || agentHasCapability(agent, 'document_edit')
    || agentHasCapability(agent, 'document_review')
}

export function canAgentEditDocument(agent: Agent | null | undefined): boolean {
  return agentHasCapability(agent, 'document_edit')
}

export function canAgentCommentDocument(agent: Agent | null | undefined): boolean {
  return agentHasCapability(agent, 'document_comment')
}

export function canAgentMarkDocumentIssues(agent: Agent | null | undefined): boolean {
  return agentHasCapability(agent, 'document_issue_mark')
}

export function canAgentReviewDocument(agent: Agent | null | undefined): boolean {
  return agentHasCapability(agent, 'document_review')
}

export function isAgentReviewComment(comment: Pick<EditorComment, 'source' | 'capabilityId'> | null | undefined): boolean {
  return comment?.source === 'agent' && comment.capabilityId === 'document_review'
}
