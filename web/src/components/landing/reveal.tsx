'use client'

import { useEffect, useRef, useState } from 'react'

// Scroll reveal, done once and used everywhere.
//
// One IntersectionObserver per element, disconnected the moment it fires — a
// reveal that keeps observing after it has revealed is a scroll listener with
// extra steps. Elements start visible and are only hidden once JS confirms it
// can animate them, so the page is never blank for someone with JS disabled or
// still loading.
//
// `prefers-reduced-motion` is honoured by skipping the hidden state entirely
// rather than by shortening the transition: someone who asked for no motion
// wants no motion, not fast motion.

export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: React.ReactNode
  /** stagger, in ms, for siblings revealed together */
  delay?: number
  as?: 'div' | 'section' | 'li' | 'article'
  className?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (!('IntersectionObserver' in window)) return

    setShown(false)
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setShown(true)
        io.disconnect()
      },
      // Fire a little before the element reaches the viewport, so the motion
      // has finished by the time it is properly in view.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <Tag
      ref={ref as never}
      className={`l-reveal${shown ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}
