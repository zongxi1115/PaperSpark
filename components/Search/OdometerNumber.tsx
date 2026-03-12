'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface OdometerNumberProps {
  value: number | string
  className?: string
}

function DigitColumn({ digit, prevDigit }: { digit: string; prevDigit: string }) {
  const digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
  const currentIndex = digits.indexOf(digit)
  const prevIndex = digits.indexOf(prevDigit)
  const hasChanged = digit !== prevDigit

  return (
    <div
      style={{
        position: 'relative',
        width: '0.6em',
        height: '1.2em',
        overflow: 'hidden',
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {hasChanged ? (
          <motion.span
            key={digit}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }}
            transition={{
              type: 'spring',
              stiffness: 280,
              damping: 28,
              duration: 0.18,
            }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {digit}
          </motion.span>
        ) : (
          <motion.span
            key={`static-${digit}`}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {digit}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

export function OdometerNumber({ value, className }: OdometerNumberProps) {
  const [prevValue, setPrevValue] = useState<string>(String(value))
  const currentStr = String(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setPrevValue(String(value))
    }, 200)
    return () => clearTimeout(timer)
  }, [value])

  const paddedCurrent = currentStr.padStart(prevValue.length, '0')
  const paddedPrev = prevValue.padStart(currentStr.length, '0')
  const maxLen = Math.max(paddedCurrent.length, paddedPrev.length)

  const digits = useMemo(() => {
    const current = paddedCurrent.padStart(maxLen, '0')
    const prev = paddedPrev.padStart(maxLen, '0')
    return current.split('').map((digit, i) => ({
      digit,
      prevDigit: prev[i] || digit,
      key: `${i}-${digit}`,
    }))
  }, [paddedCurrent, paddedPrev, maxLen])

  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center' }}>
      {digits.map((item, i) => (
        <DigitColumn key={item.key} digit={item.digit} prevDigit={item.prevDigit} />
      ))}
    </span>
  )
}
