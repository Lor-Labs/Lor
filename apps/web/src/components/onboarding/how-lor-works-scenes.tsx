import {
  HashtagIcon,
  ThumbsUpIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { SidebarSessionState } from "@repo/realtime-types"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Spinner } from "@repo/ui/components/spinner"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import {
  AVATAR_COLOR_STYLES,
  getAvatarInitials,
} from "@repo/utils/avatar-colors"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { type ReactNode, useEffect, useState } from "react"
import { DestinationBar } from "@/components/chat/composer/destination-bar"
import { SessionStateIndicator } from "@/components/sidebar/channel-panel/channel-activity"
import { TypewriterText } from "@/components/ui/typewriter-text"

// Small animated mockups of the app for the How Lor works dialog. Each scene
// plays once when its step opens and holds its last frame.

export type ScenePerson = { name: string; image: string | null }
export type SceneProps = { workspaceName: string; you: ScenePerson }

const MAYA: ScenePerson = { name: "Maya Okafor", image: null }
const TOMAS: ScenePerson = { name: "Tomás Reyes", image: null }
const SESSION_TITLE = "Last night's deploy failure"
const QUESTION = " why did last night's deploy fail?"
// Names Maya's message from the chat, so the answer shows Lor read it.
const LOR_ANSWER =
  "A migration timed out on the invoices table. Maya's billing fix adds the missing index."

const appear = {
  initial: { opacity: 0, y: 6, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, transition: { duration: 0.12 } },
  transition: { duration: 0.25, ease: EASE_OUT },
}

// Opening a session: the main pane cross-fades from the chat to it.
const paneSwap = {
  initial: { opacity: 0, filter: "blur(2px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  exit: { opacity: 0, filter: "blur(2px)" },
  transition: { duration: 0.3, ease: EASE_OUT },
}

// Phase n begins at times[n - 1] ms. Reduced motion shows the last frame.
function usePhase(times: readonly number[]) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState(() => (reduce ? times.length : 0))
  useEffect(() => {
    if (reduce) {
      setPhase(times.length)
      return
    }
    const timers = times.map((ms, index) =>
      setTimeout(() => setPhase(index + 1), ms)
    )
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [times, reduce])
  return phase
}

function MiniWindow({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-x-10 top-10 -bottom-px flex overflow-hidden rounded-t-xl border border-b-0 bg-background text-[13px] shadow-lg/5">
      {children}
    </div>
  )
}

function MiniChannelRow({ name, active }: { name: string; active?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1",
        active
          ? "bg-foreground/[0.06] font-medium text-foreground"
          : "text-muted-foreground"
      )}
    >
      <HugeiconsIcon icon={HashtagIcon} className="size-3.5" strokeWidth={2} />
      {name}
    </div>
  )
}

function MiniSessionRow({
  title,
  state,
  active,
}: {
  title: string
  state: SidebarSessionState
  active?: boolean
}) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="overflow-hidden"
    >
      <div
        className={cn(
          "ml-5 flex items-center gap-2 rounded-md px-2 py-1 text-[12px]",
          active
            ? "bg-foreground/[0.06] font-medium text-foreground"
            : "text-muted-foreground"
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <TypewriterText text={title} animate />
        </span>
        <SessionStateIndicator state={state} />
      </div>
    </motion.div>
  )
}

function MiniSidebar({
  workspaceName,
  sessions,
  channelActive = true,
}: {
  workspaceName: string
  sessions?: ReactNode
  // False while a session is open, so its row holds the highlight.
  channelActive?: boolean
}) {
  return (
    <div className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2">
      <div className="mb-1.5 flex items-center gap-2 px-1.5 py-1 font-medium">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-foreground text-[10px] font-semibold text-background">
          {getAvatarInitials(workspaceName).slice(0, 1)}
        </span>
        <span className="truncate">{workspaceName}</span>
      </div>
      <MiniChannelRow name="general" />
      <MiniChannelRow name="engineering" active={channelActive} />
      {sessions}
      <MiniChannelRow name="product" />
      <MiniChannelRow name="design" />
    </div>
  )
}

function PersonAvatar({ person }: { person: ScenePerson }) {
  return (
    <Avatar className="size-6 shrink-0 ring-2 ring-background">
      {person.image && <AvatarImage src={person.image} alt="" />}
      <AvatarFallback fallbackSeed={person.name} className="text-[9px]">
        {getAvatarInitials(person.name)}
      </AvatarFallback>
    </Avatar>
  )
}

function MiniMessage({
  person,
  muted,
  children,
}: {
  person: ScenePerson
  muted?: boolean
  children: ReactNode
}) {
  return (
    <motion.div {...appear} className="flex gap-2.5">
      <PersonAvatar person={person} />
      <div className="min-w-0">
        <div className="text-[12px] font-semibold">{person.name}</div>
        <div className={muted ? "text-muted-foreground" : "text-foreground/90"}>
          {children}
        </div>
      </div>
    </motion.div>
  )
}

function MiniComposer({
  toLor,
  children,
  bar,
  notice,
}: {
  toLor: boolean
  children?: ReactNode
  bar?: ReactNode
  // Sits above the composer, like the real "Started …" note.
  notice?: ReactNode
}) {
  return (
    <div
      className={cn(
        "relative mx-3 mb-3 rounded-lg border px-3 py-2 transition-colors duration-200",
        toLor ? "border-agent/50" : "border-input"
      )}
    >
      {notice}
      <div className="min-h-5 text-foreground/90">{children}</div>
      {bar && <div className="mt-1.5">{bar}</div>}
    </div>
  )
}

// A pointer that glides in from below-right so its tip lands on the center
// of its parent, then presses with a small ripple.
function MiniCursor({ clicking }: { clicking: boolean }) {
  return (
    <motion.span
      aria-hidden="true"
      initial={{ x: 72, y: 44, opacity: 0 }}
      animate={{ x: 0, y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: EASE_OUT }}
      className="pointer-events-none absolute top-1/2 left-1/2 z-20"
    >
      {clicking && (
        <motion.span
          initial={{ scale: 0.3, opacity: 0.5 }}
          animate={{ scale: 1.8, opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className="absolute -top-2 -left-2 size-4 rounded-full bg-foreground/40"
        />
      )}
      <motion.svg
        aria-hidden="true"
        animate={{ scale: clicking ? 0.82 : 1 }}
        transition={{ duration: 0.12, ease: EASE_OUT }}
        width="16"
        height="20"
        viewBox="0 0 16 20"
        className="block origin-top-left drop-shadow-sm"
      >
        <path
          d="M1 1V15.5L4.8 11.9L7.4 18L9.9 16.9L7.4 10.9H12.6L1 1Z"
          className="fill-foreground stroke-background"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </motion.svg>
    </motion.span>
  )
}

function LorChip() {
  return (
    <span className="rounded bg-primary/15 px-1 py-0.5 font-medium text-primary">
      @Lor
    </span>
  )
}

type CursorColors = { background: string; foreground: string }

// People take avatar palette colors; Lor takes the agent color.
const COLOR_ROSE: CursorColors = {
  background: AVATAR_COLOR_STYLES.rose.backgroundColor,
  foreground: AVATAR_COLOR_STYLES.rose.foregroundColor,
}
const COLOR_EMERALD: CursorColors = {
  background: AVATAR_COLOR_STYLES.emerald.backgroundColor,
  foreground: AVATAR_COLOR_STYLES.emerald.foregroundColor,
}
const COLOR_BLUE: CursorColors = {
  background: AVATAR_COLOR_STYLES.blue.backgroundColor,
  foreground: AVATAR_COLOR_STYLES.blue.foregroundColor,
}
const LOR_CURSOR: CursorColors = {
  background: "var(--agent)",
  foreground: "var(--agent-foreground)",
}

// A named cursor whose tip glides to `at` (px from the doc's top-left).
function SceneCursor({
  name,
  colors,
  at,
}: {
  name: string
  colors: CursorColors
  at: readonly [number, number]
}) {
  return (
    <motion.div
      aria-hidden="true"
      initial={false}
      animate={{ x: at[0], y: at[1] }}
      transition={{ duration: 0.8, ease: EASE_OUT }}
      className="pointer-events-none absolute top-0 left-0 z-10"
    >
      <svg
        aria-hidden="true"
        width="16"
        height="20"
        viewBox="0 0 16 20"
        className="block drop-shadow-sm"
      >
        <path
          d="M1 1V15.5L4.8 11.9L7.4 18L9.9 16.9L7.4 10.9H12.6L1 1Z"
          style={{ fill: colors.background }}
          className="stroke-background"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span
        style={{ backgroundColor: colors.background, color: colors.foreground }}
        className="absolute top-4 left-3 whitespace-nowrap rounded-full px-1.5 py-0.5 font-medium text-[10px]"
      >
        {name}
      </span>
    </motion.div>
  )
}

const WELCOME_ASK = " draft the launch post for Thursday"
const WELCOME_DRAFT =
  "Here's a draft for #announcements: shared sessions ship Thursday, for every team."
const WELCOME_TIMES = [300, 900, 2300, 2700, 4000, 4500, 5300] as const

// The tour's first step: a team working with Lor in one session. Maya asks,
// Lor drafts while its cursor writes, Tomás reacts, you approve the post.
// Lor has no live cursors yet; this shows the idea. Rows have fixed heights
// so each cursor's tip (px from the card's top-left, per phase) lands on its
// target.
export function WelcomeScene({ you }: SceneProps) {
  const phase = usePhase(WELCOME_TIMES)
  const asking = phase >= 1 && phase < 3
  const maya: readonly [number, number] =
    phase >= 3 ? [380, 70] : phase >= 1 ? [28, 222] : [-170, 230]
  const lor: readonly [number, number] =
    phase >= 7
      ? [390, 150]
      : phase >= 4
        ? [330, 112]
        : phase >= 3
          ? [40, 92]
          : [520, 20]
  const tomas: readonly [number, number] =
    phase >= 7 ? [-60, 120] : phase >= 5 ? [52, 138] : [-170, 60]
  const yours: readonly [number, number] = phase >= 5 ? [317, 170] : [240, 330]
  return (
    <div className="absolute top-1/2 left-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2">
      <div className="relative rounded-xl border bg-background p-3 text-[12px] shadow-lg/5">
        <div className="flex h-8 items-center gap-2 border-b pb-1">
          <span className="min-w-0 flex-1 truncate font-semibold text-[13px]">
            Launch post
          </span>
          <div className="flex -space-x-1.5">
            <PersonAvatar person={MAYA} />
            <PersonAvatar person={TOMAS} />
            <PersonAvatar person={you} />
          </div>
        </div>
        <div className="mt-2 h-[148px] space-y-1">
          <div className="h-7">
            {phase >= 3 && (
              <motion.div {...appear} className="flex items-center gap-2">
                <PersonAvatar person={MAYA} />
                <span className="text-foreground/90">
                  <LorChip />
                  {WELCOME_ASK}
                </span>
              </motion.div>
            )}
          </div>
          <div className="flex h-10 gap-2">
            {phase >= 3 && (
              <>
                <img src="/lor-mark.svg" alt="" className="mt-0.5 size-5" />
                <p className="text-foreground/90">
                  <TypewriterText
                    text={phase >= 4 ? WELCOME_DRAFT : ""}
                    animate
                  />
                </p>
              </>
            )}
          </div>
          <div className="h-5 pl-7">
            {phase >= 6 && (
              <motion.span
                {...appear}
                className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] text-muted-foreground"
              >
                <HugeiconsIcon
                  icon={ThumbsUpIcon}
                  className="size-3"
                  strokeWidth={2}
                />
                1
              </motion.span>
            )}
          </div>
          <div className="h-9">
            {phase >= 5 && (
              <motion.div
                {...appear}
                className="flex h-full items-center gap-2 rounded-lg border pr-1 pl-2.5"
              >
                {phase >= 7 ? (
                  <span className="flex flex-1 items-center gap-1.5 text-muted-foreground">
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      className="size-3.5"
                      strokeWidth={2}
                    />
                    Approved by you
                  </span>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">
                      Post to #announcements?
                    </span>
                    <span className="rounded-md px-2 py-1 text-[11px] text-muted-foreground">
                      Reject
                    </span>
                    <span className="rounded-md bg-foreground px-2 py-1 font-medium text-[11px] text-background">
                      Approve
                    </span>
                  </>
                )}
              </motion.div>
            )}
          </div>
        </div>
        <div className="mt-2 flex h-8 items-center rounded-lg border px-3">
          {asking ? (
            <span className="text-foreground/90">
              <LorChip />
              <TypewriterText text={phase >= 2 ? WELCOME_ASK : ""} animate />
            </span>
          ) : (
            <span className="text-muted-foreground">Reply…</span>
          )}
        </div>
        <SceneCursor name="Maya" colors={COLOR_ROSE} at={maya} />
        <SceneCursor name="Lor" colors={LOR_CURSOR} at={lor} />
        <SceneCursor name="Tomás" colors={COLOR_EMERALD} at={tomas} />
        <SceneCursor
          name={you.name.split(" ")[0] ?? "You"}
          colors={COLOR_BLUE}
          at={yours}
        />
      </div>
    </div>
  )
}

const CHAT_TIMES = [250, 1000, 1750] as const

export function ChatScene({ workspaceName, you }: SceneProps) {
  const phase = usePhase(CHAT_TIMES)
  return (
    <MiniWindow>
      <MiniSidebar workspaceName={workspaceName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="border-b px-3 py-2 font-semibold"># engineering</div>
        <div className="flex flex-1 flex-col justify-end gap-3 px-3 pb-3">
          {phase >= 1 && (
            <MiniMessage person={MAYA}>
              Deploy is green. Shipping the billing fix after lunch.
            </MiniMessage>
          )}
          {phase >= 2 && (
            <MiniMessage person={TOMAS}>
              Nice, I'll keep an eye on error rates.
            </MiniMessage>
          )}
          {phase >= 3 && (
            <MiniMessage person={you}>
              Lunch at 1? I'll book a table.
            </MiniMessage>
          )}
        </div>
        <MiniComposer toLor={false}>
          <span className="text-muted-foreground">Message #engineering</span>
        </MiniComposer>
      </div>
    </MiniWindow>
  )
}

// @Lor appears, the question types out, the send clears the composer without
// posting in the chat, and a session row starts under #engineering. The
// Started note shows, a cursor clicks Open, and the session opens: your
// question on top, Lor working, and its answer.
const START_TIMES = [500, 800, 2100, 2800, 3300, 4100, 4400, 5900] as const

export function SessionStartScene({ workspaceName, you }: SceneProps) {
  const phase = usePhase(START_TIMES)
  const drafting = phase >= 1 && phase < 3
  const titled = phase >= 4
  const clicking = phase >= 6
  const inSession = phase >= 7
  const answered = phase >= 8
  const readingChat = phase === 3 || phase === 4

  const startedNote = phase >= 3 && (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: EASE_OUT }}
      className="absolute bottom-full left-1 mb-1.5 flex max-w-[calc(100%-0.5rem)] items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs text-muted-foreground backdrop-blur"
    >
      <Spinner className="size-3 shrink-0 text-agent" />
      <span className="truncate">
        Started{" "}
        <span className="font-medium text-foreground">
          <TypewriterText
            text={titled ? SESSION_TITLE : "New session"}
            animate
          />
        </span>
      </span>
      <span
        className={cn(
          "relative shrink-0 font-medium text-agent",
          clicking && "underline"
        )}
      >
        Open
        {phase >= 5 && <MiniCursor clicking={clicking} />}
      </span>
    </motion.div>
  )

  const channelPane = (
    <>
      <div className="border-b px-3 py-2 font-semibold"># engineering</div>
      <div className="flex flex-1 flex-col justify-end px-1.5 pb-1.5">
        {/* The send lights up the chat Lor takes as context. */}
        <div
          className={cn(
            "flex flex-col gap-3 rounded-lg px-1.5 py-1.5 ring-1 transition-[background-color,box-shadow] duration-500",
            readingChat ? "bg-agent/8 ring-agent/25" : "ring-transparent"
          )}
        >
          <MiniMessage person={MAYA}>
            Deploy is green. Shipping the billing fix after lunch.
          </MiniMessage>
          <MiniMessage person={TOMAS}>
            Nice, I'll keep an eye on error rates.
          </MiniMessage>
        </div>
      </div>
      <MiniComposer
        toLor={drafting}
        notice={startedNote}
        bar={
          drafting && (
            <DestinationBar
              destination="channel"
              channelName="engineering"
              toLor
              pinged={[]}
            />
          )
        }
      >
        {drafting ? (
          <>
            <LorChip />
            <TypewriterText text={phase >= 2 ? QUESTION : ""} animate />
          </>
        ) : (
          <span className="text-muted-foreground">Message #engineering</span>
        )}
      </MiniComposer>
    </>
  )

  const sessionPane = (
    <>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-semibold">
          {SESSION_TITLE}
        </span>
        <PersonAvatar person={you} />
      </div>
      <div className="flex flex-1 flex-col gap-3 px-3 pt-3 pb-3">
        <MiniMessage person={you}>
          <LorChip />
          {QUESTION}
          <span className="mt-1 flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">
            <HugeiconsIcon
              icon={HashtagIcon}
              className="size-3"
              strokeWidth={2}
            />
            engineering · 2 messages
          </span>
        </MiniMessage>
        <div className="flex gap-2.5">
          <img src="/lor-mark.svg" alt="" className="mt-0.5 size-5" />
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              {!answered && <SessionStateIndicator state="running" />}
              {answered ? "Worked" : "Reading #engineering…"}
            </div>
            {/* Mounted empty first, so the answer types out when it lands. */}
            <p className="text-foreground/90">
              <TypewriterText text={answered ? LOR_ANSWER : ""} animate />
            </p>
          </div>
        </div>
      </div>
      <MiniComposer toLor={false}>
        <span className="text-muted-foreground">Reply…</span>
      </MiniComposer>
    </>
  )

  return (
    <MiniWindow>
      <MiniSidebar
        workspaceName={workspaceName}
        channelActive={!inSession}
        sessions={
          <>
            {phase >= 3 && (
              <MiniSessionRow
                title={titled ? SESSION_TITLE : "New session"}
                state={answered ? "idle" : "running"}
                active={inSession}
              />
            )}
            <MiniSessionRow title="Pricing page copy" state="unread" />
          </>
        }
      />
      <div className="relative min-w-0 flex-1">
        <AnimatePresence initial={false}>
          <motion.div
            key={inSession ? "session" : "channel"}
            {...paneSwap}
            className="absolute inset-0 flex flex-col"
          >
            {inSession ? sessionPane : channelPane}
          </motion.div>
        </AnimatePresence>
      </div>
    </MiniWindow>
  )
}

// A teammate replies to Lor, then you switch the pill and talk to people
// only: that turn stays muted and Lor does not answer it.
const SHARED_TIMES = [600, 1500, 2700, 3700] as const
const PEOPLE_REPLY = "Looks good to me, let's ship it."

export function SharedSessionScene({ workspaceName, you }: SceneProps) {
  const phase = usePhase(SHARED_TIMES)
  const drafting = phase >= 2 && phase < 4
  return (
    <MiniWindow>
      <MiniSidebar
        workspaceName={workspaceName}
        channelActive={false}
        sessions={<MiniSessionRow title={SESSION_TITLE} state="idle" active />}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="min-w-0 flex-1 truncate font-semibold">
            {SESSION_TITLE}
          </span>
          <div className="flex -space-x-1.5">
            <PersonAvatar person={you} />
            <AnimatePresence>
              {phase >= 1 && (
                <motion.div {...appear}>
                  <PersonAvatar person={TOMAS} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3 px-3 pb-3">
          <div className="flex gap-2.5">
            <img src="/lor-mark.svg" alt="" className="mt-0.5 size-5" />
            <p className="text-foreground/90">{LOR_ANSWER}</p>
          </div>
          {phase >= 1 && (
            <MiniMessage person={TOMAS}>Can you check staging too?</MiniMessage>
          )}
          {phase >= 4 && (
            <MiniMessage person={you} muted>
              {PEOPLE_REPLY}
            </MiniMessage>
          )}
        </div>
        <MiniComposer
          toLor={false}
          bar={
            drafting && (
              <DestinationBar
                destination="session"
                channelName="engineering"
                toLor={phase < 3}
                pinged={[]}
              />
            )
          }
        >
          {/* Mounted empty first, so the reply types out when it arrives. */}
          {phase < 4 && (
            <TypewriterText
              text={drafting ? PEOPLE_REPLY : ""}
              animate
              className={cn(
                "transition-colors",
                phase >= 3 && "text-muted-foreground"
              )}
            />
          )}
          {!drafting && <span className="text-muted-foreground">Reply…</span>}
        </MiniComposer>
      </div>
    </MiniWindow>
  )
}
