import {
  ArrowDown01Icon,
  HashtagIcon,
  PlusSignIcon,
  SentIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "motion/react"
import { type KeyboardEvent, useState } from "react"
import { mentionedPeople, type Person } from "./prototype-data"

// The composer's chrome swaps between the people and Lor states; the text
// field never moves, so typing "@Lor" mid-sentence doesn't jolt the caret.
const swap = {
  initial: { opacity: 0, y: 4, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -4, filter: "blur(2px)" },
  transition: { duration: 0.16, ease: EASE_OUT },
}

export function PrototypeComposer({
  channelName,
  onSend,
}: {
  channelName: string
  onSend: (text: string, toLor: boolean) => void
}) {
  const [text, setText] = useState("")
  const toLor = /@lor\b/i.test(text)
  const pinged = mentionedPeople(text)
  const canSend = text.trim().length > 0

  const send = () => {
    if (!canSend) return
    onSend(text.trim(), toLor)
    setText("")
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  const sendTone = toLor
    ? "bg-agent/12 text-agent hover:bg-agent/18 hover:text-agent"
    : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"

  return (
    <div
      className={cn(
        "rounded-lg border bg-background transition-colors duration-150 dark:bg-muted/40",
        toLor
          ? "border-agent/50"
          : "border-input focus-within:border-muted-foreground/40"
      )}
    >
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        placeholder={`Message #${channelName}, or @Lor to start a session`}
        className="field-sizing-content block max-h-48 min-h-11 w-full resize-none bg-transparent px-3 pt-3 pb-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex h-10 items-center gap-1 px-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Attach"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon
            icon={PlusSignIcon}
            className="size-4"
            strokeWidth={2}
          />
        </Button>
        <div className="relative flex min-w-0 flex-1 items-center">
          <AnimatePresence mode="popLayout" initial={false}>
            {toLor ? (
              <motion.div
                key="lor"
                {...swap}
                className="flex min-w-0 items-center gap-1.5 text-xs"
              >
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-agent/10 px-2 py-1 font-medium text-agent">
                  <img src="/lor-mark.svg" alt="" className="size-3.5" />
                  New session in #{channelName}
                </span>
                <button
                  type="button"
                  className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  Kimi K3
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    className="size-3"
                    strokeWidth={2}
                  />
                </button>
                {pinged.length > 0 && (
                  <PingedPeople people={pinged} label="Adds" />
                )}
              </motion.div>
            ) : (
              <motion.div
                key="people"
                {...swap}
                className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span className="inline-flex shrink-0 items-center gap-1 px-1">
                  <HugeiconsIcon
                    icon={HashtagIcon}
                    className="size-3.5"
                    strokeWidth={2}
                  />
                  {channelName}
                </span>
                {pinged.length > 0 && (
                  <PingedPeople people={pinged} label="Notifies" />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={send}
          disabled={!canSend}
          aria-label={toLor ? "Start session" : "Send message"}
          className={cn(
            "size-7 shrink-0 transition-colors",
            canSend ? sendTone : "text-muted-foreground"
          )}
        >
          <HugeiconsIcon icon={SentIcon} size={16} />
        </Button>
      </div>
    </div>
  )
}

function PingedPeople({ people, label }: { people: Person[]; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
      <span className="flex shrink-0 -space-x-1">
        {people.map((person) => (
          <Avatar key={person.id} className="size-4 ring-2 ring-background">
            <AvatarImage src={person.image} alt={person.name} />
            <AvatarFallback fallbackSeed={person.name} className="text-[8px]">
              {person.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
        ))}
      </span>
      <span className="truncate">
        {label} {people.map((person) => person.name.split(" ")[0]).join(", ")}
      </span>
    </span>
  )
}
