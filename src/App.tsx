import { useCallback, useEffect, useState } from 'react'
import { BlockNoteEditor, Block } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import {
  Accordion,
  AccordionItem,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Chip,
  Code,
  Divider,
  Input,
  Kbd,
  Link,
  Listbox,
  ListboxItem,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Progress,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Slider,
  Snippet,
  Switch,
  Tab,
  Tabs,
  Textarea,
  Tooltip,
  useDisclosure,
} from '@heroui/react'
import { zh } from '@blocknote/core/locales'
import '@blocknote/mantine/style.css'
import './App.css'

type BlockType = Block

interface Document {
  id: string
  title: string
  content: BlockType[]
  createdAt: Date
  updatedAt: Date
}

const exportFormats = [
  { key: 'markdown', label: 'Markdown' },
  { key: 'docx', label: 'Word 文稿' },
  { key: 'latex', label: 'LaTeX 草稿' },
]

const generateId = () => Math.random().toString(36).substring(2, 9)

const formatDate = (date: Date) => {
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const extractTitle = (content: BlockType[]): string => {
  if (content.length > 0 && content[0].type === 'heading') {
    const block = content[0] as any
    if (block.content && Array.isArray(block.content)) {
      const text = block.content.map((c: any) => c.text || '').join('')
      if (text) return text
    }
  }
  if (content.length > 0 && content[0].type === 'paragraph') {
    const block = content[0] as any
    if (block.content && Array.isArray(block.content)) {
      const text = block.content.map((c: any) => c.text || '').join('')
      if (text) return text.slice(0, 30)
    }
  }
  return '无标题文档'
}



function App() {
  const [documents, setDocuments] = useState<Document[]>([
    {
      id: generateId(),
      title: '欢迎使用论文写作工具',
      content: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ])
  
  const [activeDocId, setActiveDocId] = useState<string | null>(documents[0]?.id || null)
  const [editorKey, setEditorKey] = useState(0)
  const { isOpen, onOpen, onClose } = useDisclosure()

  const activeDocument = documents.find(doc => doc.id === activeDocId)

  const editor: BlockNoteEditor = useCreateBlockNote({
    dictionary: {
      ...zh,
      placeholders:{
        ...zh.placeholders,
        emptyDocument: '开始写作，输入 / 可以快速选择语段类型，开始愉快的协作时光~',
        
      }
    }
  })

  // Update editor content when active document changes
  useEffect(() => {
    if (activeDocument && editor) {
      // Replace editor content with active document content
      const blocks = activeDocument.content
      if (blocks.length > 0) {
        editor.replaceBlocks(editor.document, blocks as any)
      } else {
        editor.replaceBlocks(editor.document, [])
      }
    }
  }, [activeDocId, editorKey])

  const handleNewDocument = useCallback(() => {
    const newDoc: Document = {
      id: generateId(),
      title: '新建文档',
      content: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
    setDocuments(prev => [newDoc, ...prev])
    setActiveDocId(newDoc.id)
    setEditorKey(k => k + 1)
  }, [])

  const handleSelectDocument = useCallback((docId: string) => {
    if (docId !== activeDocId) {
      // Save current document first
      if (activeDocId && editor) {
        const content = editor.document as BlockType[]
        const title = extractTitle(content)
        setDocuments(prev => prev.map(doc => 
          doc.id === activeDocId 
            ? { ...doc, title, content, updatedAt: new Date() }
            : doc
        ))
      }
      setActiveDocId(docId)
      setEditorKey(k => k + 1)
    }
  }, [activeDocId, editor])

  const handleChange = useCallback(() => {
    if (!activeDocId || !editor) return
    
    const content = editor.document as BlockType[]
    const title = extractTitle(content)
    
    setDocuments(prev => prev.map(doc => 
      doc.id === activeDocId 
        ? { ...doc, title, content, updatedAt: new Date() }
        : doc
    ))
  }, [activeDocId, editor])

  const handleExport = useCallback(() => {
    if (!activeDocument || !editor) return
    
    const content = editor.document
    const markdown = content.map(block => {
      const blockAny = block as any
      const text = blockAny.content && Array.isArray(blockAny.content) 
        ? blockAny.content.map((c: any) => c.text || '').join('')
        : ''
      
      if (block.type === 'heading') {
        const level = blockAny.props?.level || 1
        return '#'.repeat(level) + ' ' + text
      }
      if (block.type === 'paragraph') {
        return text
      }
      if (block.type === 'bulletListItem') {
        return '- ' + text
      }
      if (block.type === 'numberedListItem') {
        return '1. ' + text
      }
      return text
    }).join('\n\n')
    
    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeDocument.title}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeDocument, editor])

  const handleDeleteDocument = useCallback((docId: string) => {
    setDocuments(prev => {
      const newDocs = prev.filter(doc => doc.id !== docId)
      if (activeDocId === docId) {
        const newActiveId = newDocs[0]?.id || null
        setActiveDocId(newActiveId)
        setEditorKey(k => k + 1)
      }
      return newDocs
    })
    onClose()
  }, [activeDocId, onClose])

  return (
    <div className="app">
      {/* 侧边栏 */}
      <aside className="sidebar">
        <Card className="sidebar-card h-full" shadow="none">
          <CardHeader className="sidebar-header flex-col items-start gap-2 px-4 pt-4">
            <div className="flex items-center gap-2 w-full">
              <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
              </svg>
              <h1 className="text-lg font-semibold">论文写作</h1>
            </div>
            <Button 
              color="primary" 
              className="w-full"
              startContent={
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              }
              onPress={handleNewDocument}
            >
              新建文档
            </Button>
          </CardHeader>
          <Divider />
          <CardBody className="p-2 overflow-auto">
            <Listbox 
              aria-label="文档列表"
              variant="flat"
              selectionMode="single"
              selectedKeys={activeDocId ? new Set([activeDocId]) : new Set()}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string
                if (selected) handleSelectDocument(selected)
              }}
              emptyContent={<p className="text-default-400 text-center">暂无文档</p>}
            >
              {documents.map(doc => (
                <ListboxItem 
                  key={doc.id} 
                  textValue={doc.title}
                  className="doc-list-item"
                >
                  <div className="flex flex-col gap-1 py-1">
                    <span className="text-sm font-medium truncate">{doc.title}</span>
                    <span className="text-xs text-default-400">{formatDate(doc.updatedAt)}</span>
                  </div>
                </ListboxItem>
              ))}
            </Listbox>
          </CardBody>
        </Card>
      </aside>

      {/* 主内容区 */}
      <main className="main-content">
        {activeDocument ? (
          <>
            <div className="toolbar">
              <Tooltip content="导出为Markdown文件" placement="bottom">
                <Button 
                  color="primary" 
                  variant="solid"
                  startContent={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7,10 12,15 17,10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  }
                  onPress={handleExport}
                >
                  导出 Markdown
                </Button>
              </Tooltip>
              <Divider orientation="vertical" className="h-6" />
              <Tooltip content="删除当前文档" placement="bottom" color="danger">
                <Button 
                  color="danger" 
                  variant="light"
                  startContent={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3,6 5,6 21,6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  }
                  onPress={onOpen}
                >
                  删除
                </Button>
              </Tooltip>
            </div>

            <div className="workspace-layout">
              <div className="editor-pane">
                <div className="editor-container">
                  <div className="editor-wrapper">
                    <BlockNoteView
                      key={editorKey}
                      editor={editor}
                      onChange={handleChange}
                      theme="light"
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="welcome-screen">
            <Card className="welcome-card p-8" shadow="sm">
              <CardBody className="flex flex-col items-center gap-4 text-center">
                <div className="welcome-icon text-primary">
                  <svg className="w-16 h-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                  </svg>
                </div>
                <h2 className="text-2xl font-semibold">开始写作</h2>
                <p className="text-default-500">点击左侧"新建文档"创建你的第一篇论文</p>
                <Button color="primary" size="lg" onPress={handleNewDocument}>
                  创建文档
                </Button>
              </CardBody>
            </Card>
          </div>
        )}
      </main>

      {/* 删除确认对话框 */}
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>确认删除</ModalHeader>
          <ModalBody>
            <p>确定要删除文档 "<strong>{activeDocument?.title}</strong>" 吗？此操作无法撤销。</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              取消
            </Button>
            <Button color="danger" onPress={() => activeDocument && handleDeleteDocument(activeDocument.id)}>
              删除
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

export default App
