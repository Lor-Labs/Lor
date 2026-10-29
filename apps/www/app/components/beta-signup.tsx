import { ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { SIGNUP_URL } from "@/app/lib/urls"

const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]"

// Beta signup happens in the app, which also shows its own waitlist once
// enrollment closes.
export function BetaSignup({ className = "" }: { className?: string }) {
  return (
    <a
      href={SIGNUP_URL}
      className={`group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-agent to-primary pr-5 pl-6 font-medium text-[15px] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.3),0_4px_10px_-2px_rgba(97,60,214,0.4),0_10px_24px_-6px_rgba(97,60,214,0.3)] transition-all duration-300 ${EASE} hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent ${className}`}
    >
      Join the free beta
      <HugeiconsIcon
        icon={ArrowRight02Icon}
        size={16}
        strokeWidth={1.75}
        className={`transition-transform duration-300 ${EASE} group-hover:translate-x-0.5`}
      />
    </a>
  )
}
