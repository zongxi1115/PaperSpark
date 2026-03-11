'use client'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import 'mathlive'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Textarea } from '@heroui/react'

interface FormulaEditorProps {
  isOpen: boolean
  initialLatex: string
  onSave: (latex: string) => void
  onClose: () => void
}

export function FormulaEditor({ isOpen, initialLatex, onSave, onClose }: FormulaEditorProps) {
  const [latex, setLatex] = useState(initialLatex)
  const mathfieldRef = useRef<HTMLElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isUpdatingFromLatex = useRef(false)

  // 初始化
  useEffect(() => {
    if (isOpen) {
      setLatex(initialLatex)
    }
  }, [initialLatex, isOpen])

  // 创建 mathfield 元素
  useEffect(() => {
    if (!isOpen || !containerRef.current) return

    // 清除旧的 mathfield
    containerRef.current.innerHTML = ''
    
    // 使用 math-field 自定义元素
    const mf = document.createElement('math-field') as HTMLElement & {
      value: string
      focus: () => void
    }
    
    mf.value = latex
    mf.style.cssText = `
      width: 100%;
      min-height: 60px;
      font-size: 18px;
      border: none;
      background: transparent;
    `
    
    // 使用 input 事件，性能更好
    const handleInput = () => {
      if (isUpdatingFromLatex.current) return
      const newLatex = mf.value
      setLatex(newLatex)
    }
    
    mf.addEventListener('input', handleInput)
    
    containerRef.current.appendChild(mf)
    mathfieldRef.current = mf
    
    // 自动聚焦
    setTimeout(() => {
      mf.focus()
    }, 50)
    
    return () => {
      mf.removeEventListener('input', handleInput)
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
      mathfieldRef.current = null
    }
  }, [isOpen])

  // 同步 latex 输入到 mathfield
  const handleLatexChange = useCallback((value: string) => {
    setLatex(value)
    // 同步到 mathfield
    if (mathfieldRef.current && 'value' in mathfieldRef.current) {
      isUpdatingFromLatex.current = true
      ;(mathfieldRef.current as any).value = value
      // 使用 requestAnimationFrame 确保更新完成
      requestAnimationFrame(() => {
        isUpdatingFromLatex.current = false
      })
    }
  }, [])

  const handleSave = useCallback(() => {
    onSave(latex)
    onClose()
  }, [latex, onSave, onClose])

  // 快捷键
  useEffect(() => {
    if (!isOpen) return
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault()
        handleSave()
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, handleSave])

  // 渲染预览
  const previewHtml = useMemo(() => {
    if (!latex) return ''
    // 使用 mathlive 渲染
    return `<span style="font-family: 'Times New Roman', 'STIX Two Math', serif; font-size: 18px;">$${latex}$</span>`
  }, [latex])

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose}
      size="2xl"
      placement="center"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1 pb-2">
          编辑公式
        </ModalHeader>
        <ModalBody className="gap-4">
          {/* 可视化编辑区 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm text-default-500">可视化编辑</label>
            <div 
              className="rounded-lg border-1 border-default-200 bg-default-50 p-4 min-h-[60px]"
              style={{
                // mathlive 字体配置
                '--mathfield-fonts-directory': 'https://cdn.jsdelivr.net/npm/mathlive/dist/fonts/',
              } as React.CSSProperties}
            >
              <div ref={containerRef} />
            </div>
          </div>

          {/* LaTeX 源码 */}
          <div className="flex flex-col gap-2">
            <label className="text-sm text-default-500">LaTeX 源码</label>
            <Textarea
              value={latex}
              onValueChange={handleLatexChange}
              placeholder="输入 LaTeX 公式..."
              minRows={2}
              maxRows={4}
              classNames={{
                input: "font-mono text-sm"
              }}
            />
          </div>
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button 
            variant="flat" 
            onPress={onClose}
          >
            取消
          </Button>
          <Button 
            color="primary" 
            onPress={handleSave}
          >
            确定 (Ctrl+Enter)
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}