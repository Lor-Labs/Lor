import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"

type TypingUser = {
  userId: string
  name: string
}

const DOT_DELAYS = [0, 200, 400]

function formatTypingText(users: TypingUser[]): string {
  const first = users[0]
  const second = users[1]
  if (!first) return ""
  if (users.length === 1) return `${first.name} is typing`
  if (users.length === 2 && second)
    return `${first.name} and ${second.name} are typing`
  return `${first.name} and ${users.length - 1} others are typing`
}

// Zero-height overlay above the composer: showing or hiding the typing
// indicator never resizes the transcript. `className` sets the fade surface.
export function TypingIndicator({
  users,
  className,
}: {
  users: TypingUser[]
  className?: string
}) {
  return (
    <div className="relative h-0">
      <AnimatePresence>
        {users.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 flex h-6 items-center gap-1.5 bg-linear-to-t from-60% from-background to-transparent px-4 text-xs text-muted-foreground",
              className
            )}
          >
            <span>{formatTypingText(users)}</span>
            <span className="inline-flex gap-0.5">
              {DOT_DELAYS.map((delay) => (
                <span
                  key={delay}
                  className="motion-safe:animate-pulse"
                  style={{ animationDelay: `${delay}ms` }}
                >
                  .
                </span>
              ))}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
