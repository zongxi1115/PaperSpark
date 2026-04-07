"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react"
import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"
import { Check, Loader2 } from "lucide-react"

/* -----------------------------------------------------------------------------
 * Types
 * -------------------------------------------------------------------------- */

export type StepStatus = "pending" | "in_progress" | "completed" | "error" | "waiting"

export interface Step {
  id: string
  label: string
  status: StepStatus
}

export interface AnimatedStepperProps extends ComponentProps<"div"> {
  steps: Step[]
  variant?: "horizontal" | "vertical"
  clickable?: boolean
  onStepClick?: (stepId: string) => void
  showProgressLine?: boolean
}

export interface AnimatedStepIndicatorProps {
  step: Step
  index: number
  isClickable: boolean
  onStepClick?: (stepId: string) => void
  className?: string
}

/* -----------------------------------------------------------------------------
 * Context
 * -------------------------------------------------------------------------- */

interface AnimatedStepperContextValue {
  steps: Step[]
  variant: "horizontal" | "vertical"
  currentStepIndex: number
  progressPercent: number
  reduceMotion: boolean | null
}

const AnimatedStepperContext = createContext<AnimatedStepperContextValue | null>(null)

function useAnimatedStepperContext() {
  const context = useContext(AnimatedStepperContext)
  if (!context) {
    throw new Error("AnimatedStepper components must be used within AnimatedStepper")
  }
  return context
}

/* -----------------------------------------------------------------------------
 * Step Indicator
 * -------------------------------------------------------------------------- */

function StepIndicator({
  step,
  index,
  isClickable,
  onStepClick,
  className,
}: AnimatedStepIndicatorProps) {
  const { currentStepIndex, reduceMotion } = useAnimatedStepperContext()
  
  const isCompleted = step.status === "completed"
  const isInProgress = step.status === "in_progress"
  const isError = step.status === "error"
  const isPending = step.status === "pending"
  const isWaiting = step.status === "waiting"

  const handleClick = useCallback(() => {
    if (isClickable && onStepClick) {
      onStepClick(step.id)
    }
  }, [isClickable, onStepClick, step.id])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      handleClick()
    }
  }, [handleClick])

  const indicatorContent = useMemo(() => {
    if (isCompleted) {
      return (
        <motion.div
          initial={reduceMotion ? false : { scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
        </motion.div>
      )
    }
    if (isInProgress) {
      return (
        <motion.div
          animate={!reduceMotion ? { rotate: 360 } : undefined}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <Loader2 className="h-3.5 w-3.5 text-blue-600" strokeWidth={2.5} />
        </motion.div>
      )
    }
    if (isWaiting) {
      return (
        <motion.div
          animate={!reduceMotion ? { scale: [1, 1.1, 1] } : undefined}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="text-xs font-semibold text-amber-500">⏳</span>
        </motion.div>
      )
    }
    if (isError) {
      return <span className="text-xs font-bold text-red-500">!</span>
    }
    return <span className="text-xs font-semibold text-gray-400">{index + 1}</span>
  }, [isCompleted, isInProgress, isWaiting, isError, index, reduceMotion])

  return (
    <motion.button
      type="button"
      role="tab"
      aria-selected={isInProgress}
      disabled={!isClickable}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300",
        isCompleted && "border-black bg-black",
        isInProgress && "border-blue-500 bg-blue-50",
        isWaiting && "border-amber-400 bg-amber-50",
        isError && "border-red-400 bg-red-50",
        (isPending) && "border-gray-200 bg-white",
        isClickable && "cursor-pointer hover:scale-105",
        !isClickable && "cursor-default",
        className
      )}
    >
      {indicatorContent}
      
      {/* Pulse animation for in-progress */}
      {isInProgress && !reduceMotion && (
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-blue-400"
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
    </motion.button>
  )
}

/* -----------------------------------------------------------------------------
 * Step Label
 * -------------------------------------------------------------------------- */

function StepLabel({ step, className }: { step: Step; className?: string }) {
  const isCompleted = step.status === "completed"
  const isInProgress = step.status === "in_progress"
  const isError = step.status === "error"

  return (
    <span
      className={cn(
        "text-sm font-medium transition-colors duration-300",
        isCompleted && "text-black",
        isInProgress && "text-blue-600",
        isError && "text-red-500",
        !isCompleted && !isInProgress && !isError && "text-gray-400",
        className
      )}
    >
      {step.label}
    </span>
  )
}

/* -----------------------------------------------------------------------------
 * Progress Line (Horizontal)
 * -------------------------------------------------------------------------- */

function HorizontalProgressLine({ steps }: { steps: Step[] }) {
  const { reduceMotion, progressPercent } = useAnimatedStepperContext()

  return (
    <div className="absolute left-0 right-0 top-4 -z-10 mx-4 h-0.5">
      {/* Background line */}
      <div className="absolute inset-0 bg-gray-200 rounded-full" />
      
      {/* Animated progress line */}
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-black via-blue-600 to-blue-500"
        initial={{ width: "0%" }}
        animate={{ width: `${progressPercent}%` }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
      />
    </div>
  )
}

/* -----------------------------------------------------------------------------
 * Progress Line (Vertical)
 * -------------------------------------------------------------------------- */

function VerticalProgressLine({ steps }: { steps: Step[] }) {
  const { reduceMotion, progressPercent } = useAnimatedStepperContext()

  return (
    <div className="absolute bottom-4 left-4 top-4 -z-10 w-0.5 -translate-x-1/2">
      {/* Background line */}
      <div className="absolute inset-0 bg-gray-200 rounded-full" />
      
      {/* Animated progress line */}
      <motion.div
        className="absolute inset-x-0 top-0 rounded-full bg-gradient-to-b from-black via-blue-600 to-blue-500"
        initial={{ height: "0%" }}
        animate={{ height: `${progressPercent}%` }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
      />
    </div>
  )
}

/* -----------------------------------------------------------------------------
 * Main Component
 * -------------------------------------------------------------------------- */

export function AnimatedStepper({
  steps,
  variant = "horizontal",
  clickable = false,
  onStepClick,
  showProgressLine = true,
  className,
  ...props
}: AnimatedStepperProps) {
  const reduceMotion = useReducedMotion()

  const currentStepIndex = useMemo(() => {
    const inProgressIndex = steps.findIndex(step => step.status === "in_progress")
    if (inProgressIndex >= 0) return inProgressIndex
    
    const lastCompletedIndex = steps.reduce((acc, step, idx) => 
      step.status === "completed" ? idx : acc, -1)
    return lastCompletedIndex + 1
  }, [steps])

  const progressPercent = useMemo(() => {
    const completedCount = steps.filter(step => step.status === "completed").length
    const hasInProgress = steps.some(step => step.status === "in_progress")
    
    if (steps.length <= 1) return completedCount === 1 ? 100 : 0
    
    const baseProgress = (completedCount / (steps.length - 1)) * 100
    const inProgressBonus = hasInProgress ? (0.5 / (steps.length - 1)) * 100 : 0
    
    return Math.min(baseProgress + inProgressBonus, 100)
  }, [steps])

  const contextValue = useMemo(
    () => ({
      steps,
      variant,
      currentStepIndex,
      progressPercent,
      reduceMotion,
    }),
    [steps, variant, currentStepIndex, progressPercent, reduceMotion]
  )

  if (variant === "vertical") {
    return (
      <AnimatedStepperContext.Provider value={contextValue}>
        <div
          role="group"
          aria-label="Progress steps"
          className={cn("relative flex flex-col gap-4", className)}
          {...props}
        >
          {showProgressLine && <VerticalProgressLine steps={steps} />}
          
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-3">
              <StepIndicator
                step={step}
                index={index}
                isClickable={clickable}
                onStepClick={onStepClick}
              />
              <StepLabel step={step} />
            </div>
          ))}
        </div>
      </AnimatedStepperContext.Provider>
    )
  }

  // Horizontal variant
  return (
    <AnimatedStepperContext.Provider value={contextValue}>
      <div
        role="group"
        aria-label="Progress steps"
        className={cn("relative", className)}
        {...props}
      >
        {showProgressLine && <HorizontalProgressLine steps={steps} />}
        
        <div className="flex items-start justify-between gap-2">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className="flex flex-1 flex-col items-center gap-2"
            >
              <StepIndicator
                step={step}
                index={index}
                isClickable={clickable}
                onStepClick={onStepClick}
              />
              <StepLabel step={step} className="text-center text-xs" />
            </div>
          ))}
        </div>
      </div>
    </AnimatedStepperContext.Provider>
  )
}

/* -----------------------------------------------------------------------------
 * Compact Horizontal Progress Strip (for sidebar headers)
 * -------------------------------------------------------------------------- */

export function CompactProgressStrip({
  steps,
  className,
}: {
  steps: Step[]
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Labels row */}
      <div className="flex items-center justify-between gap-1">
        {steps.map(step => {
          const isCompleted = step.status === "completed"
          const isInProgress = step.status === "in_progress"
          const isError = step.status === "error"
          
          return (
            <div
              key={step.id}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 text-[10px] font-semibold",
                isCompleted && "text-black",
                isInProgress && "text-blue-600",
                isError && "text-red-500",
                !isCompleted && !isInProgress && !isError && "text-gray-400"
              )}
            >
              {isCompleted ? (
                <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              ) : isInProgress ? (
                <motion.span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                  animate={!reduceMotion ? { opacity: [0.4, 1, 0.4] } : undefined}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                />
              ) : (
                <span className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  isError ? "bg-red-400" : "bg-gray-300"
                )} />
              )}
              <span className="truncate">{step.label}</span>
            </div>
          )
        })}
      </div>
      
      {/* Progress bar */}
      <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100">
        {steps.map((step, index) => {
          const isCompleted = step.status === "completed"
          const isInProgress = step.status === "in_progress"
          const isError = step.status === "error"
          
          return (
            <motion.div
              key={step.id}
              initial={false}
              animate={{
                backgroundColor: isCompleted
                  ? "#111827"
                  : isInProgress
                    ? "#2563eb"
                    : isError
                      ? "#ef4444"
                      : "transparent",
              }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.3 }}
              className={cn(
                "h-full flex-1",
                index < steps.length - 1 && "border-r border-white/60"
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

/* -----------------------------------------------------------------------------
 * Export hook
 * -------------------------------------------------------------------------- */

export function useAnimatedStepper() {
  return useAnimatedStepperContext()
}
