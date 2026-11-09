import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { UserAvatar } from "@/components/ui/user-avatar"

type TypingUser = {
  userId: string
  name: string
}

export type TypingPerson = TypingUser & {
  image: string | null
  avatarColor: string | null
}

const MAX_TYPING_FACES = 3

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

const SLOT_MOTION = { duration: 0.18, ease: EASE_OUT }

// Session typing line, shaped like the reply line under it: the first typer's
// avatar in the gutter, dots where their text will go, then the other typers'
// faces. With `reserve` (someone else can type here) its one-line slot is
// always there, so the sticky composer keeps its height as people start and
// stop typing; only opacity and transform animate.
export function DocumentTypingIndicator({
  people,
  reserve,
}: {
  people: TypingPerson[]
  reserve: boolean
}) {
  const [first, ...others] = people
  if (!reserve && !first) return null
  return (
    <div className="h-10 px-4 pb-2">
      {first && <span className="sr-only">{formatTypingText(people)}</span>}
      <AnimatePresence initial={false}>
        {first && (
          <motion.div
            key="typing"
            aria-hidden
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={SLOT_MOTION}
            className="relative flex h-8 items-center gap-2 py-1 pl-10"
          >
            <AnimatePresence initial={false}>
              <motion.div
                key={first.userId}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={SLOT_MOTION}
                className="absolute top-0.5 left-0"
              >
                <UserAvatar
                  name={first.name}
                  src={first.image}
                  avatarColor={first.avatarColor}
                  size="sm"
                  className="size-7"
                />
              </motion.div>
            </AnimatePresence>
            <span className="flex h-6 items-center gap-1">
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
                  className="size-1.5 rounded-full bg-muted-foreground"
                />
              ))}
            </span>
            <span className="flex -space-x-1.5">
              <AnimatePresence initial={false}>
                {others.slice(0, MAX_TYPING_FACES - 1).map((person) => (
                  <motion.span
                    key={person.userId}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={SLOT_MOTION}
                  >
                    <UserAvatar
                      name={person.name}
                      src={person.image}
                      avatarColor={person.avatarColor}
                      size="sm"
                      className="size-5 ring-2 ring-background"
                    />
                  </motion.span>
                ))}
              </AnimatePresence>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
