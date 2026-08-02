import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Textarea } from "@repo/ui/components/textarea"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, Loader2, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"

const MAX_BYTES = 8 * 1024

type InstructionsVersion = {
  version: number
  content: string
  state: "active" | "pending" | "rejected" | "superseded"
  authorType: "user" | "agent"
  authorName: string | null
  baseVersion: number | null
  rationale: string | null
  createdAt: string
}

type InstructionsData = {
  active: InstructionsVersion | null
  pending: InstructionsVersion | null
  versions: InstructionsVersion[]
  canManage: boolean
}

type DiffLine = { type: "same" | "add" | "del"; text: string }

// Line-level LCS diff — content is capped at 8 KB, so the DP table stays tiny.
function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n")
  const b = after.split("\n")
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i]
    if (!row) continue
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: "same", text: a[i] ?? "" })
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      lines.push({ type: "del", text: a[i] ?? "" })
      i++
    } else {
      lines.push({ type: "add", text: b[j] ?? "" })
      j++
    }
  }
  while (i < a.length) {
    lines.push({ type: "del", text: a[i] ?? "" })
    i++
  }
  while (j < b.length) {
    lines.push({ type: "add", text: b[j] ?? "" })
    j++
  }
  return lines
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after])
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
      {lines.map((line, index) => (
        <div
          key={`${index}-${line.text}`}
          className={cn(
            line.type === "add" &&
              "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
            line.type === "del" &&
              "bg-destructive/10 text-destructive line-through decoration-destructive/40"
          )}
        >
          {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
          {line.text || " "}
        </div>
      ))}
    </pre>
  )
}

export function InstructionsSection({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["workspace-instructions", workspaceSlug],
    queryFn: async (): Promise<InstructionsData> => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].instructions.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load instructions")
      return res.json()
    },
  })

  const activeContent = data?.active?.content ?? ""
  const activeVersion = data?.active?.version ?? null

  // Reset the draft whenever a new active version lands (save, approval,
  // concurrent edit) so the editor never shows stale text as "yours".
  useEffect(() => {
    setDraft(null)
  }, [activeVersion])

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["workspace-instructions", workspaceSlug],
    })

  const conflictToast = (message: string) => {
    toast.error(message)
    void refetch()
  }

  const save = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].instructions.$put({
        param: { workspaceSlug },
        json: { content, baseVersion: activeVersion },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Failed to save instructions")
      }
    },
    onSuccess: () => {
      toast.success(
        "Instructions updated — Merlin follows them from its next answer"
      )
      setDraft(null)
      void invalidate()
    },
    onError: (err) => conflictToast(err.message),
  })

  const approve = useMutation({
    mutationFn: async (version: number) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].instructions[
        ":version"
      ].approve.$post({
        param: { workspaceSlug, version: String(version) },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Failed to approve proposal")
      }
    },
    onSuccess: () => {
      toast.success("Proposal approved")
      void invalidate()
    },
    onError: (err) => conflictToast(err.message),
  })

  const reject = useMutation({
    mutationFn: async (version: number) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].instructions[
        ":version"
      ].reject.$post({
        param: { workspaceSlug, version: String(version) },
      })
      if (!res.ok) throw new Error("Failed to reject proposal")
    },
    onSuccess: () => {
      toast.success("Proposal rejected")
      void invalidate()
    },
    onError: (err) => conflictToast(err.message),
  })

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn't load instructions.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const editorValue = draft ?? activeContent
  const editorBytes = new TextEncoder().encode(editorValue).length
  const overLimit = editorBytes > MAX_BYTES
  const hasChanges = draft !== null && draft !== activeContent
  const pending = data.pending
  const pendingIsStale =
    pending !== null && pending.baseVersion !== activeVersion
  const history = data.versions.filter((v) => v.state !== "pending")

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Standing instructions Merlin follows in every answer — tone, priorities,
        team conventions. Merlin can propose changes, but they only take effect
        after an admin approves them here.
      </p>

      {pending && (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Merlin proposed an update
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                v{pending.version} ·{" "}
                {new Date(pending.createdAt).toLocaleString()}
              </span>
            </div>
            <Badge variant="secondary">Pending approval</Badge>
          </div>
          {pending.rationale && (
            <p className="text-sm text-muted-foreground">{pending.rationale}</p>
          )}
          {pendingIsStale && (
            <p className="text-xs text-destructive">
              The active instructions changed after this was proposed —
              approving is blocked. Review the proposal and re-apply what's
              still wanted as a direct edit, or reject it.
            </p>
          )}
          <DiffView before={activeContent} after={pending.content} />
          {data.canManage && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={reject.isPending || approve.isPending}
                onClick={() => reject.mutate(pending.version)}
              >
                <X className="size-4" />
                Reject
              </Button>
              <Button
                size="sm"
                disabled={
                  approve.isPending || reject.isPending || pendingIsStale
                }
                onClick={() => approve.mutate(pending.version)}
              >
                <Check className="size-4" />
                Approve
              </Button>
            </div>
          )}
        </div>
      )}

      {data.canManage ? (
        <div className="space-y-2">
          <Textarea
            value={editorValue}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              "e.g. Answer in English. Prefer linking Linear issues over quoting them. Our on-call rotation is documented in /processes/on-call."
            }
            className="min-h-56 font-mono text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-xs",
                overLimit ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {editorBytes.toLocaleString()} / {MAX_BYTES.toLocaleString()}{" "}
              bytes
            </span>
            <div className="flex gap-2">
              {hasChanges && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft(null)}
                  disabled={save.isPending}
                >
                  Discard
                </Button>
              )}
              <Button
                size="sm"
                disabled={!hasChanges || overLimit || save.isPending}
                onClick={() => save.mutate(editorValue)}
              >
                {save.isPending && <Loader2 className="size-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : activeContent ? (
        <pre className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
          {activeContent}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">
          No instructions set yet.
        </p>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                historyOpen && "rotate-180"
              )}
            />
            Version history
          </button>
          {historyOpen && (
            <div className="space-y-1">
              {history.map((v) => (
                <div
                  key={v.version}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground"
                >
                  <span>
                    v{v.version} ·{" "}
                    {v.authorType === "agent"
                      ? "Merlin"
                      : (v.authorName ?? "Unknown")}{" "}
                    · {new Date(v.createdAt).toLocaleString()}
                  </span>
                  <Badge
                    variant={v.state === "active" ? "default" : "secondary"}
                  >
                    {v.state}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
