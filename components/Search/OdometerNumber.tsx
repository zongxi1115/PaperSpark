'use client'

import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect } from 'react'

interface OdometerNumberProps {
  value: number | string
  className?: string
}

function toNumber(value: number | string) {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export function OdometerNumber({ value, className }: OdometerNumberProps) {
  const motionValue = useMotionValue(toNumber(value))
  const rounded = useTransform(() => Math.round(motionValue.get()))

  useEffect(() => {
    const controls = animate(motionValue, toNumber(value), {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
    })

    return () => controls.stop()
  }, [motionValue, value])

  return (
    <motion.span className={className}>
      {rounded}
    </motion.span>
  )
}
