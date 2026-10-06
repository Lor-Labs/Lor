import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { formatDateTime } from "@repo/utils/date"
import { useState } from "react"
import {
  type CallSummaryContent,
  useCallSummary,
  useSaveCallSummary,
} from "@/hooks/use-call-summary"

const LISTS = [
  { key: "decisions", title: "Decisions", add: "Add a decision" },
  { key: "openQuestions", title: "Open questions", add: "Add a question" },
  { key: "followUps", title: "Follow-ups", add: "Add a follow-up" },
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
      className="flex flex-col gap-5"
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
      {LISTS.map(({ key, title, add }) => (
        <section key={key} className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">{title}</h3>
          {draft.lists[key].map((item) => (
            <div key={item.id} className="flex items-center gap-1.5">
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
                size="icon-sm"
                aria-label="Remove"
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
            className="self-start text-muted-foreground"
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

function SummaryBody({
  summary,
  onOpenMoment,
}: {
  summary: CallSummaryContent
  onOpenMoment: (atMs: number) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="whitespace-pre-wrap text-sm">{summary.summary}</p>
      {LISTS.map(({ key, title }) =>
        summary[key].length > 0 ? (
          <section key={key} className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">{title}</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {summary[key].map((item) => (
                <li key={`${item.atMs}-${item.text}`}>
                  {item.text}
                  {item.atMs !== null && (
                    <button
                      type="button"
                      onClick={() =>
                        item.atMs !== null && onOpenMoment(item.atMs)
                      }
                      className="ml-1.5 rounded bg-muted px-1 py-0.5 text-muted-foreground text-xs tabular-nums hover:text-foreground"
                    >
                      {callTime(item.atMs)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null
      )}
    </div>
  )
}

// The head of an ended call's transcript: what Lor wrote after the call,
// correctable by anyone who can post in the channel. Collapsible, so a long
// summary never buries the transcript; times scroll to that moment below.
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
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        Lor is writing the summary…
      </p>
    )
  }
  if (!data.summary && !editing) {
    return data.canEdit ? (
      <Button
        variant="ghost"
        size="xs"
        className="mx-3 mb-2 text-muted-foreground"
        onClick={() => setEditing(true)}
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
        Add a summary
      </Button>
    ) : null
  }

  const byline = data.editedAt
    ? `Edited by ${data.editedBy?.name ?? "someone"} · ${formatDateTime(data.editedAt)}`
    : data.summary
      ? "Written by Lor"
      : ""
  return (
    <section className="mx-4 mb-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5">
      <div className="flex min-h-6 items-center gap-2">
        <button
          type="button"
          aria-expanded={open || editing}
          onClick={() => setOpen(!open)}
          disabled={editing}
          className="flex shrink-0 items-center gap-1 font-semibold text-sm"
        >
          <HugeiconsIcon
            icon={open || editing ? ArrowDown01Icon : ArrowRight01Icon}
            className="size-4 text-muted-foreground"
            strokeWidth={2}
          />
          Summary
        </button>
        <span className="truncate text-xs text-muted-foreground">{byline}</span>
        {data.canEdit && !editing && (
          <Button
            variant="ghost"
            size="xs"
            className="-my-1 ml-auto text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-3">
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
        </div>
      ) : (
        open &&
        data.summary && (
          <div className="mt-2">
            <SummaryBody summary={data.summary} onOpenMoment={onOpenMoment} />
          </div>
        )
      )}
    </section>
  )
}
