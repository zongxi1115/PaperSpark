'use client'

import { ReactNode } from 'react'
import {
  useComponentsContext,
  useBlockNoteEditor,
  RemoveBlockItem,
  BlockColorsItem,
} from '@blocknote/react'
import { SideMenuExtension } from '@blocknote/core/extensions'
import { useExtensionState } from '@blocknote/react'

// 块类型定义
const BLOCK_TYPES = [
  { type: 'paragraph', label: '正文', icon: '¶' },
  { type: 'heading', props: { level: 1 }, label: '一级标题', icon: 'H1' },
  { type: 'heading', props: { level: 2 }, label: '二级标题', icon: 'H2' },
  { type: 'heading', props: { level: 3 }, label: '三级标题', icon: 'H3' },
  { type: 'bulletListItem', label: '无序列表', icon: '•' },
  { type: 'numberedListItem', label: '有序列表', icon: '1.' },
  { type: 'checkListItem', label: '待办列表', icon: '☐' },
  { type: 'quote', label: '引用', icon: '"' },
  { type: 'code', label: '代码块', icon: '</>' },
]

// 对齐方式定义
const ALIGNMENT_OPTIONS = [
  { value: 'left', label: '居左', icon: <AlignLeftIcon /> },
  { value: 'center', label: '居中', icon: <AlignCenterIcon /> },
  { value: 'right', label: '居右', icon: <AlignRightIcon /> },
]

// 对齐图标组件
function AlignLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="17" y1="10" x2="3" y2="10" />
      <line x1="21" y1="6" x2="3" y2="6" />
      <line x1="21" y1="14" x2="3" y2="14" />
      <line x1="17" y1="18" x2="3" y2="18" />
    </svg>
  )
}

function AlignCenterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="10" x2="6" y2="10" />
      <line x1="21" y1="6" x2="3" y2="6" />
      <line x1="21" y1="14" x2="3" y2="14" />
      <line x1="18" y1="18" x2="6" y2="18" />
    </svg>
  )
}

function AlignRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="21" y1="10" x2="7" y2="10" />
      <line x1="21" y1="6" x2="3" y2="6" />
      <line x1="21" y1="14" x2="3" y2="14" />
      <line x1="21" y1="18" x2="7" y2="18" />
    </svg>
  )
}

/**
 * 转换块类型的子菜单项
 */
function BlockTypeItem({
  type,
  props,
  label,
  icon,
  currentBlock,
  onClose,
}: {
  type: string
  props?: Record<string, unknown>
  label: string
  icon: string
  currentBlock: any
  onClose?: () => void
}) {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor<any, any, any>()

  const isCurrentType =
    currentBlock.type === type &&
    (!props || JSON.stringify(currentBlock.props) === JSON.stringify(props))

  const handleClick = () => {
    const content = currentBlock.content
    editor.updateBlock(currentBlock, {
      type,
      props: props || {},
      content,
    })
    onClose?.()
  }

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={handleClick}
      icon={<span style={{ width: 24, fontSize: 12, textAlign: 'center' }}>{icon}</span>}
      checked={isCurrentType}
    >
      {label}
    </Components.Generic.Menu.Item>
  )
}

/**
 * 对齐方式子菜单项
 */
function AlignmentItem({
  value,
  label,
  icon,
  currentBlock,
}: {
  value: string
  label: string
  icon: ReactNode
  currentBlock: any
}) {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor<any, any, any>()

  const currentAlignment = currentBlock.props?.textAlignment || 'left'
  const isCurrentAlignment = currentAlignment === value

  const handleClick = () => {
    editor.updateBlock(currentBlock, {
      props: { textAlignment: value },
    })
  }

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={handleClick}
      icon={<span style={{ width: 24, display: 'flex', justifyContent: 'center' }}>{icon}</span>}
      checked={isCurrentAlignment}
    >
      {label}
    </Components.Generic.Menu.Item>
  )
}

/**
 * 转换为子菜单
 */
function ConvertToItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor<any, any, any>()

  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })

  if (block === undefined) {
    return null
  }

  // 检查是否是支持转换的块类型
  const supportedTypes = ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote', 'code']
  if (!supportedTypes.includes(block.type)) {
    return null
  }

  return (
    <Components.Generic.Menu.Root position="right" sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          {children}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>

      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {BLOCK_TYPES.map((blockType) => (
          <BlockTypeItem
            key={blockType.type + (blockType.props ? `-${JSON.stringify(blockType.props)}` : '')}
            type={blockType.type}
            props={blockType.props}
            label={blockType.label}
            icon={blockType.icon}
            currentBlock={block}
          />
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

/**
 * 布局子菜单
 */
function LayoutItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!
  const editor = useBlockNoteEditor<any, any, any>()

  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  })

  if (block === undefined) {
    return null
  }

  // 检查是否是支持对齐的块类型（文本类块）
  const supportedTypes = ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote']
  if (!supportedTypes.includes(block.type)) {
    return null
  }

  return (
    <Components.Generic.Menu.Root position="right" sub>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          {children}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>

      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {ALIGNMENT_OPTIONS.map((option) => (
          <AlignmentItem
            key={option.value}
            value={option.value}
            label={option.label}
            icon={option.icon}
            currentBlock={block}
          />
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  )
}

/**
 * 自定义拖拽手柄菜单
 * 包含：转换为、布局、颜色、删除
 */
export function CustomDragHandleMenu() {
  const Components = useComponentsContext()!

  return (
    <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu">
      <ConvertToItem>转换为</ConvertToItem>
      <LayoutItem>布局</LayoutItem>
      <BlockColorsItem>颜色</BlockColorsItem>
      <Components.Generic.Menu.Divider className="bn-menu-divider" />
      <RemoveBlockItem>删除</RemoveBlockItem>
    </Components.Generic.Menu.Dropdown>
  )
}