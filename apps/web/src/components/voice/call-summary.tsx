import {
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
import { Skeleton } from "@repo/ui/components/skeleton"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { differenceInMinutes, formatDateTime } from "@repo/utils/date"
import { type ReactNode, useState } from "react"
import {
  formatDuration,
  ParticipantStack,
} from "@/components/voice/voice-lobby"
import { useCallCitation } from "@/hooks/use-call-citation"
import {
  type CallSummaryContent,
  useSaveSummaryCard,
  useSummaryCard,
} from "@/hooks/use-call-summary"
import type { Message } from "@/lib/api-types"

const DECISION = {
  icon: CheckmarkCircle02Icon,
  tone: "text-success-foreground",
}
const QUESTION = { icon: HelpCircleIcon, tone: "text-warning-foreground" }
const ACTION = { icon: CircleArrowRight02Icon, tone: "text-info-foreground" }

type Line = { id: number; text: string; atMs: number | null }
type ActionLine = {
  id: number
  owner: string
  title: string
  detail: string
  atMs: number | null
}
type Draft = {
  title: string
  summary: string
  decisions: Line[]
  openQuestions: Line[]
  actionItems: ActionLine[]
}

let nextDraftId = 0
const newId = () => nextDraftId++

function toDraft(summary: CallSummaryContent | null): Draft {
  const lines = (items: CallSummaryContent["decisions"]) =>
    items.map((item) => ({ ...item, id: newId() }))
  return {
    title: summary?.title ?? "",
    summary: summary?.summary ?? "",
    decisions: lines(summary?.decisions ?? []),
    openQuestions: lines(summary?.openQuestions ?? []),
    actionItems: (summary?.actionItems ?? []).map((item) => ({
      id: newId(),
      owner: item.owner ?? "",
      title: item.title,
      detail: item.detail ?? "",
      atMs: item.atMs,
    })),
  }
}

function fromDraft(draft: Draft): CallSummaryContent {
  const lines = (list: Line[]) =>
    list
      .map((line) => ({ text: line.text.trim(), atMs: line.atMs }))
      .filter((line) => line.text)
  return {
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    decisions: lines(draft.decisions),
    openQuestions: lines(draft.openQuestions),
    actionItems: draft.actionItems
      .map((item) => ({
        owner: item.owner.trim() || null,
        title: item.title.trim(),
        detail: item.detail.trim() || null,
        atMs: item.atMs,
      }))
      .filter((item) => item.title),
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

function EditorSection({
  title,
  add,
  onAdd,
  children,
}: {
  title: string
  add: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="font-medium text-muted-foreground text-xs">{title}</h4>
      {children}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="-ml-2 self-start text-muted-foreground"
        onClick={onAdd}
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
        {add}
      </Button>
    </section>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Remove"
      className="shrink-0 text-muted-foreground"
      onClick={onClick}
    >
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
    </Button>
  )
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
  const update = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }))
  const lineList = (
    key: "decisions" | "openQuestions",
    title: string,
    add: string,
    kind: typeof DECISION
  ) => (
    <EditorSection
      title={title}
      add={add}
      onAdd={() =>
        update({
          [key]: [...draft[key], { id: newId(), text: "", atMs: null }],
        })
      }
    >
      {draft[key].map((line) => (
        <div key={line.id} className="flex items-center gap-2">
          <HugeiconsIcon
            icon={kind.icon}
            strokeWidth={2}
            className={cn("size-4 shrink-0", kind.tone)}
          />
          <Input
            aria-label={title}
            value={line.text}
            onChange={(event) =>
              update({
                [key]: draft[key].map((other) =>
                  other.id === line.id
                    ? { ...other, text: event.target.value }
                    : other
                ),
              })
            }
          />
          <RemoveButton
            onClick={() =>
              update({
                [key]: draft[key].filter((other) => other.id !== line.id),
              })
            }
          />
        </div>
      ))}
    </EditorSection>
  )
  const setAction = (id: number, patch: Partial<ActionLine>) =>
    update({
      actionItems: draft.actionItems.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      ),
    })

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(fromDraft(draft))
      }}
    >
      <Input
        aria-label="Title"
        placeholder="Title"
        value={draft.title}
        onChange={(event) => update({ title: event.target.value })}
      />
      <Textarea
        aria-label="Summary"
        placeholder="What the call was about and where it landed"
        value={draft.summary}
        onChange={(event) => update({ summary: event.target.value })}
        rows={3}
      />
      {lineList("decisions", "Decisions", "Add a decision", DECISION)}
      {lineList("openQuestions", "Open questions", "Add a question", QUESTION)}
      <EditorSection
        title="Action items"
        add="Add an action item"
        onAdd={() =>
          update({
            actionItems: [
              ...draft.actionItems,
              { id: newId(), owner: "", title: "", detail: "", atMs: null },
            ],
          })
        }
      >
        {draft.actionItems.map((item) => (
          <div key={item.id} className="flex items-start gap-2">
            <HugeiconsIcon
              icon={ACTION.icon}
              strokeWidth={2}
              className={cn("mt-2 size-4 shrink-0", ACTION.tone)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex gap-1.5">
                <Input
                  aria-label="Owner"
                  placeholder="Owner"
                  className="w-36 shrink-0"
                  value={item.owner}
                  onChange={(event) =>
                    setAction(item.id, { owner: event.target.value })
                  }
                />
                <Input
                  aria-label="Task"
                  placeholder="Task"
                  value={item.title}
                  onChange={(event) =>
                    setAction(item.id, { title: event.target.value })
                  }
                />
              </div>
              <Input
                aria-label="Detail"
                placeholder="Detail (optional)"
                value={item.detail}
                onChange={(event) =>
                  setAction(item.id, { detail: event.target.value })
                }
              />
            </div>
            <RemoveButton
              onClick={() =>
                update({
                  actionItems: draft.actionItems.filter(
                    (other) => other.id !== item.id
                  ),
                })
              }
            />
          </div>
        ))}
      </EditorSection>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={saving || !draft.title.trim() || !draft.summary.trim()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  )
}

// One line of the summary. With a time, the whole row opens the transcript
// at that moment; times sit in a right-aligned column so a list scans down
// one edge.
function SummaryRow({
  kind,
  atMs,
  onOpenMoment,
  children,
}: {
  kind: { icon: IconSvgElement; tone: string }
  atMs: number | null
  onOpenMoment: (atMs: number) => void
  children: ReactNode
}) {
  const row = "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-sm"
  const content = (
    <>
      <HugeiconsIcon
        icon={kind.icon}
        strokeWidth={2}
        className={cn("mt-0.5 size-4 shrink-0", kind.tone)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</span>
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

function SummarySection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section>
      <h4 className="mb-1 font-medium text-muted-foreground text-xs">
        {title}
      </h4>
      <ul className="-mx-2 flex flex-col">{children}</ul>
    </section>
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
      <p className="whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed">
        {summary.summary}
      </p>
      {summary.decisions.length > 0 && (
        <SummarySection title="Decisions">
          {summary.decisions.map((item) => (
            <SummaryRow
              key={`${item.atMs}-${item.text}`}
              kind={DECISION}
              atMs={item.atMs}
              onOpenMoment={onOpenMoment}
            >
              {item.text}
            </SummaryRow>
          ))}
        </SummarySection>
      )}
      {summary.openQuestions.length > 0 && (
        <SummarySection title="Open questions">
          {summary.openQuestions.map((item) => (
            <SummaryRow
              key={`${item.atMs}-${item.text}`}
              kind={QUESTION}
              atMs={item.atMs}
              onOpenMoment={onOpenMoment}
            >
              {item.text}
            </SummaryRow>
          ))}
        </SummarySection>
      )}
      {summary.actionItems.length > 0 && (
        <SummarySection title="Action items">
          {summary.actionItems.map((item) => (
            <SummaryRow
              key={`${item.atMs}-${item.title}`}
              kind={ACTION}
              atMs={item.atMs}
              onOpenMoment={onOpenMoment}
            >
              <span>
                {item.owner && (
                  <span className="font-medium">{item.owner}: </span>
                )}
                {item.title}
              </span>
              {item.detail && (
                <span className="text-muted-foreground text-[13px] leading-snug">
                  {item.detail}
                </span>
              )}
            </SummaryRow>
          ))}
        </SummarySection>
      )}
    </div>
  )
}

const CARD = "mt-1.5 w-full max-w-xl rounded-xl bg-secondary/60 px-4 py-3.5"

// Lor's summary of an ended call, posted in its chat so everyone in the call
// is notified. Draws the call's current summary, so a correction shows here
// for everyone; times open the transcript at that moment.
export function CallSummaryCard({ message }: { message: Message }) {
  const { data, isPending, isError } = useSummaryCard(message.id)
  const save = useSaveSummaryCard(message.id)
  const { open: openTranscript } = useCallCitation()
  const [editing, setEditing] = useState(false)

  if (isPending) {
    return (
      <div className={cn(CARD, "flex flex-col gap-2.5")}>
        <Skeleton className="h-4 w-48 rounded" />
        <Skeleton className="h-3 w-32 rounded" />
        <Skeleton className="mt-2 h-3 w-full rounded" />
        <Skeleton className="h-3 w-4/5 rounded" />
      </div>
    )
  }
  // The posted text stands in when the card can't load.
  if (isError) {
    return (
      <p className="whitespace-pre-wrap text-foreground/90 text-sm">
        {message.content}
      </p>
    )
  }

  const { call, summary } = data
  const failed = () => toast.error("Couldn't open the transcript")
  const openAt = (atMs?: number) =>
    void openTranscript(data.sessionId, atMs).then(
      (found) => found || failed(),
      failed
    )
  const day = new Date(call.startedAt).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
  const length = call.endedAt
    ? formatDuration(differenceInMinutes(call.startedAt, call.endedAt))
    : null
  const byline = data.editedAt
    ? `Edited by ${data.editedBy?.name ?? "someone"} · ${formatDateTime(data.editedAt)}`
    : "Written by Lor"

  return (
    <div className={CARD}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-base leading-snug">
            {summary?.title ?? "Call summary"}
          </h3>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {[day, length].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ParticipantStack participants={call.participants} />
      </div>

      <div className="mt-4">
        {editing ? (
          <SummaryEditor
            initial={toDraft(summary)}
            saving={save.isPending}
            onCancel={() => setEditing(false)}
            onSave={(next) =>
              save.mutate(next, {
                onSuccess: () => setEditing(false),
                onError: (error) => toast.error(error.message),
              })
            }
          />
        ) : summary ? (
          <SummaryBody summary={summary} onOpenMoment={openAt} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Lor couldn't write a summary for this call. Its transcript is
            indexed, so you can still ask Lor about it.
          </p>
        )}
      </div>

      {!editing && (
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" size="xs" onClick={() => openAt()}>
            Open transcript
          </Button>
          <span className="ml-auto min-w-0 truncate text-muted-foreground text-xs">
            {summary ? byline : null}
          </span>
          {data.canEdit && (
            <Button
              variant="ghost"
              size="xs"
              className="-mr-2 shrink-0 text-muted-foreground"
              onClick={() => setEditing(true)}
            >
              <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
              {summary ? "Edit" : "Write one"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
