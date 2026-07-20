import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useQuery } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useState } from "react"
import { Text, View } from "react-native"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Screen } from "@/components/ui/screen"
import { StatePanel } from "@/components/ui/state-panel"
import { useSocket } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { setPendingInviteCode } from "@/lib/invites"

export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>()
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const { workspaces, selectWorkspace, reloadWorkspaces } = useWorkspace()
  const socket = useSocket()
  const muted = useThemeColor("muted")
  const [isJoining, setIsJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  const previewQuery = useQuery({
    queryKey: ["invite-preview", code ?? ""],
    enabled: Boolean(code),
    queryFn: async () => {
      const response = await api.v1.invites[":code"].$get({
        param: { code: code ?? "" },
      })
      if (!response.ok) throw new Error("Invite not found")
      const payload = await response.json()
      return payload.invite
    },
  })
  const invite = previewQuery.data ?? null

  const goHome = () => router.replace("/")

  const openWorkspace = async (slug: string) => {
    const existing = workspaces.find((workspace) => workspace.slug === slug)
    if (existing) await selectWorkspace(existing.id)
    goHome()
  }

  const acceptInvite = async () => {
    if (!code || isJoining) return
    setIsJoining(true)
    setJoinError(null)
    try {
      const response = await api.v1.invites[":code"].accept.$post({
        param: { code },
      })
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "Could not join this workspace")
        )
      }
      const payload = await response.json()
      if (socket?.connected) {
        socket.emit("workspace:member:joined", {
          workspaceId: payload.workspace.id,
        })
      }
      await reloadWorkspaces(payload.workspace.id)
      goHome()
    } catch (cause) {
      setJoinError(
        cause instanceof Error ? cause.message : "Could not join this workspace"
      )
      setIsJoining(false)
    }
  }

  const signInToJoin = () => {
    if (code) setPendingInviteCode(code)
    router.replace("/sign-in")
  }

  if (isSessionPending || (Boolean(code) && previewQuery.isPending)) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading invite" />
        </View>
      </Screen>
    )
  }

  if (!(code && invite)) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          action={{ label: "Go home", onPress: goHome }}
          className="flex-1"
          detail="This invite link is invalid or has expired."
          title="Invalid invite"
        />
      </Screen>
    )
  }

  if (invite.isExpired) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <StatePanel
          action={{ label: "Go home", onPress: goHome }}
          className="flex-1"
          detail="This invite link has expired or reached its maximum uses."
          title="Invite expired"
        />
      </Screen>
    )
  }

  const memberCountLabel = `${invite.workspace.memberCount} ${
    invite.workspace.memberCount === 1 ? "member" : "members"
  }`

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center px-six">
        <View className="w-full items-center gap-four rounded-lor-lg border border-border bg-surface px-five py-seven">
          <Avatar
            image={invite.workspace.logo}
            name={invite.workspace.name}
            shape="square"
            size="md"
          />
          <View className="items-center gap-one">
            <Text className="text-center text-[21px] font-bold tracking-[-0.4px] text-foreground">
              {invite.workspace.name}
            </Text>
            <View className="flex-row items-center gap-one">
              <HugeiconsIcon color={muted} icon={UserGroupIcon} size={14} />
              <Text className="text-[13px] font-medium text-muted">
                {memberCountLabel}
              </Text>
            </View>
          </View>
          <Text className="text-center text-sm text-muted">
            <Text className="font-semibold text-foreground">
              {invite.inviter.name}
            </Text>{" "}
            invited you to join
          </Text>
          {joinError ? (
            <Text className="text-center text-sm font-medium text-danger">
              {joinError}
            </Text>
          ) : null}
          <View className="w-full gap-two">
            {invite.isMember ? (
              <Button onPress={() => void openWorkspace(invite.workspace.slug)}>
                Already a member — open workspace
              </Button>
            ) : session ? (
              <Button
                isDisabled={isJoining}
                onPress={() => void acceptInvite()}
              >
                {isJoining ? "Joining…" : "Accept invite"}
              </Button>
            ) : (
              <Button onPress={signInToJoin}>Sign in to join</Button>
            )}
            <Button onPress={goHome} variant="ghost">
              Not now
            </Button>
          </View>
        </View>
      </View>
    </Screen>
  )
}

async function responseMessage(
  response: { text: () => Promise<string> },
  fallback: string
) {
  const responseText = await response.text()
  if (!responseText) return fallback
  try {
    const parsed = JSON.parse(responseText) as { message?: string }
    return typeof parsed.message === "string" ? parsed.message : fallback
  } catch {
    return fallback
  }
}
