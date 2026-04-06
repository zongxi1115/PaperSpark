"use client"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import { createContext, useContext } from "react"

const CitationContext = createContext<{
  title: string
  sourceKind: string
  pageNum?: number
  year?: string
  journal?: string
  authors?: string[]
  excerpt?: string
  index: number
} | null>(null)

function useCitationContext() {
  const ctx = useContext(CitationContext)
  if (!ctx) throw new Error("Citation.* must be used inside <Citation>")
  return ctx
}

export type CitationProps = {
  title: string
  sourceKind: string
  pageNum?: number
  year?: string
  journal?: string
  authors?: string[]
  excerpt?: string
  index: number
  children: React.ReactNode
}

export function Citation({
  title,
  sourceKind,
  pageNum,
  year,
  journal,
  authors,
  excerpt,
  index,
  children,
}: CitationProps) {
  return (
    <CitationContext.Provider value={{ title, sourceKind, pageNum, year, journal, authors, excerpt, index }}>
      <HoverCard openDelay={150} closeDelay={0}>
        {children}
      </HoverCard>
    </CitationContext.Provider>
  )
}

export type CitationTriggerProps = {
  className?: string
}

export function CitationTrigger({ className }: CitationTriggerProps) {
  const { title, index } = useCitationContext()

  return (
    <HoverCardTrigger asChild>
      <span
        className={cn(
          "inline-flex h-5 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums transition-colors hover:bg-muted-foreground/30 hover:text-primary cursor-pointer select-none",
          className
        )}
      >
        {index}
      </span>
    </HoverCardTrigger>
  )
}

export type CitationContentProps = {
  className?: string
}

export function CitationContent({ className }: CitationContentProps) {
  const { title, sourceKind, pageNum, year, journal, authors, excerpt } = useCitationContext()

  const sourceLabel = sourceKind === 'overview' ? '知识库概要' : sourceKind === 'asset' ? '资产库全文' : '知识库精读'
  const metaParts = [
    year,
    journal,
    pageNum ? `第${pageNum}页` : '',
    authors?.length ? authors.slice(0, 2).join('、') + (authors.length > 2 ? ' 等' : '') : '',
  ].filter(Boolean)

  return (
    <HoverCardContent className={cn("w-80 p-0 shadow-xs", className)}>
      <div className="flex flex-col gap-2 p-3">
        <div className="line-clamp-2 text-sm font-medium">{title}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">{sourceLabel}</span>
          {metaParts.length > 0 && <span>{metaParts.join(' · ')}</span>}
        </div>
        {excerpt && (
          <div className="text-muted-foreground line-clamp-3 text-xs leading-relaxed border-t pt-2 mt-1">
            {excerpt}
          </div>
        )}
      </div>
    </HoverCardContent>
  )
}
