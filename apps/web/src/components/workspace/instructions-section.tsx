import { parseDiffFromFile } from "@pierre/diffs"
import { FileDiff } from "@pierre/diffs/react"
import { Button } from "@repo/ui/components/button"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "@tiptap/extension-link"
import { Markdown } from "@tiptap/markdown"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  PILL_BUTTON,
  SETTINGS_SURFACE,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { useDiffHighlighterReady } from "@/hooks/use-diff-highlighter"
import { apiClient } from "@/lib/api-client"
import type {
  InstructionsResponse as InstructionsData,
  InstructionsVersion,
} from "@/lib/api-types"

// Mirrors WORKSPACE_INSTRUCTIONS_MAX_TOKENS in packages/db (web can't import
// the db package); ~4 chars/token estimate, same as the server validator.
const MAX_TOKENS = 2000
const estimateTokens = (content: string) => Math.ceil(content.length / 4)

// Newest versions shown before "View all".
const HISTORY_PREVIEW = 5

const STATE_LABELS: Record<InstructionsVersion["state"], string> = {
  active: "Active",
  pending: "Pending",
  rejected: "Rejected",
  superseded: "Replaced",
}

// "Sep 28, 2:14 PM" — the year only when it isn't this year.
function formatWhen(iso: string) {
  const at = new Date(iso)
  return at.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: at.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function DiffView({ before, after }: { before: string; after: string }) {
  const { resolvedTheme } = useTheme()
  const highlighterReady = useDiffHighlighterReady("LOR.md")
  // An empty base means "no instructions yet" — render as a new file rather
  // than a modification of an empty one.
  const fileDiff = useMemo(
    () =>
      parseDiffFromFile(before ? { name: "LOR.md", contents: before } : null, {
        name: "LOR.md",
        contents: after,
      }),
    [before, after]
  )
  if (!highlighterReady) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg bg-background">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    )
  }
  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-border text-xs">
      <FileDiff
        fileDiff={fileDiff}
        options={{
          themeType: resolvedTheme === "dark" ? "dark" : "light",
          diffStyle: "unified",
          overflow: "wrap",
          disableFileHeader: true,
        }}
      />
    </div>
  )
}

// Rich Markdown editing over plain-Markdown storage: Tiptap parses the active
// version in and serializes back with @tiptap/markdown, so the server, diff,
// and prompt injection all keep seeing raw text.
function InstructionsEditor({
  activeContent,
  activeVersion,
  onSave,
  isSaving,
}: {
  activeContent: string
  activeVersion: number | null
  // baseVersion = the version the editor content was drafted from, which can
  // lag activeVersion if the base changed mid-draft — the server's conflict
  // check needs the stale base to catch it.
  onSave: (content: string, baseVersion: number | null) => void
  isSaving: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ link: false }),
        Markdown,
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            class:
              "text-primary underline-offset-2 hover:underline cursor-pointer",
            rel: "noreferrer noopener",
            target: "_blank",
          },
        }),
      ],
      content: activeContent,
      contentType: "markdown",
      editorProps: {
        attributes: {
          class:
            "min-h-56 max-h-96 overflow-y-auto px-4 py-3 text-sm leading-6 text-foreground/90 outline-none [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-2 [&_code]:rounded-[4px] [&_code]:border [&_code]:border-border/70 [&_code]:bg-primary/10 [&_code]:px-0.75 [&_code]:py-0.25 [&_code]:font-mono [&_code]:text-[0.92em] [&_code]:text-foreground [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-background [&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:font-mono [&_pre]:text-[0.92em] [&_pre_code]:rounded-none [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        },
      },
      onUpdate: ({ editor: tiptapEditor }) => {
        setDraft(tiptapEditor.getMarkdown())
      },
    },
    []
  )

  // A new active version (save, approval, concurrent edit) replaces the doc
  // so the editor never shows stale text as "yours". Guarded by a ref so it
  // never fires on mount — the initial content is set at editor creation, and
  // a mount-time setContent can land before the editor view exists (or on a
  // strict-mode remount after it's destroyed).
  const lastAppliedVersion = useRef(activeVersion)
  const staleNoticeVersion = useRef(activeVersion)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (lastAppliedVersion.current === activeVersion) return
    // The new version matches the draft — this is the author's own save
    // landing. Reconcile silently (no setContent, so the cursor stays put).
    if (draft !== null && draft === activeContent) {
      lastAppliedVersion.current = activeVersion
      staleNoticeVersion.current = activeVersion
      setDraft(null)
      return
    }
    // A differing draft is in progress: keep it instead of silently
    // clobbering the author's work. Saving still sends the draft's base
    // version, so the server conflicts and forces an explicit reload;
    // Discard resyncs.
    if (draft !== null) {
      if (staleNoticeVersion.current !== activeVersion) {
        staleNoticeVersion.current = activeVersion
        toast.info(
          "The instructions changed while you were editing — saving will ask you to reload."
        )
      }
      return
    }
    lastAppliedVersion.current = activeVersion
    staleNoticeVersion.current = activeVersion
    editor.commands.setContent(activeContent, { contentType: "markdown" })
    setDraft(null)
  }, [activeVersion, activeContent, editor, draft])

  const editorValue = draft ?? activeContent
  const editorTokens = estimateTokens(editorValue)
  const overLimit = editorTokens > MAX_TOKENS
  const hasChanges = draft !== null && draft !== activeContent
  const isEmpty = editorValue.trim().length === 0

  const discard = () => {
    if (!editor) return
    lastAppliedVersion.current = activeVersion
    staleNoticeVersion.current = activeVersion
    editor.commands.setContent(activeContent, { contentType: "markdown" })
    setDraft(null)
  }

  // The transparent border turns ring-colored on focus, like an Input.
  return (
    <div
      className={cn(
        SETTINGS_SURFACE,
        "border border-transparent transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/24"
      )}
    >
      <div className="relative">
        {isEmpty && (
          <span className="pointer-events-none absolute top-3 left-4 text-sm text-muted-foreground">
            e.g. Answer in English. Prefer linking Linear issues over quoting
            them. In #engineering, always link the PR.
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
      <div className="mx-4 flex items-center justify-between gap-2 border-border border-t py-2.5">
        <span
          className={cn(
            "text-xs tabular-nums",
            overLimit ? "text-destructive" : "text-muted-foreground"
          )}
        >
          ~{editorTokens.toLocaleString()} / {MAX_TOKENS.toLocaleString()}{" "}
          tokens
        </span>
        <div className="flex gap-2">
          {hasChanges && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(PILL_BUTTON, "px-3")}
              onClick={discard}
              disabled={isSaving}
            >
              Discard
            </Button>
          )}
          <Button
            size="sm"
            className={cn(PILL_BUTTON, "px-3")}
            disabled={!hasChanges || overLimit}
            loading={isSaving}
            onClick={() => onSave(editorValue, lastAppliedVersion.current)}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

export function InstructionsSection({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
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

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["workspace-instructions", workspaceSlug],
    })

  const conflictToast = (message: string) => {
    toast.error(message)
    void refetch()
  }

  const save = useMutation({
    mutationFn: async ({
      content,
      baseVersion,
    }: {
      content: string
      baseVersion: number | null
    }) => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].instructions.$put({
        param: { workspaceSlug },
        json: { content, baseVersion },
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
        "Instructions updated — Lor follows them from its next answer"
      )
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
        <Spinner className="size-5 text-muted-foreground" />
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

  const pending = data.pending
  const pendingIsStale =
    pending !== null && pending.baseVersion !== activeVersion
  const history = data.versions.filter((v) => v.state !== "pending")
  const shownHistory = historyOpen ? history : history.slice(0, HISTORY_PREVIEW)

  return (
    <div className="space-y-8">
      {pending && (
        <SettingsSection
          title="Lor proposed a change"
          action={
            <span className="text-xs text-muted-foreground">
              v{pending.version} · {formatWhen(pending.createdAt)}
            </span>
          }
          caption={
            data.canApprove
              ? undefined
              : "An admin needs to approve it before Lor follows it."
          }
        >
          <div className={cn(SETTINGS_SURFACE, "space-y-3 p-4")}>
            {pending.rationale && (
              <p className="text-sm">{pending.rationale}</p>
            )}
            {pendingIsStale && (
              <p className="text-xs text-destructive">
                The active instructions changed after this was proposed —
                approving is blocked. Review the proposal and re-apply what's
                still wanted as a direct edit, or reject it.
              </p>
            )}
            <DiffView before={activeContent} after={pending.content} />
            {data.canApprove && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(PILL_BUTTON, "px-3")}
                  disabled={reject.isPending || approve.isPending}
                  onClick={() => reject.mutate(pending.version)}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  className={cn(PILL_BUTTON, "px-3")}
                  disabled={
                    approve.isPending || reject.isPending || pendingIsStale
                  }
                  onClick={() => approve.mutate(pending.version)}
                >
                  Approve
                </Button>
              </div>
            )}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Instructions"
        caption="Lor follows these in every answer: tone, priorities, team conventions. Lor can propose changes, and they only take effect after an admin approves them."
      >
        {data.canManage ? (
          <InstructionsEditor
            key={workspaceSlug}
            activeContent={activeContent}
            activeVersion={activeVersion}
            onSave={(content, baseVersion) =>
              save.mutate({ content, baseVersion })
            }
            isSaving={save.isPending}
          />
        ) : activeContent ? (
          <pre
            className={cn(
              SETTINGS_SURFACE,
              "px-4 py-3 font-mono text-xs whitespace-pre-wrap"
            )}
          >
            {activeContent}
          </pre>
        ) : (
          <div
            className={cn(
              SETTINGS_SURFACE,
              "px-4 py-3 text-sm text-muted-foreground"
            )}
          >
            No instructions set yet.
          </div>
        )}
      </SettingsSection>

      {history.length > 0 && (
        <SettingsSection
          title="Version history"
          count={history.length}
          action={
            history.length > HISTORY_PREVIEW && (
              <button
                type="button"
                onClick={() => setHistoryOpen((open) => !open)}
                className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
              >
                {historyOpen ? "Show less" : "View all"}
              </button>
            )
          }
        >
          <SettingsGroup>
            {shownHistory.map((v) => (
              <div key={v.version} className="flex items-center gap-3 py-3">
                <span className="w-8 shrink-0 text-sm font-medium tabular-nums">
                  v{v.version}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {v.authorType === "agent"
                    ? "Lor"
                    : (v.authorName ?? "Unknown")}{" "}
                  · {formatWhen(v.createdAt)}
                </span>
                {v.state === "active" ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-success"
                    />
                    {STATE_LABELS.active}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {STATE_LABELS[v.state]}
                  </span>
                )}
              </div>
            ))}
          </SettingsGroup>
        </SettingsSection>
      )}
    </div>
  )
}
