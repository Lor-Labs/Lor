import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useMemo } from "react"
import { useSessionBrowserSharedAnnotations } from "@/components/sidebar/right-panel/session-browser-annotations"
import {
  BrowserPresence,
  type BrowserViewSource,
  SessionBrowserLiveView,
  useSessionBrowserLive,
} from "@/components/sidebar/right-panel/session-browser-live-view"
import { apiClient } from "@/lib/api-client"

// A preview link's page (reference/planned/sandbox-browser-runbook.md §8):
// the session browser's live view with everyone's pointers and annotations,
// and nothing else of the session. A private link shows it to people in the
// workspace; a public one lets anyone watch, and signed-in Lor accounts point
// and annotate. Notes are sent to Lor from the app, never from here.

async function errorMessage(res: Response, fallback: string) {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return body?.message ?? fallback
}

async function readPreview(token: string) {
  const res = await apiClient.v1.previews[":token"].$get({ param: { token } })
  if (res.status === 404) return { status: "not_found" as const }
  if (!res.ok) throw new Error("Couldn't load this preview")
  return res.json()
}

type Preview = Awaited<ReturnType<typeof readPreview>>
type ReadyPreview = Extract<Preview, { status: "ready" }>

export function PreviewPage({ token }: { token: string }) {
  const { data: auth, isPending: authPending } = authClient.useSession()
  const userId = auth?.user.id ?? null
  const preview = useQuery({
    // Signing in changes what the link shows.
    queryKey: ["preview", token, userId],
    queryFn: () => readPreview(token),
    enabled: !authPending,
    retry: 1,
  })
  const signIn = (
    <Button
      size="sm"
      render={<Link to="/login" search={{ redirect: `/preview/${token}` }} />}
    >
      Sign in to Lor
    </Button>
  )

  if (authPending || preview.isPending) {
    return <PreviewNote title="Loading the preview…" />
  }
  if (preview.isError) {
    return (
      <PreviewNote title="Couldn't load this preview">
        <Button
          size="sm"
          variant="outline"
          onClick={() => void preview.refetch()}
        >
          Try again
        </Button>
      </PreviewNote>
    )
  }
  switch (preview.data.status) {
    case "not_found":
      return (
        <PreviewNote
          title="This preview link is off"
          text="It was turned off or has expired. Ask the person who shared it for a new one."
        />
      )
    case "sign_in_required":
      return (
        <PreviewNote
          title="Sign in to see this preview"
          text="It's private to the workspace it comes from."
        >
          {signIn}
        </PreviewNote>
      )
    case "no_access":
      return (
        <PreviewNote
          title="This preview is private"
          text={`It's open to people in its workspace, and ${auth?.user.email ?? "this account"} isn't one of them. Ask the person who shared it for a public link.`}
        />
      )
    case "ready":
      return (
        <PreviewView
          // A new sign-in gets a new grant.
          key={userId ?? "signed-out"}
          token={token}
          preview={preview.data}
          signIn={signIn}
        />
      )
  }
}

function PreviewView({
  token,
  preview,
  signIn,
}: {
  token: string
  preview: ReadyPreview
  signIn: ReactNode
}) {
  const { viewer } = preview
  const source = useMemo<BrowserViewSource>(() => {
    const route = apiClient.v1.previews[":token"]
    return {
      canControl: viewer.control,
      open: async () => {
        const res = await route.view.$post({ param: { token } })
        if (!res.ok) {
          throw new Error(await errorMessage(res, "Couldn't open the preview"))
        }
        return res.json()
      },
      seen: async (annotations) => {
        const res = await route.seen.$post({
          param: { token },
          json: { annotations },
        })
        if (!res.ok) throw new Error(await errorMessage(res, "Not recorded"))
      },
    }
  }, [token, viewer.control])
  // Members get the session's id, which taking control needs.
  const live = useSessionBrowserLive(preview.sessionId ?? "", "", true, source)
  const annotations = useSessionBrowserSharedAnnotations("", "", live, {
    canSend: false,
  })

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-border/70 border-b px-3">
        <img src="/lor-icon.png" alt="Lor" className="size-6 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{preview.title}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {preview.workspaceName} ·{" "}
            {preview.access === "public" ? "Public preview" : "Private preview"}
          </p>
        </div>
        <BrowserPresence people={live.people} myId={live.myId} />
        {live.watching > 0 && (
          <span className="shrink-0 text-muted-foreground text-xs">
            {live.watching} watching
          </span>
        )}
        {!viewer.signedIn && signIn}
        {preview.sessionId && preview.workspaceSlug && (
          <Button
            size="sm"
            variant="outline"
            render={
              <Link
                to="/$workspaceSlug/session/$sessionId"
                params={{
                  workspaceSlug: preview.workspaceSlug,
                  sessionId: preview.sessionId,
                }}
                search={{ side: "browser" }}
              />
            }
          >
            Open in Lor
          </Button>
        )}
      </header>
      {live.unavailable ? (
        <PreviewNote
          title="This preview isn't running"
          text="The session's sandbox was shut down, or it is older than preview links. Someone in the session can start it again from Lor."
        />
      ) : (
        <SessionBrowserLiveView
          live={live}
          annotations={viewer.annotate && live.collab ? annotations : undefined}
          page
          watchingNote={
            viewer.signedIn
              ? undefined
              : "Watching. Sign in to Lor to point and leave notes."
          }
        />
      )}
    </div>
  )
}

function PreviewNote({
  title,
  text,
  children,
}: {
  title: string
  text?: string
  children?: ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-background px-8 text-center text-foreground">
      <div className="space-y-1">
        <p className="font-medium text-sm">{title}</p>
        {text && (
          <p className="max-w-sm text-muted-foreground text-xs leading-relaxed">
            {text}
          </p>
        )}
      </div>
      {children}
    </div>
  )
}
