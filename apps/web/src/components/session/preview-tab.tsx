import {
  ArrowReloadHorizontalIcon,
  Copy01Icon,
  LinkSquare02Icon,
  StopIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// A code session's dev server in an iframe (reference/dev-environment-runbook.md
// §3). The iframe holds the sandbox awake (page requests, hot reload), so it
// unmounts after the page has been hidden a while; the dev server itself is
// frozen with the sandbox in standby and carries on when the iframe returns.

const HIDDEN_PAUSE_MS = 2 * 60_000

const previewKey = (sessionId: string) =>
  ["session-preview", sessionId] as const

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

// The browser tab hidden for HIDDEN_PAUSE_MS pauses the preview.
function useHiddenPause() {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const onVisibility = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (document.hidden) {
        timer = setTimeout(() => setPaused(true), HIDDEN_PAUSE_MS)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])
  return { paused, resume: () => setPaused(false) }
}

export function PreviewTab({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: previewKey(sessionId),
    queryFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].preview.$get({
        param: { sessionId },
      })
      if (!res.ok) throw await failure(res, "Couldn't load the preview")
      return res.json()
    },
  })
  const [command, setCommand] = useState<string | null>(null)
  const [port, setPort] = useState<string | null>(null)
  const [reloads, setReloads] = useState(0)
  const { paused, resume } = useHiddenPause()

  const start = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.sessions[":sessionId"].preview.$post({
        param: { sessionId },
        json: {
          command: (command ?? query.data?.suggestion?.command ?? "").trim(),
          port: Number(port ?? query.data?.suggestion?.port ?? 3000),
        },
      })
      if (!res.ok) throw await failure(res, "Couldn't start the preview")
      return res.json()
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: previewKey(sessionId) }),
    onError: (err) => toast.error(err.message),
  })

  const stop = useMutation({
    mutationFn: async (previewPort: number) => {
      const res = await apiClient.v1.sessions[":sessionId"].preview[
        ":port"
      ].$delete({ param: { sessionId, port: String(previewPort) } })
      if (!res.ok) throw await failure(res, "Couldn't stop the preview")
      return res.json()
    },
    onSuccess: (data) => queryClient.setQueryData(previewKey(sessionId), data),
    onError: (err) => toast.error(err.message),
  })

  if (query.isPending) {
    return (
      <PreviewNote>
        <Spinner className="size-4" />
      </PreviewNote>
    )
  }
  if (query.isError) {
    return (
      <PreviewNote>
        {query.error.message}
        <Button
          size="xs"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </PreviewNote>
    )
  }

  const preview = query.data.previews[0] ?? null
  if (!preview) {
    const suggestion = query.data.suggestion
    const commandValue = command ?? suggestion?.command ?? ""
    const portValue = port ?? String(suggestion?.port ?? 3000)
    return (
      <PreviewNote>
        <form
          className="w-full max-w-md space-y-3 text-left"
          onSubmit={(e) => {
            e.preventDefault()
            if (commandValue.trim()) start.mutate()
          }}
        >
          <p className="text-center text-foreground text-sm">
            Run the app's dev server in this session's sandbox
          </p>
          <div className="space-y-1.5">
            <Label htmlFor={`preview-command-${sessionId}`}>Command</Label>
            <Input
              id={`preview-command-${sessionId}`}
              value={commandValue}
              placeholder="pnpm dev"
              className="font-mono text-xs"
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`preview-port-${sessionId}`}>Port</Label>
            <Input
              id={`preview-port-${sessionId}`}
              value={portValue}
              inputMode="numeric"
              className="w-28 font-mono text-xs"
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            loading={start.isPending}
            disabled={!commandValue.trim()}
          >
            {start.isPending ? "Starting dev server…" : "Start preview"}
          </Button>
          <p className="text-center text-muted-foreground text-xs">
            It reads the session's environment files. Lor can see the preview's
            output in the sandbox too.
          </p>
        </form>
      </PreviewNote>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-1 border-border/70 border-b px-3 text-[13px]">
        <span
          className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs"
          title={preview.url}
        >
          {preview.url.replace(/\?.*$/, "")}
        </span>
        <ToolbarButton
          label="Reload"
          icon={ArrowReloadHorizontalIcon}
          onClick={() => setReloads((n) => n + 1)}
        />
        <ToolbarButton
          label="Copy URL"
          icon={Copy01Icon}
          onClick={() =>
            void navigator.clipboard
              .writeText(preview.url)
              .then(() => toast.success("Preview URL copied"))
          }
        />
        <ToolbarButton
          label="Open in browser"
          icon={LinkSquare02Icon}
          onClick={() => void openExternal(preview.url)}
        />
        <ToolbarButton
          label="Stop dev server"
          icon={StopIcon}
          disabled={stop.isPending}
          onClick={() => stop.mutate(preview.port)}
        />
      </div>
      {paused ? (
        <PreviewNote>
          Paused while this page was hidden, so the sandbox can sleep. The dev
          server is still there.
          <Button size="xs" variant="outline" onClick={resume}>
            Resume
          </Button>
        </PreviewNote>
      ) : (
        <iframe
          key={reloads}
          title="Preview"
          src={preview.url}
          className="min-h-0 w-full flex-1 border-0 bg-white"
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  )
}

function ToolbarButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof Copy01Icon
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <HugeiconsIcon icon={icon} className="size-3.5" strokeWidth={2} />
    </button>
  )
}

function PreviewNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center text-muted-foreground text-sm">
      {children}
    </div>
  )
}
