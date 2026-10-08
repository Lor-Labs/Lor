import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { normalizeDomain } from "@repo/utils/domain"
import { Redirect, router } from "expo-router"
import { Spinner } from "heroui-native/spinner"
import { useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native"
import { Button } from "@/components/ui/button"
import { Screen } from "@/components/ui/screen"
import { useWorkspace } from "@/context/workspace-context"
import { useTheme } from "@/hooks/use-theme"
import { api, responseMessage } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { parseInviteCode } from "@/lib/invites"

type Step = "welcome" | "create" | "join"

export default function OnboardingScreen() {
  const theme = useTheme()
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const {
    workspaces,
    isLoading: isWorkspaceLoading,
    reloadWorkspaces,
  } = useWorkspace()
  const hasWorkspace = workspaces.length > 0

  const [step, setStep] = useState<Step>("welcome")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [website, setWebsite] = useState("")
  const [workspaceName, setWorkspaceName] = useState("")
  const [description, setDescription] = useState("")
  const [inviteLink, setInviteLink] = useState("")

  if (isSessionPending || isWorkspaceLoading) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center">
          <Spinner accessibilityLabel="Loading" />
        </View>
      </Screen>
    )
  }
  if (!session) return <Redirect href="/sign-in" />

  const createWorkspace = async () => {
    if (!workspaceName.trim() || isSubmitting) return
    if (website.trim() && !normalizeDomain(website)) {
      setError("Enter a website like acme.com")
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      const response = await api.v1.workspaces.$post({
        json: {
          name: workspaceName.trim(),
          description: description.trim() || undefined,
          website: website.trim() || undefined,
        },
      })
      if (!response.ok) {
        setError(
          await responseMessage(response, "Could not create the workspace")
        )
        return
      }
      const { workspace } = await response.json()
      await reloadWorkspaces(workspace.id)
      router.replace("/")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const joinWorkspace = () => {
    const code = parseInviteCode(inviteLink)
    if (!code) {
      setError("Enter a valid invite link or invite code.")
      return
    }
    setError(null)
    router.push({ pathname: "/invite/[code]", params: { code } })
  }

  const goToStep = (nextStep: Step) => {
    setError(null)
    setStep(nextStep)
  }

  const inputClassName =
    "min-h-[52px] rounded-lor-md border border-border bg-surface px-three text-base text-foreground"

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow justify-center px-seven py-seven"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === "welcome" ? (
            <View className="gap-six">
              {router.canGoBack() ? (
                <BackLink onPress={() => router.back()} />
              ) : null}
              <View className="gap-two">
                <Text className="text-[28px] font-bold tracking-[-0.6px] text-foreground">
                  {hasWorkspace ? "Add a workspace" : "Welcome to Lor"}
                </Text>
                <Text className="text-base leading-[22px] text-muted">
                  Create a workspace for your team, or join one you’ve been
                  invited to.
                </Text>
              </View>
              <View className="gap-three">
                <OptionCard
                  detail="Set up Lor for your team"
                  icon={
                    <HugeiconsIcon
                      color={theme.accent}
                      icon={PlusSignIcon}
                      size={20}
                    />
                  }
                  label="Create a workspace"
                  onPress={() => goToStep("create")}
                />
                <OptionCard
                  detail="Paste an invite link from a teammate"
                  icon={
                    <HugeiconsIcon
                      color={theme.accent}
                      icon={UserGroupIcon}
                      size={20}
                    />
                  }
                  label="Join with an invite"
                  onPress={() => goToStep("join")}
                />
              </View>
            </View>
          ) : null}

          {step === "create" ? (
            <View className="gap-six">
              <BackLink onPress={() => goToStep("welcome")} />
              <View className="gap-two">
                <Text className="text-[28px] font-bold tracking-[-0.6px] text-foreground">
                  Create a workspace
                </Text>
                <Text className="text-base leading-[22px] text-muted">
                  You can change these later in settings.
                </Text>
              </View>
              <View className="gap-four">
                <View className="gap-two">
                  <Text className="text-[13px] font-semibold text-muted">
                    Website
                  </Text>
                  <TextInput
                    accessibilityLabel="Website"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className={inputClassName}
                    inputMode="url"
                    onChangeText={setWebsite}
                    placeholder="acme.com"
                    placeholderTextColor={theme.textTertiary}
                    value={website}
                  />
                </View>
                <View className="gap-two">
                  <Text className="text-[13px] font-semibold text-muted">
                    Name
                  </Text>
                  <TextInput
                    accessibilityLabel="Workspace name"
                    className={inputClassName}
                    maxLength={100}
                    onChangeText={setWorkspaceName}
                    placeholder="Acme"
                    placeholderTextColor={theme.textTertiary}
                    value={workspaceName}
                  />
                </View>
                <View className="gap-two">
                  <Text className="text-[13px] font-semibold text-muted">
                    What are you building?
                  </Text>
                  <TextInput
                    accessibilityLabel="What are you building?"
                    className={inputClassName}
                    maxLength={280}
                    onChangeText={setDescription}
                    placeholder="Payments infrastructure for marketplaces"
                    placeholderTextColor={theme.textTertiary}
                    value={description}
                  />
                  <Text className="text-xs text-muted">
                    Optional. Lor reads this to understand your team.
                  </Text>
                </View>
              </View>
              {error ? (
                <Text className="text-sm font-medium text-danger">{error}</Text>
              ) : null}
              <Button
                isDisabled={isSubmitting || !workspaceName.trim()}
                onPress={() => void createWorkspace()}
              >
                {isSubmitting ? "Creating…" : "Create workspace"}
              </Button>
            </View>
          ) : null}

          {step === "join" ? (
            <View className="gap-six">
              <BackLink onPress={() => goToStep("welcome")} />
              <View className="gap-two">
                <Text className="text-[28px] font-bold tracking-[-0.6px] text-foreground">
                  Join a workspace
                </Text>
                <Text className="text-base leading-[22px] text-muted">
                  Paste the invite link or code a teammate sent you.
                </Text>
              </View>
              <View className="gap-two">
                <TextInput
                  accessibilityLabel="Invite link or code"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className={inputClassName}
                  onChangeText={setInviteLink}
                  placeholder="https://app.lor.chat/invite/abc123 or abc123"
                  placeholderTextColor={theme.textTertiary}
                  value={inviteLink}
                />
              </View>
              {error ? (
                <Text className="text-sm font-medium text-danger">{error}</Text>
              ) : null}
              <Button isDisabled={!inviteLink.trim()} onPress={joinWorkspace}>
                Join workspace
              </Button>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function OptionCard({
  detail,
  icon,
  label,
  onPress,
}: {
  detail: string
  icon: React.ReactNode
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="flex-row items-center gap-three rounded-lor-md border border-border bg-surface p-four active:bg-surface-secondary"
      onPress={onPress}
    >
      <View className="size-10 items-center justify-center rounded-lor-sm bg-accent-soft">
        {icon}
      </View>
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-base font-semibold text-foreground">{label}</Text>
        <Text className="text-sm text-muted">{detail}</Text>
      </View>
    </Pressable>
  )
}

function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Back"
      accessibilityRole="button"
      className="min-h-8 flex-row items-center gap-one self-start active:opacity-70"
      onPress={onPress}
    >
      <Text className="text-sm font-medium text-muted">← Back</Text>
    </Pressable>
  )
}
