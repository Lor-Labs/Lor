import { Cancel01Icon, MessageMultiple01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { timeAgo } from "@repo/utils/date"
import {
  AnimatePresence,
  motion,
  type Transition,
  useReducedMotion,
} from "motion/react"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import type { ThreadActivity } from "@/hooks/use-thread-activity"
import type { Message } from "@/lib/api-types"
import { STORED_MENTION_REGEX } from "@/lib/editor-utils"

// Turn stored `<@uuid>` tokens into readable `@name` for the one-line preview.
function renderMentions(content: string, mentions: Message["mentions"]) {
  const byId = new Map(mentions.map((m) => [m.id, m]))
  return content.replace(STORED_MENTION_REGEX, (_match, id: string) => {
    const mention = byId.get(id)
    const label = mention?.name ?? "unknown"
    return `@${label}`
  })
}

// Newest reply, formatted like a notification preview: "Author: message".
function previewText(activity: ThreadActivity) {
  const reply = activity.lastReply
  const author = reply?.authorName ? `${reply.authorName}: ` : ""
  const trimmed = reply?.content?.replace(/\s+/g, " ").trim()
  if (trimmed)
    return `${author}${renderMentions(trimmed, reply?.mentions ?? [])}`
  if (reply?.hasAttachments) return `${author}sent an attachment`
  return "New reply"
}

// Collapsed-blob geometry. The goo circles sit GOO_PAD beyond each avatar and
// the SVG goo filter melts adjacent circles into one liquid capsule — both
// layers animate the same `left` offsets so the silhouette tracks the faces.
const BLOB_AVATAR = 26
const BLOB_STEP = 18
const BLOB_PAD = 5
const GOO_PAD = 4
const BLOB_HEIGHT = BLOB_AVATAR + GOO_PAD * 2
const MAX_BLOBS = 3
const MAX_BLOB_AVATARS = 3

function GooFilterDefs({ filterId }: { filterId: string }) {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute size-0">
      <defs>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  )
}

function ThreadBlob({
  activity,
  filterId,
  onClick,
  transition,
}: {
  activity: ThreadActivity
  filterId: string
  onClick: () => void
  transition: Transition
}) {
  // participants arrive newest-first; render newest at the right edge so a
  // fresh replier slides in from outside and gets absorbed into the capsule.
  const people = activity.participants.slice(0, MAX_BLOB_AVATARS).reverse()
  const width =
    BLOB_PAD * 2 + BLOB_AVATAR + (people.length - 1) * BLOB_STEP + GOO_PAD * 2
  const names = people.map((p) => p.name).join(", ")
  const replyLabel =
    activity.newReplyCount === 1
      ? "1 new thread reply"
      : `${activity.newReplyCount} new thread replies`

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.5, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.5, y: 10 }}
      transition={transition}
      onClick={onClick}
      aria-label={`${replyLabel} from ${names} — open thread`}
      className="relative block shrink-0 cursor-pointer"
      style={{ width, height: BLOB_HEIGHT }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          filter: `url(#${filterId}) drop-shadow(0 2px 6px rgb(0 0 0 / 0.14))`,
        }}
      >
        {people.map((p, i) => (
          <motion.span
            key={p.id}
            initial={{
              left:
                GOO_PAD + BLOB_PAD + i * BLOB_STEP + BLOB_STEP + 6 - GOO_PAD,
              scale: 0.4,
            }}
            animate={{
              left: GOO_PAD + BLOB_PAD + i * BLOB_STEP - GOO_PAD,
              scale: 1,
            }}
            exit={{ scale: 0, opacity: 0 }}
            transition={transition}
            className="absolute top-1/2 -translate-y-1/2 rounded-full bg-accent"
            style={{
              width: BLOB_AVATAR + GOO_PAD * 2,
              height: BLOB_AVATAR + GOO_PAD * 2,
            }}
          />
        ))}
      </div>
      {people.map((p, i) => (
        <motion.span
          key={p.id}
          initial={{
            left: GOO_PAD + BLOB_PAD + i * BLOB_STEP + BLOB_STEP + 6,
            opacity: 0,
            scale: 0.4,
          }}
          animate={{
            left: GOO_PAD + BLOB_PAD + i * BLOB_STEP,
            opacity: 1,
            scale: 1,
          }}
          exit={{ opacity: 0, scale: 0.4 }}
          transition={transition}
          className="absolute top-1/2 -translate-y-1/2"
        >
          <Avatar size="sm" style={{ width: BLOB_AVATAR, height: BLOB_AVATAR }}>
            {p.image && <AvatarImage src={p.image} alt={p.name} />}
            <AvatarFallback
              avatarColor={p.avatarColor}
              className="text-[10px] font-semibold"
              fallbackSeed={p.name}
            >
              {getAvatarInitials(p.name)}
            </AvatarFallback>
          </Avatar>
        </motion.span>
      ))}
      <motion.span
        key={activity.newReplyCount}
        initial={{ scale: 1.4 }}
        animate={{ scale: 1 }}
        transition={transition}
        className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
      >
        {activity.newReplyCount > 99 ? "99+" : activity.newReplyCount}
      </motion.span>
    </motion.button>
  )
}

function OverflowBlob({
  count,
  onClick,
  transition,
}: {
  count: number
  onClick: () => void
  transition: Transition
}) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={transition}
      onClick={onClick}
      aria-label={`${count} more threads with new replies`}
      className="flex shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-muted-foreground shadow-sm transition-colors hover:text-foreground"
      style={{ width: BLOB_HEIGHT, height: BLOB_HEIGHT }}
    >
      +{count}
    </motion.button>
  )
}

function ThreadActivityCard({
  activity,
  onOpen,
  onDismiss,
}: {
  activity: ThreadActivity
  onOpen: (threadRootId: string) => void
  onDismiss: (threadRootId: string) => void
}) {
  const replyLabel =
    activity.newReplyCount === 1 ? "1 new" : `${activity.newReplyCount} new`

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="group relative"
    >
      <button
        type="button"
        onClick={() => onOpen(activity.threadRootId)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-lg py-1.5 pr-9 pl-2 text-left text-[12.5px]",
          "transition-colors hover:bg-accent/60"
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <HugeiconsIcon
            icon={MessageMultiple01Icon}
            className="size-3.5"
            strokeWidth={2.25}
          />
        </span>
        <div className="flex shrink-0 -space-x-1.5">
          {activity.participants.slice(0, 3).map((p) => (
            <span
              key={p.id}
              className="rounded-full ring-2 ring-popover transition-[box-shadow]"
            >
              <Avatar size="sm" className="size-[18px]">
                {p.image && <AvatarImage src={p.image} alt={p.name} />}
                <AvatarFallback
                  avatarColor={p.avatarColor}
                  className="text-[9px] font-semibold"
                  fallbackSeed={p.name}
                >
                  {getAvatarInitials(p.name)}
                </AvatarFallback>
              </Avatar>
            </span>
          ))}
        </div>
        <span className="shrink-0 font-semibold text-primary group-hover:underline">
          {replyLabel}
        </span>
        <span className="truncate text-muted-foreground">
          {previewText(activity)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/80">
          {timeAgo(activity.lastReplyAt)}
        </span>
      </button>
      <button
        type="button"
        aria-label="Mark thread read"
        onClick={() => onDismiss(activity.threadRootId)}
        className="absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <HugeiconsIcon
          icon={Cancel01Icon}
          className="size-3.5"
          strokeWidth={2}
        />
      </button>
    </motion.div>
  )
}

/**
 * Floating "new replies in threads" dock, anchored above the composer at the
 * bottom-right of the feed (an overlay — it never scrolls away with the
 * messages). Collapsed it shows one gooey avatar blob per fresh thread;
 * hovering (or tapping the overflow bubble) expands it into the preview
 * cards. Clicking a blob or card opens the thread.
 */
export function ThreadActivityDock({
  activities,
  onOpen,
  onDismiss,
}: {
  activities: ThreadActivity[]
  onOpen: (threadRootId: string) => void
  onDismiss: (threadRootId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Unique per dock instance — duplicate SVG filter ids are invalid DOM when
  // two feeds are mounted at once.
  const gooFilterId = `thread-goo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const dockRef = useRef<HTMLDivElement>(null)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Reduced motion: MotionConfig already snaps transforms and layout; keep a
  // short opacity fade instead of a spring.
  const reducedMotion = useReducedMotion()
  const transition = reducedMotion
    ? { duration: 0.15, ease: EASE_OUT }
    : { type: "spring" as const, stiffness: 480, damping: 34 }

  const cancelCollapse = useCallback(() => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
  }, [])
  useEffect(() => cancelCollapse, [cancelCollapse])

  useEffect(() => {
    if (activities.length === 0) setExpanded(false)
  }, [activities.length])

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!dockRef.current?.contains(event.target as Node)) setExpanded(false)
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [expanded])

  if (activities.length === 0) return null

  // activities arrive oldest → newest; blobs show the freshest threads with
  // the newest at the right, nearest the corner.
  const blobActivities = activities.slice(-MAX_BLOBS)
  const overflowCount = activities.length - blobActivities.length

  const dismissAll = () => {
    for (const activity of activities) onDismiss(activity.threadRootId)
  }

  return (
    <div
      ref={dockRef}
      className="absolute right-3 bottom-3 z-20 flex flex-col items-end"
      onPointerEnter={(event) => {
        if (event.pointerType !== "mouse") return
        cancelCollapse()
        setExpanded(true)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return
        cancelCollapse()
        collapseTimerRef.current = setTimeout(() => setExpanded(false), 180)
      }}
    >
      <GooFilterDefs filterId={gooFilterId} />
      <AnimatePresence mode="popLayout" initial={false}>
        {expanded ? (
          <motion.div
            key="stack"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={transition}
            className="w-[380px] max-w-[calc(100vw-2rem)] origin-bottom-right rounded-xl border border-border/70 bg-popover/95 p-1.5 shadow-lg backdrop-blur-sm"
          >
            <div className="flex items-center justify-between px-1.5 pt-0.5 pb-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                New replies in threads
              </span>
              <button
                type="button"
                onClick={dismissAll}
                className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Mark all read
              </button>
            </div>
            <div className="flex max-h-[min(420px,60vh)] flex-col gap-0.5 overflow-y-auto">
              <AnimatePresence initial={false}>
                {activities.map((activity) => (
                  <ThreadActivityCard
                    key={activity.threadRootId}
                    activity={activity}
                    onOpen={onOpen}
                    onDismiss={onDismiss}
                  />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="cluster"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={transition}
            className="flex items-center gap-2"
          >
            {overflowCount > 0 && (
              <OverflowBlob
                count={overflowCount}
                onClick={() => setExpanded(true)}
                transition={transition}
              />
            )}
            <AnimatePresence initial={false}>
              {blobActivities.map((activity) => (
                <ThreadBlob
                  key={activity.threadRootId}
                  activity={activity}
                  filterId={gooFilterId}
                  onClick={() => onOpen(activity.threadRootId)}
                  transition={transition}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
