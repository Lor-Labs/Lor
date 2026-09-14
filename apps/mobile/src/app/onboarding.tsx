import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { sluggify } from "@repo/utils/slug"
import { Redirect, router } from "expo-router"
import { Spinner } from "heroui-native/spinner"
import { useEffect, useState } from "react"
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
import { authClient } from "@/lib/auth-client"
import { parseInviteCode } from "@/lib/invites"

type Step = "welcome" | "create" | "join"

function normalizeSlugInput(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

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

  const [workspaceName, setWorkspaceName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [inviteLink, setInviteLink] = useState("")

  useEffect(() => {
    if (!slugEdited) setSlug(sluggify(workspaceName))
  }, [workspaceName, slugEdited])

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
    const normalizedSlug = sluggify(slug)
    if (!workspaceName.trim() || !normalizedSlug || isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await authClient.organization.create({
        name: workspaceName.trim(),
        slug: normalizedSlug,
      })
      if (result.error) {
        setError(
          (result.error.message ?? "Could not create the workspace").replace(
            /organization/gi,
            "Workspace"
          )
        )
        return
      }
      if (result.data) await reloadWorkspaces(result.data.id)
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
                  Get started by creating a new workspace or joining one you’ve
                  been invited to.
                </Text>
              </View>
              <View className="gap-three">
                <OptionCard
                  detail="Start your own community from scratch"
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
                  detail="Enter an invite link to join a workspace"
                  icon={
                    <HugeiconsIcon
                      color={theme.accent}
                      icon={UserGroupIcon}
                      size={20}
                    />
                  }
                  label="Join an existing workspace"
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
                  Give your community a name and a unique URL.
                </Text>
              </View>
              <View className="gap-four">
                <View className="gap-two">
                  <Text className="text-[13px] font-semibold text-muted">
                    Workspace name
                  </Text>
                  <TextInput
                    accessibilityLabel="Workspace name"
                    className={inputClassName}
                    onChangeText={setWorkspaceName}
                    placeholder="My Awesome Workspace"
                    placeholderTextColor={theme.textTertiary}
                    value={workspaceName}
                  />
                </View>
                <View className="gap-two">
                  <Text className="text-[13px] font-semibold text-muted">
                    Slug
                  </Text>
                  <TextInput
                    accessibilityLabel="Workspace slug"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className={inputClassName}
                    onChangeText={(value) => {
                      setSlugEdited(true)
                      setSlug(normalizeSlugInput(value))
                    }}
                    placeholder="my-awesome-workspace"
                    placeholderTextColor={theme.textTertiary}
                    value={slug}
                  />
                  {sluggify(slug) ? (
                    <Text className="text-xs text-muted">
                      lor.chat/{sluggify(slug)}
                    </Text>
                  ) : null}
                </View>
              </View>
              {error ? (
                <Text className="text-sm font-medium text-danger">{error}</Text>
              ) : null}
              <Button
                isDisabled={
                  isSubmitting || !workspaceName.trim() || !sluggify(slug)
                }
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
                  Paste an invite link or code to join an existing workspace.
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
