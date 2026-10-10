import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { AnimatePresence, motion } from "motion/react"

type TypingUser = {
  userId: string
  name: string
}

export type TypingPerson = TypingUser & {
  image: string | null
  avatarColor: string | null
}

const MAX_TYPING_AVATARS = 3

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

// Session typing row: the typers' avatars on the avatar column and dots where
// their text will go, in the slot above the reply line. It has no height and
// the slot is always there, so it never moves the reply line or the caret.
export function DocumentTypingIndicator({
  people,
}: {
  people: TypingPerson[]
}) {
  return (
    <div className="relative h-0">
      <AnimatePresence>
        {people.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-5 items-center px-4"
          >
            <span className="sr-only">{formatTypingText(people)}</span>
            <div className="flex w-7 shrink-0 justify-center -space-x-1.5">
              <AnimatePresence initial={false} mode="popLayout">
                {people.slice(0, MAX_TYPING_AVATARS).map((person) => (
                  <motion.span
                    key={person.userId}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.18, ease: EASE_OUT }}
                  >
                    <Avatar className="size-5 ring-2 ring-background">
                      {person.image && (
                        <AvatarImage src={person.image} alt="" />
                      )}
                      <AvatarFallback
                        avatarColor={person.avatarColor}
                        fallbackSeed={person.name}
                        className="font-semibold text-[8px]"
                      >
                        {getAvatarInitials(person.name)}
                      </AvatarFallback>
                    </Avatar>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            <span className="ml-3 flex items-center gap-[3px]">
              {DOT_DELAYS.map((delay) => (
                <motion.span
                  key={delay}
                  animate={{ opacity: [0.35, 1, 0.35], y: [0, -2, 0] }}
                  transition={{
                    duration: 1,
                    delay: delay / 1000,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }}
                  className="size-1 rounded-full bg-muted-foreground"
                />
              ))}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
