import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Shield, Users } from "lucide-react"
import { useEffect } from "react"
import { toast } from "sonner"
import { SocketProvider, useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { writePendingInvite } from "@/lib/pending-invite"
import { hasValidUsername } from "@/lib/username"

export const Route = createFileRoute("/invite/$code")({
  component: InvitePage,
})

function InvitePage() {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const hasUsername = hasValidUsername(session?.user?.username)

  return (
    <SocketProvider enabled={!!session}>
      <InviteCard
        userId={session?.user.id ?? null}
        sessionPending={sessionPending}
        hasUsername={hasUsername}
      />
    </SocketProvider>
  )
}

function InviteCard({
  userId,
  sessionPending,
  hasUsername,
}: {
  userId: string | null
  sessionPending: boolean
  hasUsername: boolean
}) {
  const isAuthenticated = userId !== null
  const { code } = Route.useParams()
  const navigate = useNavigate()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const invitePath = `/invite/${code}`

  const {
    data: preview,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["invite-preview", code, userId],
    queryFn: async () => {
      const res = await apiClient.v1.invites[":code"].$get({
        param: { code },
      })
      if (!res.ok) {
        throw new Error("Invite not found")
      }
      return res.json()
    },
  })

  // A signed-in user who hasn't chosen a username yet is sent through
  // onboarding first (username → pre-filled join), so stash the code and hand
  // off to the dialog under _authenticated. Users who already have an identity
  // keep the inline accept card below.
  useEffect(() => {
    if (
      isAuthenticated &&
      !hasUsername &&
      preview &&
      !preview.invite.isMember &&
      !preview.invite.isExpired
    ) {
      writePendingInvite(code)
      navigate({ to: "/" })
    }
  }, [isAuthenticated, hasUsername, preview, code, navigate])

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.invites[":code"].accept.$post({
        param: { code },
      })
      if (!res.ok) {
        const body = await res.text()
        let message = "Failed to join workspace"
        try {
          const parsed = JSON.parse(body) as { message?: string }
          if (typeof parsed.message === "string") message = parsed.message
        } catch {
          // use default
        }
        throw new Error(message)
      }
      return res.json()
    },
    onSuccess: (data) => {
      if (socket?.connected) {
        socket.emit("workspace:member:joined", {
          workspaceId: data.workspace.id,
        })
      }
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      toast.success(`Joined ${data.workspace.name}!`)
      navigate({
        to: "/$workspaceSlug",
        params: { workspaceSlug: data.workspace.slug },
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to join workspace"
      )
    },
  })

  function goHome() {
    navigate({ to: "/" })
  }

  const isLoading = isPending || sessionPending

  // Error / expired states
  let errorContent: { title: string; description: string } | null = null

  if (!isPending && (isError || !preview)) {
    errorContent = {
      title: "Invalid Invite",
      description: "This invite link is invalid or has expired.",
    }
  } else if (!isPending && preview?.invite.isExpired) {
    errorContent = {
      title: "Invite Expired",
      description: "This invite link has expired or reached its maximum uses.",
    }
  }

  if (errorContent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 shadow-2xl">
          <Shield className="size-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{errorContent.title}</h2>
          <p className="text-sm text-muted-foreground">
            {errorContent.description}
          </p>
          <Button variant="outline" onClick={goHome}>
            Go Home
          </Button>
        </div>
      </div>
    )
  }

  const invite = preview?.invite

  let cta = null
  if (invite) {
    if (invite.isMember) {
      cta = (
        <Button
          className="w-full"
          onClick={() =>
            navigate({
              to: "/$workspaceSlug",
              params: { workspaceSlug: invite.workspace.slug },
            })
          }
        >
          Already a Member — Go to Workspace
        </Button>
      )
    } else if (isAuthenticated) {
      cta = (
        <Button
          className="w-full"
          onClick={() => acceptMutation.mutate()}
          disabled={acceptMutation.isPending}
        >
          {acceptMutation.isPending ? "Joining..." : "Accept Invite"}
        </Button>
      )
    } else {
      cta = (
        <div className="grid w-full gap-3">
          <Button asChild className="w-full">
            <Link to="/signup" search={{ redirect: invitePath }}>
              Sign Up to Join
            </Link>
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to="/login"
              search={{ redirect: invitePath }}
              className="underline underline-offset-4 hover:text-primary"
            >
              Sign in
            </Link>
          </p>
        </div>
      )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading invite...
          </div>
        ) : invite ? (
          <div className="flex flex-col items-center gap-4 text-center">
            {invite.workspace.logo ? (
              <img
                src={invite.workspace.logo}
                alt={invite.workspace.name}
                className="size-16 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                {invite.workspace.name.charAt(0).toUpperCase()}
              </div>
            )}

            <div>
              <h2 className="text-lg font-semibold">{invite.workspace.name}</h2>
              <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
                <Users className="size-3.5" />
                {invite.workspace.memberCount}{" "}
                {invite.workspace.memberCount === 1 ? "member" : "members"}
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {invite.inviter.name}
              </span>{" "}
              invited you to join
            </p>

            {cta}
          </div>
        ) : null}
      </div>
    </div>
  )
}
