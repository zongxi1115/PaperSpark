import type { AssistantToolInvocation, EditorCommentSeverity } from './types'
import type { DocumentBlockInfo } from './agentDocument'

export const AGENT_TOOL_NAMES = [
  'readCurrentDocument',
  'commentCurrentDocument',
  'editCurrentDocument',
] as const

export type AgentToolName = typeof AGENT_TOOL_NAMES[number]

export interface AgentDocumentContext {
  documentId?: string
  title?: string
  markdown: string
  structure: DocumentBlockInfo[]
}

export interface AgentDocumentCommentInput {
  blockId: string
  selectedText?: string
  comment: string
  severity?: EditorCommentSeverity
}

export interface AgentDocumentCommentOutput {
  summary?: string
  replaceExisting?: boolean
  comments: AgentDocumentCommentInput[]
}

export interface AgentEditInsertOperation {
  type: 'insert'
  position: 'before' | 'after'
  referenceId?: string
  content: string
}

export interface AgentEditUpdateOperation {
  type: 'update'
  blockId: string
  content: string
}

export interface AgentEditDeleteOperation {
  type: 'delete'
  blockId: string
}

export type AgentEditOperation =
  | AgentEditInsertOperation
  | AgentEditUpdateOperation
  | AgentEditDeleteOperation

export interface AgentEditToolOutput {
  summary?: string
  operations: AgentEditOperation[]
}

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value)
}

export function getAgentToolLabel(toolName: string): string {
  switch (toolName) {
    case 'readCurrentDocument':
      return '读取文稿'
    case 'commentCurrentDocument':
      return '添加批注'
    case 'editCurrentDocument':
      return '编辑文稿'
    default:
      return toolName
  }
}

export function isToolInvocationPendingApply(invocation: AssistantToolInvocation): boolean {
  return invocation.status === 'completed' || invocation.status === 'reviewing'
}
