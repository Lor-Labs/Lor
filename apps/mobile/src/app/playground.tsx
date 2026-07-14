import { router } from "expo-router"
import { Card } from "heroui-native/card"
import { Description } from "heroui-native/description"
import { FieldError } from "heroui-native/field-error"
import { Input } from "heroui-native/input"
import { Label } from "heroui-native/label"
import { Select } from "heroui-native/select"
import { TextField } from "heroui-native/text-field"
import { useToast } from "heroui-native/toast"
import { type ReactNode, useState } from "react"
import { Text, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { Uniwind, useUniwind } from "uniwind"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { HapticButton } from "@/components/ui/haptic-button"
import { triggerHaptic } from "@/components/ui/haptics"
import { RadioGroup } from "@/components/ui/radio-group"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tabs } from "@/components/ui/tabs"

type PlaygroundTab = "components" | "states" | "feedback"
type SelectPresentation = "popover" | "bottom-sheet" | "dialog"
type SelectOption = { value: string; label: string }

const roleOptions = [
  {
    value: "member",
    label: "Member",
    description: "Can join conversations and create threads.",
  },
  {
    value: "moderator",
    label: "Moderator",
    description: "Can organize channels and guide discussions.",
  },
  {
    value: "admin",
    label: "Admin",
    description: "Can manage people, settings, and permissions.",
  },
] as const

const selectPresentationCopy = {
  popover: {
    label: "Floating popover",
    detail: "Compact and anchored to its trigger.",
  },
  "bottom-sheet": {
    label: "Bottom sheet",
    detail: "Reach-friendly and easy to dismiss with a swipe.",
  },
  dialog: {
    label: "Dialog",
    detail: "Focused choice in the center of the viewport.",
  },
} as const

export default function PlaygroundScreen() {
  const { theme } = useUniwind()
  const [activeTab, setActiveTab] = useState<PlaygroundTab>("components")
  const [email, setEmail] = useState("")
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [focusModeEnabled, setFocusModeEnabled] = useState(false)
  const [autoJoinThreads, setAutoJoinThreads] = useState(true)
  const [replyDensity, setReplyDensity] = useState("comfortable")
  const [popoverRole, setPopoverRole] = useState<SelectOption>()
  const [bottomSheetRole, setBottomSheetRole] = useState<SelectOption>()
  const [dialogRole, setDialogRole] = useState<SelectOption>()
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()
  const emailIsInvalid = email.length > 0 && !email.includes("@")
  const setTheme = (nextTheme: "light" | "dark") => {
    if (theme === nextTheme) return
    triggerHaptic("selection")
    Uniwind.setTheme(nextTheme)
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="gap-two px-four pb-three pt-two">
        <View className="flex-row items-center">
          <View className="flex-1 items-start">
            <Button size="sm" variant="ghost" onPress={() => router.back()}>
              Back
            </Button>
          </View>
          <View className="rounded-full bg-success-soft px-three py-two">
            <Text className="text-xs font-semibold text-success-soft-foreground">
              Theme connected
            </Text>
          </View>
          <View className="flex-1" />
        </View>
        <View className="flex-row self-end rounded-full border border-border bg-surface p-one">
          <Button
            accessibilityState={{ selected: theme === "light" }}
            size="sm"
            variant={theme === "light" ? "primary" : "ghost"}
            onPress={() => setTheme("light")}
          >
            Light
          </Button>
          <Button
            accessibilityState={{ selected: theme === "dark" }}
            size="sm"
            variant={theme === "dark" ? "primary" : "ghost"}
            onPress={() => setTheme("dark")}
          >
            Dark
          </Button>
        </View>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={24}
        className="flex-1"
        contentContainerClassName="gap-seven px-four"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 32 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        mode="insets"
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
      >
        <View className="border-l-2 border-accent py-one pl-four">
          <Text className="text-[28px] font-bold tracking-[-0.7px] text-foreground">
            HeroUI Native
          </Text>
          <Text className="mt-one max-w-[330px] text-[15px] leading-[21px] text-muted">
            A live check of Lor’s shared tokens, component states, and native
            motion.
          </Text>
        </View>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (value === activeTab) return
            setActiveTab(value as PlaygroundTab)
          }}
        >
          <Tabs.List>
            <Tabs.Indicator />
            <Tabs.Trigger value="components">
              <Tabs.Label>Components</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="states">
              <Tabs.Label>States</Tabs.Label>
            </Tabs.Trigger>
            <Tabs.Trigger value="feedback">
              <Tabs.Label>Feedback</Tabs.Label>
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content className="gap-eight pt-six" value="components">
            <PlaygroundSection
              detail="Emphasis, hierarchy, and press feedback."
              title="Buttons"
            >
              <View className="flex-row flex-wrap gap-two">
                <Button size="sm">Create thread</Button>
                <Button size="sm" variant="secondary">
                  Invite
                </Button>
                <Button size="sm" variant="outline">
                  Preview
                </Button>
                <Button size="sm" variant="ghost">
                  More
                </Button>
                <Button size="sm" variant="danger-soft">
                  Remove
                </Button>
                <Button isDisabled size="sm">
                  Disabled
                </Button>
              </View>
            </PlaygroundSection>

            <PlaygroundSection
              detail="Structured content using the shared surface palette."
              title="Card"
            >
              <Card>
                <Card.Header>
                  <Text className="text-xs font-semibold uppercase tracking-[0.8px] text-accent">
                    Workspace signal
                  </Text>
                </Card.Header>
                <Card.Body className="gap-one">
                  <Card.Title>Design review is ready</Card.Title>
                  <Card.Description>
                    Seven interface decisions are waiting for the team in
                    #mobile-product.
                  </Card.Description>
                </Card.Body>
                <Card.Footer className="gap-two">
                  <Button size="sm">Open review</Button>
                  <Button size="sm" variant="ghost">
                    Later
                  </Button>
                </Card.Footer>
              </Card>
            </PlaygroundSection>

            <PlaygroundSection
              detail="Focus, helper text, and inline validation."
              title="Form controls"
            >
              <TextField isInvalid={emailIsInvalid} isRequired>
                <Label>Workspace email</Label>
                <Input
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="name@company.com"
                  value={email}
                />
                {emailIsInvalid ? (
                  <FieldError>Enter a complete email address.</FieldError>
                ) : (
                  <Description>Used for team invitations.</Description>
                )}
              </TextField>

              <Card>
                <View className="flex-row items-center gap-four">
                  <View className="flex-1 gap-one">
                    <Text className="text-[15px] font-semibold text-foreground">
                      Activity summaries
                    </Text>
                    <Text className="text-[13px] leading-[18px] text-muted">
                      Send a concise digest when conversations need attention.
                    </Text>
                  </View>
                  <Switch
                    isSelected={notificationsEnabled}
                    onSelectedChange={setNotificationsEnabled}
                  />
                </View>
              </Card>
            </PlaygroundSection>

            <PlaygroundSection
              detail="Open the same choices in each of HeroUI’s presentation modes."
              title="Select presentations"
            >
              <SelectPresentationDemo
                presentation="popover"
                value={popoverRole}
                onValueChange={setPopoverRole}
              />
              <SelectPresentationDemo
                presentation="bottom-sheet"
                value={bottomSheetRole}
                onValueChange={setBottomSheetRole}
              />
              <SelectPresentationDemo
                presentation="dialog"
                value={dialogRole}
                onValueChange={setDialogRole}
              />
            </PlaygroundSection>
          </Tabs.Content>

          <Tabs.Content className="gap-eight pt-six" value="states">
            <PlaygroundSection
              detail="Toggle between a shaped skeleton and loaded content."
              title="Loading"
            >
              <Skeleton
                className="min-h-[136px] w-full rounded-xl"
                isLoading={isLoading}
              >
                <Card className="min-h-[136px]">
                  <Card.Body className="justify-center gap-one">
                    <Card.Title>Channel history loaded</Card.Title>
                    <Card.Description>
                      The skeleton preserves the final content footprint.
                    </Card.Description>
                  </Card.Body>
                </Card>
              </Skeleton>
              <Button
                size="sm"
                variant="outline"
                onPress={() => setIsLoading((current) => !current)}
              >
                {isLoading ? "Show content" : "Reset loading"}
              </Button>
            </PlaygroundSection>

            <PlaygroundSection
              detail="Muted controls should remain legible without looking active."
              title="Disabled"
            >
              <TextField isDisabled>
                <Label>Managed workspace</Label>
                <Input value="Lor product" />
                <Description>Controlled by your organization.</Description>
              </TextField>
              <View className="flex-row items-center justify-between rounded-xl bg-surface p-four">
                <Text className="text-[15px] font-medium text-muted">
                  External notifications
                </Text>
                <Switch isDisabled isSelected={false} />
              </View>
            </PlaygroundSection>
          </Tabs.Content>

          <Tabs.Content className="gap-eight pt-six" value="feedback">
            <PlaygroundSection
              detail="Tactile feedback is reserved for controls that change selection state."
              title="Stateful controls"
            >
              <Card>
                <Card.Body className="gap-five">
                  <View className="flex-row items-center gap-four">
                    <View className="flex-1 gap-one">
                      <Card.Title>Focus mode</Card.Title>
                      <Card.Description>
                        Quiet nonessential workspace updates.
                      </Card.Description>
                    </View>
                    <Switch
                      isSelected={focusModeEnabled}
                      onSelectedChange={setFocusModeEnabled}
                    />
                  </View>
                  <View className="h-px bg-divider" />
                  <View className="flex-row items-center gap-four">
                    <View className="flex-1 gap-one">
                      <Card.Title>Activity summaries</Card.Title>
                      <Card.Description>
                        Send a digest when conversations need attention.
                      </Card.Description>
                    </View>
                    <Switch
                      isSelected={notificationsEnabled}
                      onSelectedChange={setNotificationsEnabled}
                    />
                  </View>
                  <View className="h-px bg-divider" />
                  <View className="flex-row items-start gap-three">
                    <Checkbox
                      className="mt-one"
                      isSelected={autoJoinThreads}
                      onSelectedChange={setAutoJoinThreads}
                    />
                    <View className="flex-1 gap-one">
                      <Card.Title>Auto-join new threads</Card.Title>
                      <Card.Description>
                        Follow replies to conversations you start.
                      </Card.Description>
                    </View>
                  </View>
                  <View className="h-px bg-divider" />
                  <View className="gap-three">
                    <View className="gap-one">
                      <Card.Title>Reply density</Card.Title>
                      <Card.Description>
                        Choose how much context appears in the channel feed.
                      </Card.Description>
                    </View>
                    <RadioGroup
                      className="gap-two"
                      value={replyDensity}
                      onValueChange={setReplyDensity}
                    >
                      <RadioGroup.Item value="compact">Compact</RadioGroup.Item>
                      <RadioGroup.Item value="comfortable">
                        Comfortable
                      </RadioGroup.Item>
                      <RadioGroup.Item value="expanded">
                        Expanded
                      </RadioGroup.Item>
                    </RadioGroup>
                  </View>
                </Card.Body>
              </Card>
            </PlaygroundSection>

            <PlaygroundSection
              detail="Both toast outcomes use the same soft confirmation haptic."
              title="Outcome feedback"
            >
              <Card>
                <Card.Body className="gap-one">
                  <Card.Title>Trigger native feedback</Card.Title>
                  <Card.Description>
                    Verify placement, swipe dismissal, and semantic colors.
                  </Card.Description>
                </Card.Body>
                <Card.Footer className="gap-two">
                  <HapticButton
                    className="w-full"
                    haptic="soft"
                    size="sm"
                    onPress={() =>
                      toast.show({
                        variant: "success",
                        label: "Theme check passed",
                        description: "The shared Lor tokens are active.",
                      })
                    }
                  >
                    Success toast
                  </HapticButton>
                  <HapticButton
                    className="w-full"
                    haptic="soft"
                    size="sm"
                    variant="danger-soft"
                    onPress={() =>
                      toast.show({
                        variant: "danger",
                        label: "Connection interrupted",
                        description: "This is a visual error-state preview.",
                      })
                    }
                  >
                    Error toast
                  </HapticButton>
                </Card.Footer>
              </Card>
            </PlaygroundSection>
          </Tabs.Content>
        </Tabs>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

function SelectPresentationDemo({
  presentation,
  value,
  onValueChange,
}: {
  presentation: SelectPresentation
  value: SelectOption | undefined
  onValueChange: (value: SelectOption | undefined) => void
}) {
  const copy = selectPresentationCopy[presentation]

  return (
    <View className="gap-two">
      <View className="gap-one px-one">
        <Text className="text-[15px] font-semibold text-foreground">
          {copy.label}
        </Text>
        <Text className="text-[13px] leading-[18px] text-muted">
          {copy.detail}
        </Text>
      </View>
      <Select
        presentation={presentation}
        value={value}
        onValueChange={(nextValue) => {
          triggerHaptic("selection")
          onValueChange(nextValue)
        }}
      >
        <Select.Trigger>
          <Select.Value placeholder="Choose a workspace role" />
          <Select.TriggerIndicator />
        </Select.Trigger>
        <Select.Portal>
          <Select.Overlay />
          <SelectPresentationContent presentation={presentation} />
        </Select.Portal>
      </Select>
    </View>
  )
}

function SelectPresentationContent({
  presentation,
}: {
  presentation: SelectPresentation
}) {
  if (presentation === "bottom-sheet") {
    return (
      <Select.Content
        contentContainerClassName="gap-one px-four pb-six"
        presentation="bottom-sheet"
        snapPoints={["42%"]}
      >
        <SelectOptions />
      </Select.Content>
    )
  }

  if (presentation === "dialog") {
    return (
      <Select.Content classNames={{ content: "gap-two" }} presentation="dialog">
        <View className="flex-row items-center justify-between gap-three px-two pb-two">
          <Text className="min-w-0 flex-1 text-lg font-semibold text-overlay-foreground">
            Choose a workspace role
          </Text>
          <Select.Close />
        </View>
        <SelectOptions showLabel={false} />
      </Select.Content>
    )
  }

  return (
    <Select.Content
      align="center"
      placement="bottom"
      presentation="popover"
      width="trigger"
    >
      <SelectOptions />
    </Select.Content>
  )
}

function SelectOptions({ showLabel = true }: { showLabel?: boolean }) {
  return (
    <>
      {showLabel ? <Select.ListLabel>Workspace role</Select.ListLabel> : null}
      {roleOptions.map((option) => (
        <Select.Item
          key={option.value}
          label={option.label}
          value={option.value}
        >
          <View className="min-w-0 flex-1 gap-px">
            <Select.ItemLabel className="flex-none" />
            <Select.ItemDescription>
              {option.description}
            </Select.ItemDescription>
          </View>
          <Select.ItemIndicator />
        </Select.Item>
      ))}
    </>
  )
}

function PlaygroundSection({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: ReactNode
}) {
  return (
    <View className="gap-four">
      <View className="gap-one">
        <Text className="text-lg font-bold tracking-[-0.2px] text-foreground">
          {title}
        </Text>
        <Text className="text-[13px] leading-[18px] text-muted">{detail}</Text>
      </View>
      <View className="gap-four">{children}</View>
    </View>
  )
}
