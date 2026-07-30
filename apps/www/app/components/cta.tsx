import { ArrowRight } from "lucide-react"
import type { ReactNode } from "react"

const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]"

export function CtaPrimary({
  href,
  children,
  className = "",
}: {
  href: string
  children: ReactNode
  className?: string
}) {
  return (
    <a
      href={href}
      className={`group inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-merlin to-primary py-3 pl-6 pr-5 font-medium text-[15px] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.3),0_4px_10px_-2px_rgba(97,60,214,0.4),0_10px_24px_-6px_rgba(97,60,214,0.3)] transition-all duration-300 ${EASE} hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_1px_3px_rgba(0,0,0,0.32),0_6px_14px_-2px_rgba(97,60,214,0.5),0_14px_30px_-6px_rgba(97,60,214,0.38)] active:translate-y-0 active:scale-[0.98] ${className}`}
    >
      {children}
      <ArrowRight
        className={`size-4 transition-transform duration-300 ${EASE} group-hover:translate-x-0.5`}
        strokeWidth={1.75}
      />
    </a>
  )
}

export function CtaSecondary({
  href,
  children,
  external = false,
  className = "",
}: {
  href: string
  children: ReactNode
  external?: boolean
  className?: string
}) {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`inline-flex items-center gap-2 rounded-full border border-foreground/[0.12] bg-foreground/[0.03] py-3 px-6 font-medium text-[15px] text-foreground/85 transition-all duration-300 ${EASE} hover:bg-foreground/[0.07] hover:text-foreground active:scale-[0.98] ${className}`}
    >
      {children}
    </a>
  )
}
