import {
  AlertCircleIcon,
  Shield01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"
import { PasswordInput } from "@/components/auth/password-input"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import { SocketProvider, useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import { acceptInvitation } from "@/lib/invitations"

export const Route = createFileRoute("/invitations/$invitationId")({
  component: InvitationPage,
  validateSearch: (search: Record<string, unknown>): { sig: string } => ({
    sig: typeof search.sig === "string" ? search.sig : "",
  }),
})

function InvitationPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession()

  return (
    <SocketProvider enabled={!!session}>
      <InvitationCard
        sessionEmail={session?.user.email ?? null}
        sessionUserId={session?.user.id ?? null}
        sessionPending={sessionPending}
      />
    </SocketProvider>
  )
}

// Email invites from better-auth's organization plugin. A new account made
// here starts verified: the signed link proves the inbox (see databaseHooks
// in packages/auth/src/lib/auth.ts).
function InvitationCard({
  sessionEmail,
  sessionUserId,
  sessionPending,
}: {
  sessionEmail: string | null
  sessionUserId: string | null
  sessionPending: boolean
}) {
  const { invitationId } = Route.useParams()
  const { sig } = Route.useSearch()
  const navigate = useNavigate()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const invitationPath = `/invitations/${invitationId}?sig=${encodeURIComponent(sig)}`

  const preview = useQuery({
    queryKey: ["invitation-preview", invitationId, sessionUserId],
    queryFn: async () => {
      const res = await apiClient.v1.invitations[":invitationId"].$get({
        param: { invitationId },
        query: { sig },
      })
      if (!res.ok) throw new Error("Invitation not found")
      return (await res.json()).invitation
    },
    placeholderData: (previous) => previous,
  })
  const invitation = preview.data

  const onJoined = (workspace: { id: string; name: string; slug: string }) => {
    if (socket?.connected) {
      socket.emit("workspace:member:joined", { workspaceId: workspace.id })
    }
    void queryClient.invalidateQueries({ queryKey: ["workspaces"] })
    toast.success(`Joined ${workspace.name}`)
    void navigate({
      to: "/$workspaceSlug",
      params: { workspaceSlug: workspace.slug },
    })
  }

  const accept = useMutation({
    mutationFn: () => acceptInvitation(invitationId),
    onSuccess: onJoined,
    onError: (error) => toast.error(error.message),
  })

  const signUp = useMutation({
    mutationFn: async (email: string) => {
      // Not inlined: the client type omits the invite fields, which the
      // sign-up hook in packages/auth reads to mark the email verified.
      const body = {
        name: name.trim(),
        email,
        password,
        invitationId,
        invitationSig: sig,
      }
      const signedUp = await authClient.signUp.email(body)
      if (signedUp.error) {
        throw new Error(
          signedUp.error.message ?? "Couldn't create your account"
        )
      }
      const signedIn = await authClient.signIn.email({ email, password })
      if (signedIn.error) {
        throw new Error(signedIn.error.message ?? "Couldn't sign you in")
      }
      return acceptInvitation(invitationId)
    },
    onSuccess: onJoined,
  })

  const signOut = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut()
      if (error) throw new Error("Couldn't sign out")
    },
    onSuccess: () => queryClient.clear(),
    onError: (error) => toast.error(error.message),
  })

  if (preview.isError || invitation?.isExpired) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-8 shadow-2xl">
          <HugeiconsIcon
            icon={Shield01Icon}
            className="size-12 text-muted-foreground"
            strokeWidth={2}
          />
          <h2 className="text-lg font-semibold">Invite Unavailable</h2>
          <p className="max-w-xs text-center text-sm text-muted-foreground">
            This invite has expired or was revoked. Ask your teammate to send a
            new one.
          </p>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            Go Home
          </Button>
        </div>
      </div>
    )
  }

  const joining = accept.isPending || signUp.isPending
  let cta = null
  if (invitation?.isMember) {
    cta = (
      <Button
        className="w-full"
        onClick={() =>
          navigate({
            to: "/$workspaceSlug",
            params: { workspaceSlug: invitation.workspace.slug },
          })
        }
      >
        Already a Member — Go to Workspace
      </Button>
    )
    // signUp signs in before it accepts; keep the form up until it finishes.
  } else if (invitation && (signUp.isPending || !sessionEmail)) {
    cta = invitation.hasAccount ? (
      <Button
        className="w-full"
        render={<Link to="/login" search={{ redirect: invitationPath }} />}
      >
        Sign In to Join
      </Button>
    ) : (
      <form
        className="grid w-full gap-4 text-left"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          signUp.mutate(invitation.email)
        }}
      >
        {signUp.error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              className="size-4 shrink-0"
              strokeWidth={2}
            />
            <span>{signUp.error.message}</span>
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="invite-email">Email</Label>
          <Input id="invite-email" value={invitation.email} disabled />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite-name">Display Name</Label>
          <Input
            id="invite-name"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite-password">Password</Label>
          <PasswordInput
            id="invite-password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete="new-password"
            required
          />
        </div>
        <Button type="submit" disabled={joining}>
          {joining && <Spinner className="size-4" />}
          {joining ? "Joining..." : "Create Account and Join"}
        </Button>
      </form>
    )
  } else if (invitation && sessionEmail === invitation.email) {
    cta = (
      <Button
        className="w-full"
        onClick={() => accept.mutate()}
        disabled={joining}
      >
        {joining ? "Joining..." : "Accept Invite"}
      </Button>
    )
  } else if (invitation && sessionEmail) {
    cta = (
      <div className="grid w-full gap-3">
        <p className="text-sm text-muted-foreground">
          This invite is for{" "}
          <span className="font-medium text-foreground">
            {invitation.email}
          </span>
          . You're signed in as {sessionEmail}.
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          Sign Out to Continue
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl">
        {preview.isPending || sessionPending ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading invite...
          </div>
        ) : invitation ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <WorkspaceAvatar
              name={invitation.workspace.name}
              logo={invitation.workspace.logo}
              className="size-16 rounded-2xl text-2xl"
              imgClassName="rounded-xl"
            />
            <div>
              <h2 className="text-lg font-semibold">
                {invitation.workspace.name}
              </h2>
              <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
                <HugeiconsIcon
                  icon={UserGroupIcon}
                  className="size-3.5"
                  strokeWidth={2}
                />
                {invitation.workspace.memberCount}{" "}
                {invitation.workspace.memberCount === 1 ? "member" : "members"}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {invitation.inviter.name}
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
