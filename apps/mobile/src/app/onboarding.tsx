import { companyEmailDomain, normalizeDomain } from "@repo/utils/domain"
import { Redirect, router } from "expo-router"
import { SymbolView } from "expo-symbols"
import { Spinner } from "heroui-native/spinner"
import { type ComponentProps, type ReactNode, useState } from "react"
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native"
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { Screen } from "@/components/ui/screen"
import { WebsiteInput } from "@/components/website-input"
import { useWorkspace } from "@/context/workspace-context"
import { useTheme } from "@/hooks/use-theme"
import { api, responseMessage } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { parseInviteCode } from "@/lib/invites"
import { unregisterPushToken } from "@/lib/push-notifications"
import lorMark from "../../assets/images/splash-icon.png"

type Step = "welcome" | "create" | "join"
type SymbolName = ComponentProps<typeof SymbolView>["name"]

const CREATE_ICON: SymbolName = { ios: "plus", android: "add", web: "add" }
const JOIN_ICON: SymbolName = {
  ios: "person.2",
  android: "group",
  web: "group",
}
const CHEVRON_ICON: SymbolName = {
  ios: "chevron.right",
  android: "chevron_right",
  web: "chevron_right",
}

// Font size only: `text-base` also sets a 24pt line height, and on iOS a
// single-line TextInput with a line height taller than its font sits low.
const INPUT_CLASS_NAME =
  "min-h-[52px] rounded-lor-md border border-border bg-surface px-three text-[16px] text-foreground"

export default function OnboardingScreen() {
  const theme = useTheme()
  const { height } = useWindowDimensions()
  const { data: session, isPending: isSessionPending } = authClient.useSession()
  const {
    workspaces,
    isLoading: isWorkspaceLoading,
    reloadWorkspaces,
  } = useWorkspace()
  const hasWorkspace = workspaces.length > 0

  const [step, setStep] = useState<Step>("welcome")
  const [direction, setDirection] = useState<1 | -1>(1)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // null until edited: a company email prefills it once the session loads.
  const [editedWebsite, setWebsite] = useState<string | null>(null)
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

  const emailDomain = companyEmailDomain(session.user.email)
  const website = editedWebsite ?? emailDomain ?? ""

  const goToStep = (nextStep: Step) => {
    setDirection(nextStep === "welcome" ? -1 : 1)
    setError(null)
    setStep(nextStep)
  }

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
      triggerHaptic("success")
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

  // Someone with no workspace can't reach the You tab, so sign-out lives here.
  const signOut = () => {
    void unregisterPushToken()
      .catch(() => {})
      .then(() => authClient.signOut())
  }

  const entering = (direction === 1 ? FadeInRight : FadeInLeft).duration(220)
  const exiting = FadeOut.duration(120)

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        {/* Pinned near the top rather than centered, so the mark and heading
            stay put while steps of different heights swap below them. */}
        <ScrollView
          contentContainerClassName="flex-grow px-six pb-six"
          contentContainerStyle={{ paddingTop: Math.round(height * 0.1) }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Image
            source={lorMark}
            className="mb-seven self-center"
            style={{ width: 46, height: 28 }}
          />

          <Animated.View key={step} entering={entering} exiting={exiting}>
            {step === "welcome" ? (
              <>
                <StepHeader
                  subtitle="Set up a workspace for your team, or join one you were invited to."
                  title={hasWorkspace ? "Add a workspace" : "Welcome to Lor"}
                />
                <View className="overflow-hidden rounded-lor-md border border-border bg-surface">
                  <ChoiceRow
                    detail="Start fresh for your team"
                    icon={CREATE_ICON}
                    label="Create a workspace"
                    onPress={() => goToStep("create")}
                  />
                  <View className="ml-[48px] h-px bg-separator" />
                  <ChoiceRow
                    detail="Use a link from a teammate"
                    icon={JOIN_ICON}
                    label="Join with an invite"
                    onPress={() => goToStep("join")}
                  />
                </View>
              </>
            ) : null}

            {step === "create" ? (
              <>
                <StepHeader
                  subtitle="You can change these later in settings."
                  title="Create a workspace"
                />
                <View className="gap-four">
                  <Field label="Website">
                    <WebsiteInput
                      accessibilityLabel="Website"
                      autoCapitalize="none"
                      autoCorrect={false}
                      inputMode="url"
                      onChangeText={setWebsite}
                      placeholder="acme.com"
                      placeholderTextColor={theme.textTertiary}
                      value={website}
                    />
                  </Field>
                  <Field label="Name">
                    <TextInput
                      accessibilityLabel="Workspace name"
                      autoFocus={!!emailDomain}
                      className={INPUT_CLASS_NAME}
                      maxLength={100}
                      onChangeText={setWorkspaceName}
                      placeholder="Acme"
                      placeholderTextColor={theme.textTertiary}
                      value={workspaceName}
                    />
                  </Field>
                  <Field
                    hint="Optional. Lor reads this to understand your team."
                    label="What are you building?"
                  >
                    <TextInput
                      accessibilityLabel="What are you building?"
                      className={INPUT_CLASS_NAME}
                      maxLength={280}
                      onChangeText={setDescription}
                      placeholder="Payments infrastructure for marketplaces"
                      placeholderTextColor={theme.textTertiary}
                      value={description}
                    />
                  </Field>
                </View>
                {error ? <ErrorText message={error} /> : null}
                <View className="mt-six gap-two">
                  <Button
                    isDisabled={isSubmitting || !workspaceName.trim()}
                    onPress={() => void createWorkspace()}
                  >
                    {isSubmitting ? "Creating…" : "Create workspace"}
                  </Button>
                  <Button
                    isDisabled={isSubmitting}
                    onPress={() => goToStep("welcome")}
                    variant="ghost"
                  >
                    Back
                  </Button>
                </View>
              </>
            ) : null}

            {step === "join" ? (
              <>
                <StepHeader
                  subtitle="Paste the invite link or code a teammate sent you."
                  title="Join a workspace"
                />
                <Field label="Invite link or code">
                  <TextInput
                    accessibilityLabel="Invite link or code"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    className={INPUT_CLASS_NAME}
                    onChangeText={setInviteLink}
                    placeholder="https://app.lor.chat/invite/abc123"
                    placeholderTextColor={theme.textTertiary}
                    value={inviteLink}
                  />
                </Field>
                {error ? <ErrorText message={error} /> : null}
                <View className="mt-six gap-two">
                  <Button
                    isDisabled={!inviteLink.trim()}
                    onPress={joinWorkspace}
                  >
                    Join workspace
                  </Button>
                  <Button onPress={() => goToStep("welcome")} variant="ghost">
                    Back
                  </Button>
                </View>
              </>
            ) : null}
          </Animated.View>

          <View className="mt-auto flex-row items-center justify-center gap-two pt-eight">
            {hasWorkspace && router.canGoBack() ? (
              <FooterButton label="Back to Lor" onPress={() => router.back()} />
            ) : (
              <>
                <Text className="text-[13px] text-muted" numberOfLines={1}>
                  {session.user.email}
                </Text>
                <Text className="text-[13px] text-muted">·</Text>
                <FooterButton label="Sign out" onPress={signOut} />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  )
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View className="mb-seven items-center gap-two">
      <Text className="text-center text-[26px] font-bold tracking-[-0.5px] text-foreground">
        {title}
      </Text>
      <Text className="text-center text-[15px] leading-[21px] text-muted">
        {subtitle}
      </Text>
    </View>
  )
}

function ChoiceRow({
  detail,
  icon,
  label,
  onPress,
}: {
  detail: string
  icon: SymbolName
  label: string
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="min-h-[60px] flex-row items-center gap-three px-four py-three active:bg-surface-secondary"
      onPress={() => {
        triggerHaptic("selection")
        onPress()
      }}
    >
      <SymbolView name={icon} size={20} tintColor={theme.textSecondary} />
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] font-semibold text-foreground">
          {label}
        </Text>
        <Text className="text-[13px] text-muted">{detail}</Text>
      </View>
      <SymbolView
        name={CHEVRON_ICON}
        size={13}
        tintColor={theme.textTertiary}
      />
    </Pressable>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <View className="gap-two">
      <Text className="text-[13px] font-semibold text-muted">{label}</Text>
      {children}
      {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
    </View>
  )
}

function ErrorText({ message }: { message: string }) {
  return (
    <Text className="mt-four text-sm font-medium text-danger">{message}</Text>
  )
}

function FooterButton({
  label,
  onPress,
}: {
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className="py-two active:opacity-70"
      hitSlop={8}
      onPress={onPress}
    >
      <Text className="text-[13px] font-semibold text-foreground">{label}</Text>
    </Pressable>
  )
}
