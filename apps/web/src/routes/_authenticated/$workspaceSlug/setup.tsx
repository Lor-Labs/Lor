import { Button } from "@repo/ui/components/button"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import {
  AskLorSuggestions,
  ConnectStep,
  InviteStep,
} from "@/components/setup/setup-steps"
import { MorphText } from "@/components/ui/morph-text"
import { DomainJoinSwitch } from "@/components/workspace/domain-join-switch"
import {
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { useInviteAccess } from "@/hooks/use-invite-access"
import { useWorkspaceSetup } from "@/hooks/use-workspace-setup"
import { apiClient } from "@/lib/api-client"
import { isAppFocused, subscribeAppFocus } from "@/lib/app-focus"
import { integrationsQueryOptions } from "@/lib/integrations-query"
import {
  firstTextChannelId,
  textChannelIdNamed,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

export const Route = createFileRoute("/_authenticated/$workspaceSlug/setup")({
  component: SetupPage,
})

// The browser callback may still be saving the connection on switch-back.
const CONNECT_RECHECK_MS = 5000

function lorSuggestions(github: boolean, linear: boolean) {
  const suggestions: string[] = []
  if (github) {
    suggestions.push(
      "What changed in our repos this week?",
      "Which pull requests are waiting on review?"
    )
  }
  if (linear) suggestions.push("What's in progress in Linear right now?")
  suggestions.push(
    "What do you know about our team so far?",
    "What can you help us with?"
  )
  return suggestions.slice(0, 3)
}

// First-run checklist for whoever can manage connectors. Every done state is
// read from data (connections, members), so nothing here is stored.
function SetupPage() {
  const { workspaceSlug } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status, workspace, members } = useWorkspaceSetup(workspaceSlug)
  const { canInvite } = useInviteAccess(workspaceSlug)
  const { data: channels } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )
  const integrations = useQuery(integrationsQueryOptions(workspaceSlug))
  const refetchIntegrations = integrations.refetch

  useEffect(() => {
    if (status !== "no-access") return
    void navigate({
      to: "/$workspaceSlug",
      params: { workspaceSlug },
      replace: true,
    })
  }, [status, workspaceSlug, navigate])

  // The desktop app connects in the system browser and gets no redirect
  // back, and teammates join from elsewhere: re-read both on focus.
  useEffect(() => {
    let wasFocused = isAppFocused()
    let recheck: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeAppFocus((focused) => {
      if (focused && !wasFocused) {
        void refetchIntegrations({ cancelRefetch: false })
        void queryClient.invalidateQueries({
          queryKey: ["workspace-members", workspaceSlug],
        })
        clearTimeout(recheck)
        recheck = setTimeout(
          () => void refetchIntegrations({ cancelRefetch: false }),
          CONNECT_RECHECK_MS
        )
      }
      wasFocused = focused
    })
    return () => {
      clearTimeout(recheck)
      unsubscribe()
    }
  }, [refetchIntegrations, queryClient, workspaceSlug])

  const finish = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].setup.complete.$post({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to finish setup")
    },
    onSuccess: async () => {
      // Refetched before leaving, so the workspace root doesn't send us back.
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      const channelId = channels ? firstTextChannelId(channels) : null
      await navigate(
        channelId
          ? {
              to: "/$workspaceSlug/$channelId",
              params: { workspaceSlug, channelId },
            }
          : { to: "/$workspaceSlug", params: { workspaceSlug } }
      )
    },
    onError: () => toast.error("Couldn't finish setup"),
  })

  const providers = integrations.data?.providers ?? []
  const github = providers.find((p) => p.id === "github")
  const linear = providers.find((p) => p.id === "linear")
  const joinedNames = (members?.members ?? [])
    .filter((m) => !m.isBot && m.userId !== members?.ownerId)
    .map((m) => m.name)
  const anyDone =
    !!github?.connected || !!linear?.connected || joinedNames.length > 0

  const askChannelId = channels
    ? (textChannelIdNamed(channels, "engineering") ??
      firstTextChannelId(channels))
    : null
  // A question for Lor opens the New session view with it filled in.
  const askLor = (question: string) => {
    void navigate({
      to: "/$workspaceSlug/session/new",
      params: { workspaceSlug },
      search: {
        draft: question,
        ...(askChannelId ? { channelId: askChannelId } : {}),
      },
    })
  }

  const isLoading = status === "loading" || integrations.isPending

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <HeaderNavControls className="-ml-2" />
        <span className="text-sm font-medium">Setup</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-[560px] space-y-8 px-6 pt-[8vh] pb-16">
            <div className="space-y-1.5 px-4">
              <h1 className="text-xl font-semibold tracking-tight">
                Set up {workspace?.name ?? "your workspace"}
              </h1>
              <p className="text-sm text-muted-foreground">
                A few steps so Lor can help your team from day one.
              </p>
            </div>

            <div>
              <SettingsGroup>
                {github && (
                  <ConnectStep
                    workspaceSlug={workspaceSlug}
                    provider={github}
                    title="Connect GitHub"
                    pitch="Lor reads your code and reviews pull requests."
                  />
                )}
                {linear && (
                  <ConnectStep
                    workspaceSlug={workspaceSlug}
                    provider={linear}
                    title="Connect Linear"
                    pitch="Lor finds, files, and updates your issues."
                  />
                )}
                {canInvite && (
                  <InviteStep
                    workspaceSlug={workspaceSlug}
                    joinedNames={joinedNames}
                  />
                )}
              </SettingsGroup>
              {workspace && <DomainJoinSwitch workspace={workspace} branch />}
            </div>

            <SettingsSection title="Ask Lor">
              <AskLorSuggestions
                suggestions={lorSuggestions(
                  !!github?.connected,
                  !!linear?.connected
                )}
                onAsk={askLor}
                disabled={!askChannelId}
              />
            </SettingsSection>

            <div className="flex justify-end px-4">
              <Button
                variant={anyDone ? "default" : "ghost"}
                disabled={finish.isPending}
                onClick={() => finish.mutate()}
              >
                <MorphText>
                  {anyDone ? "Finish setup" : "Do this later"}
                </MorphText>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
