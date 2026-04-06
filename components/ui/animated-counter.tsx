"use client"

import { useEffect, useRef } from "react"
import { motion, animate, useMotionValue, useTransform, useInView } from "framer-motion"
import { cn } from "@/lib/utils"

interface AnimatedCounterProps {
  /** Target number to animate to */
  value?: number
  /** Animation duration in seconds */
  duration?: number
  /** Initial delay before counting */
  delay?: number
  /** Text before the number */
  prefix?: string
  /** Text after the number */
  suffix?: string
  /** Show thousand separators */
  separator?: boolean
  /** Additional CSS classes */
  className?: string
}

function RollingDigit({
  targetDigit,
  duration,
  delay,
}: {
  targetDigit: number
  duration: number
  delay: number
}) {
  const motionVal = useMotionValue(0)
  const y = useTransform(motionVal, latest => {
    return `${-latest * 10}%`
  })

  useEffect(() => {
    const controls = animate(motionVal, targetDigit, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
    })
    return controls.stop
  }, [targetDigit, duration, delay, motionVal])

  return (
    <span className="relative inline-flex h-[1em] overflow-hidden" style={{ width: "0.6em" }}>
      <motion.span
        className="absolute left-0 right-0 flex flex-col items-center"
        style={{ y }}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
          <span
            key={n}
            className="flex h-[1em] items-center justify-center leading-none"
          >
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  )
}

export function AnimatedCounter({
  value = 1234,
  duration = 2,
  delay = 0,
  prefix = "",
  suffix = "",
  separator = true,
  className,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true, margin: "-10%" })

  const absValue = Math.floor(Math.abs(value))
  const digitChars = String(absValue).split("")

  const displayElements: Array<{ type: "digit"; digit: number; index: number } | { type: "sep" }> = []
  const totalDigits = digitChars.length

  digitChars.forEach((ch, i) => {
    displayElements.push({ type: "digit", digit: Number(ch), index: i })
    const fromRight = totalDigits - 1 - i
    if (separator && fromRight > 0 && fromRight % 3 === 0) {
      displayElements.push({ type: "sep" })
    }
  })

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex items-center font-bold tabular-nums",
        className
      )}
    >
      {prefix && <span className="mr-[0.05em]">{prefix}</span>}
      {value < 0 && <span>−</span>}
      {displayElements.map((el, i) => {
        if (el.type === "sep") {
          return (
            <span key={`s${i}`} className="inline-block w-[0.3em] text-center">
              ,
            </span>
          )
        }
        return (
          <RollingDigit
            key={`d${el.index}`}
            targetDigit={isInView ? el.digit : 0}
            duration={duration}
            delay={delay + el.index * 0.1}
          />
        )
      })}
      {suffix && <span className="ml-[0.05em]">{suffix}</span>}
    </span>
  )
}
