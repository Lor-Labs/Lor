"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"

export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (
      !element ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return
    // Keep server-rendered content visible; only reveal sections below the fold.
    if (element.getBoundingClientRect().top < window.innerHeight) return
    setHidden(true)
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setHidden(false)
          observer.disconnect()
        }
      },
      { threshold: 0.05 }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: hidden ? "0ms" : `${delay}ms` }}
      className={`transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transform-none motion-reduce:opacity-100 motion-reduce:transition-none ${hidden ? "translate-y-5 opacity-0" : "translate-y-0 opacity-100"} ${className}`}
    >
      {children}
    </div>
  )
}
