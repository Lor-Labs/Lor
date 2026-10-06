import {
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CircleArrowRight02Icon,
  HelpCircleIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { formatDateTime } from "@repo/utils/date"
import { useState } from "react"
import {
  type CallSummaryContent,
  useCallSummary,
  useSaveCallSummary,
} from "@/hooks/use-call-summary"

const LISTS = [
  {
    key: "decisions",
    title: "Decisions",
    add: "Add a decision",
    icon: CheckmarkCircle02Icon,
    tone: "text-success-foreground",
  },
  {
    key: "openQuestions",
    title: "Open questions",
    add: "Add a question",
    icon: HelpCircleIcon,
    tone: "text-warning-foreground",
  },
  {
    key: "followUps",
    title: "Follow-ups",
    add: "Add a follow-up",
    icon: CircleArrowRight02Icon,
    tone: "text-info-foreground",
  },
] as const

type ListKey = (typeof LISTS)[number]["key"]
type DraftItem = { id: number; text: string; atMs: number | null }
type Draft = { summary: string; lists: Record<ListKey, DraftItem[]> }

let nextDraftId = 0
const draftItem = (item: { text: string; atMs: number | null }) => ({
  ...item,
  id: nextDraftId++,
})

function toDraft(summary: CallSummaryContent | null): Draft {
  return {
    summary: summary?.summary ?? "",
    lists: {
      decisions: (summary?.decisions ?? []).map(draftItem),
      openQuestions: (summary?.openQuestions ?? []).map(draftItem),
      followUps: (summary?.followUps ?? []).map(draftItem),
    },
  }
}

function fromDraft(draft: Draft): CallSummaryContent {
  const items = (list: DraftItem[]) =>
    list
      .map((item) => ({ text: item.text.trim(), atMs: item.atMs }))
      .filter((item) => item.text)
  return {
    summary: draft.summary.trim(),
    decisions: items(draft.lists.decisions),
    openQuestions: items(draft.lists.openQuestions),
    followUps: items(draft.lists.followUps),
  }
}

// "12:40", or "1:04:05" past an hour, into the call.
function callTime(ms: number) {
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, "0")
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`
}

const CARD = "mx-4 mb-3 rounded-xl bg-muted/50"

function SummaryEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: Draft
  saving: boolean
  onSave: (summary: CallSummaryContent) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const setList = (key: ListKey, list: DraftItem[]) =>
    setDraft((current) => ({
      ...current,
      lists: { ...current.lists, [key]: list },
    }))
  return (
    <form
      className="flex flex-col gap-4 px-4 pb-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(fromDraft(draft))
      }}
    >
      <Textarea
        aria-label="Summary"
        value={draft.summary}
        onChange={(event) =>
          setDraft((current) => ({ ...current, summary: event.target.value }))
        }
        rows={4}
      />
      {LISTS.map(({ key, title, add, icon, tone }) => (
        <section key={key} className="flex flex-col gap-1.5">
          <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
          {draft.lists[key].map((item) => (
            <div key={item.id} className="flex items-center gap-2">
              <HugeiconsIcon
                icon={icon}
                strokeWidth={2}
                className={cn("size-4 shrink-0", tone)}
              />
              <Input
                aria-label={title}
                value={item.text}
                onChange={(event) =>
                  setList(
                    key,
                    draft.lists[key].map((other) =>
                      other.id === item.id
                        ? { ...other, text: event.target.value }
                        : other
                    )
                  )
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove"
                className="text-muted-foreground"
                onClick={() =>
                  setList(
                    key,
                    draft.lists[key].filter((other) => other.id !== item.id)
                  )
                }
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="-ml-2 self-start text-muted-foreground"
            onClick={() =>
              setList(key, [
                ...draft.lists[key],
                draftItem({ text: "", atMs: null }),
              ])
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            {add}
          </Button>
        </section>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving || !draft.summary.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}

// One decision, question, or follow-up. With a time, the whole row jumps to
// that moment in the transcript; the time sits in a right-aligned column so
// a list scans down one edge.
function SummaryItem({
  icon,
  tone,
  text,
  atMs,
  onOpenMoment,
}: {
  icon: IconSvgElement
  tone: string
  text: string
  atMs: number | null
  onOpenMoment: (atMs: number) => void
}) {
  const row = "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-sm"
  const content = (
    <>
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={cn("mt-0.5 size-4 shrink-0", tone)}
      />
      <span className="min-w-0 flex-1 text-foreground/90">{text}</span>
      {atMs !== null && (
        <span className="mt-0.5 shrink-0 text-muted-foreground text-xs tabular-nums transition-colors group-hover:text-foreground">
          {callTime(atMs)}
        </span>
      )}
    </>
  )
  return (
    <li>
      {atMs === null ? (
        <div className={row}>{content}</div>
      ) : (
        <button
          type="button"
          onClick={() => onOpenMoment(atMs)}
          className={cn(
            row,
            "group cursor-pointer text-left transition-colors hover:bg-muted"
          )}
        >
          {content}
        </button>
      )}
    </li>
  )
}

function SummaryBody({
  summary,
  onOpenMoment,
}: {
  summary: CallSummaryContent
  onOpenMoment: (atMs: number) => void
}) {
  return (
    <div className="flex flex-col gap-4 px-4">
      <p className="whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed">
        {summary.summary}
      </p>
      {LISTS.map(({ key, title, icon, tone }) =>
        summary[key].length > 0 ? (
          <section key={key}>
            <h3 className="mb-1 font-medium text-muted-foreground text-xs">
              {title}
            </h3>
            <ul className="-mx-2 flex flex-col">
              {summary[key].map((item) => (
                <SummaryItem
                  key={`${item.atMs}-${item.text}`}
                  icon={icon}
                  tone={tone}
                  text={item.text}
                  atMs={item.atMs}
                  onOpenMoment={onOpenMoment}
                />
              ))}
            </ul>
          </section>
        ) : null
      )}
    </div>
  )
}

// The head of an ended call's transcript: what Lor wrote after the call,
// correctable by anyone who can post in the channel. Folds to one line so a
// long summary never buries the transcript; item rows scroll to their moment
// below.
export function CallSummary({
  sessionId,
  onOpenMoment,
}: {
  sessionId: string
  onOpenMoment: (atMs: number) => void
}) {
  const { data } = useCallSummary(sessionId)
  const save = useSaveCallSummary(sessionId)
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(true)

  if (!data || data.status === "live") return null
  if (data.status === "processing") {
    return (
      <div
        className={cn(
          CARD,
          "flex items-center gap-2 px-4 py-3 text-muted-foreground text-sm"
        )}
      >
        <img
          src="/lor-mark.svg"
          alt=""
          className="size-4 animate-pulse motion-reduce:animate-none"
        />
        Writing the summary…
      </div>
    )
  }
  if (!data.summary && !editing) {
    return data.canEdit ? (
      <Button
        variant="ghost"
        size="xs"
        className="mx-2.5 mb-2 text-muted-foreground"
        onClick={() => setEditing(true)}
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
        Add a summary
      </Button>
    ) : null
  }

  const expanded = open || editing
  const byline = data.editedAt
    ? `Edited by ${data.editedBy?.name ?? "someone"} · ${formatDateTime(data.editedAt)}`
    : "Written by Lor after the call"
  return (
    <section className={CARD}>
      <button
        type="button"
        aria-expanded={expanded}
        disabled={editing}
        onClick={() => setOpen(!open)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-2 px-4 py-3 text-left disabled:cursor-default"
      >
        <img src="/lor-mark.svg" alt="" className="size-4 shrink-0" />
        <span className="shrink-0 font-medium text-sm">Summary</span>
        {!expanded && data.summary && (
          <span className="min-w-0 truncate text-muted-foreground text-sm">
            {data.summary.summary}
          </span>
        )}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className={cn(
            "ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            !expanded && "-rotate-90"
          )}
        />
      </button>
      {editing ? (
        <SummaryEditor
          initial={toDraft(data.summary)}
          saving={save.isPending}
          onCancel={() => setEditing(false)}
          onSave={(summary) =>
            save.mutate(summary, {
              onSuccess: () => setEditing(false),
              onError: (error) => toast.error(error.message),
            })
          }
        />
      ) : (
        expanded &&
        data.summary && (
          <>
            <SummaryBody summary={data.summary} onOpenMoment={onOpenMoment} />
            <div className="flex min-h-11 items-center gap-2 px-4 pt-1 pb-2">
              <span className="min-w-0 truncate text-muted-foreground text-xs">
                {byline}
              </span>
              {data.canEdit && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="-mr-2 ml-auto text-muted-foreground"
                  onClick={() => setEditing(true)}
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                  Edit
                </Button>
              )}
            </div>
          </>
        )
      )}
    </section>
  )
}
