import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { AnimatePresence, motion } from "motion/react"
import type { ReactNode, RefObject } from "react"

// Where the composer's message goes: channel chat and human threads start a
// session on @Lor; inside a session a message goes to Lor or to people; the
// New session view always starts one.
export type ComposerDestination = "channel" | "thread" | "session" | "new"

export type PingedPerson = { id: string; name: string; image: string | null }

export type SubscriberFace = PingedPerson & { avatarColor: string | null }

const MAX_SUBSCRIBER_FACES = 3

// The bar swaps between the Lor and people states in the toolbar row under
// the editor, so the text field never moves while someone types "@Lor".
const swap = {
  initial: { opacity: 0, y: 4, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -4, filter: "blur(2px)" },
  transition: { duration: 0.16, ease: EASE_OUT },
}

export function DestinationBar({
  destination,
  channelName,
  toLor,
  pinged,
  subscribers = [],
  onSwitch,
  leadingTools,
  lorPillRef,
}: {
  destination: ComposerDestination
  channelName: string
  toLor: boolean
  pinged: PingedPerson[]
  // Session only: who a message to people reaches, without you.
  subscribers?: SubscriberFace[]
  // Session only, when nothing in the message decides the destination.
  onSwitch?: () => void
  // New session only: its controls after the attach button (Claude Code's
  // mode). Its channel is in the page's headline, so it has no pill.
  leadingTools?: ReactNode
  // Anchors the session_reply hint on the Lor pill. Only the Lor state takes
  // it: the people state's exit would clear the ref after the swap.
  lorPillRef?: RefObject<HTMLSpanElement | null>
}) {
  const lorLabel =
    destination === "session"
      ? "To Lor"
      : destination === "thread"
        ? "New session from this thread"
        : `New session in #${channelName}`
  const isSession = destination === "session"
  // A session message reaches its subscribers, and the people it mentions
  // follow once it sends: mentioned first, so "+N" never hides them.
  const reached: SubscriberFace[] = [
    ...pinged.map(
      (person) =>
        subscribers.find((subscriber) => subscriber.id === person.id) ?? {
          ...person,
          avatarColor: null,
        }
    ),
    ...subscribers.filter(
      (subscriber) => !pinged.some((person) => person.id === subscriber.id)
    ),
  ]

  return (
    <div className="relative flex min-w-0 items-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {toLor ? (
          <motion.div
            key="lor"
            {...swap}
            className="flex min-w-0 items-center gap-1.5 text-xs"
          >
            {/* Quiet in a session, where Lor is the default; chat and threads
                tint it, since there it changes what the send does. */}
            {destination !== "new" && (
              <span ref={lorPillRef} className="flex shrink-0">
                <DestinationPill
                  onSwitch={onSwitch}
                  className={
                    isSession
                      ? "text-muted-foreground hover:text-foreground"
                      : "bg-agent/10 font-medium text-agent"
                  }
                >
                  <img src="/lor-mark.svg" alt="" className="size-3.5" />
                  {lorLabel}
                </DestinationPill>
              </span>
            )}
            {leadingTools}
            {pinged.length > 0 && (
              <PingedPeople
                people={pinged}
                label={isSession ? "Notifies" : "Adds"}
              />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="people"
            {...swap}
            className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            {/* Chat and threads already name the destination in the
                placeholder; only a session needs a pill to switch. */}
            {isSession && (
              <DestinationPill onSwitch={onSwitch}>
                {reached.length > 0 ? (
                  <>
                    To
                    <Faces people={reached.slice(0, MAX_SUBSCRIBER_FACES)} />
                    {reached.length > MAX_SUBSCRIBER_FACES &&
                      `+${reached.length - MAX_SUBSCRIBER_FACES}`}
                    <span className="sr-only">
                      {reached.map((person) => person.name).join(", ")}
                    </span>
                  </>
                ) : (
                  "To subscribers"
                )}
              </DestinationPill>
            )}
            {!isSession && pinged.length > 0 && (
              <PingedPeople people={pinged} label="Notifies" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DestinationPill({
  onSwitch,
  className,
  children,
}: {
  onSwitch?: () => void
  className?: string
  children: ReactNode
}) {
  const base = "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1"
  if (!onSwitch) {
    return <span className={cn(base, className)}>{children}</span>
  }
  return (
    <button
      type="button"
      // Switching mid-draft keeps the caret in the input line.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSwitch}
      title="Switch who this message goes to"
      className={cn(
        base,
        "cursor-pointer transition-opacity hover:opacity-80",
        className
      )}
    >
      {children}
    </button>
  )
}

function PingedPeople({
  people,
  label,
}: {
  people: PingedPerson[]
  label: string
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
      <Faces people={people} />
      <span className="truncate">
        {label} {people.map((person) => person.name.split(" ")[0]).join(", ")}
      </span>
    </span>
  )
}

// Names are always in text beside the faces, so the images stay unlabeled.
function Faces({
  people,
}: {
  people: (PingedPerson & { avatarColor?: string | null })[]
}) {
  return (
    <span className="flex shrink-0 -space-x-1">
      {people.map((person) => (
        <Avatar key={person.id} className="size-4 ring-2 ring-background">
          {person.image && <AvatarImage src={person.image} alt="" />}
          <AvatarFallback
            avatarColor={person.avatarColor}
            fallbackSeed={person.name}
            className="text-[8px]"
          >
            {getAvatarInitials(person.name)}
          </AvatarFallback>
        </Avatar>
      ))}
    </span>
  )
}
