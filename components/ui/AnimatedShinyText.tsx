'use client'

import { type CSSProperties, type ReactNode } from 'react'

interface AnimatedShinyTextProps {
  children: ReactNode
  className?: string
  shimmerWidth?: number
  style?: CSSProperties
}

export function AnimatedShinyText({
  children,
  className = '',
  shimmerWidth = 100,
  style,
}: AnimatedShinyTextProps) {
  return (
    <span
      className={className}
      style={{
        ...style,
        display: 'inline-block',
        backgroundImage: `linear-gradient(
          120deg,
          var(--text-muted) 0%,
          var(--text-muted) 40%,
          var(--accent-color) 50%,
          var(--text-muted) 60%,
          var(--text-muted) 100%
        )`,
        backgroundSize: `${shimmerWidth}% 100%`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        animation: 'shimmer 2.4s ease-in-out infinite',
      }}
    >
      {children}
      <style jsx global>{`
        @keyframes shimmer {
          0% {
            background-position: 100% 50%;
          }
          100% {
            background-position: -100% 50%;
          }
        }
      `}</style>
    </span>
  )
}
