import ReplayIcon from "@hugeicons/core-free-icons/ReplayIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { router } from "expo-router"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { type ComponentType, useState } from "react"
import { Pressable, Text, View } from "react-native"
import Animated, {
  FadeIn,
  FadeInLeft,
  FadeInRight,
  FadeOut,
} from "react-native-reanimated"
import {
  ChannelAgentScene,
  type SceneProps,
  SessionStartScene,
  SharedSessionScene,
  WelcomeScene,
} from "@/components/how-lor-works-scenes"
import { Button } from "@/components/ui/button"
import { useHint } from "@/hooks/use-hints"
import { authClient } from "@/lib/auth-client"

type Step = {
  title: string
  body: string
  Scene: ComponentType<SceneProps>
}

const STEPS: [Step, ...Step[]] = [
  {
    title: "Welcome to Lor",
    body: "AI agents your whole team can steer.",
    Scene: WelcomeScene,
  },
  {
    title: "Lor works in sessions",
    body: "Mention @Lor or tap the pencil on the Channels tab to start one. Each session belongs to a channel, and the chat stays for your team.",
    Scene: SessionStartScene,
  },
  {
    title: "Sessions are shared",
    body: "Anyone in the channel can see the work, step in, or approve what Lor sends.",
    Scene: SharedSessionScene,
  },
  // Last, once people know what a session is: a loop's runs land in one.
  {
    title: "Every channel has its own agent",
    body: "Choose which tools Lor can use in each channel, and give it work on a schedule, like finding leads in #gtm every weekday.",
    Scene: ChannelAgentScene,
  },
]

const forwardIn = FadeInRight.duration(250)
const backIn = FadeInLeft.duration(250)
const stepOut = FadeOut.duration(150)
const replayIn = FadeIn.duration(200)

// The one-time explainer of the workspace model, on web's how_lor_works key:
// dismissed on either, gone on both. Opens by itself until dismissed, and
// from the workspace sheet. Only its X and its last step close it, so a
// stray tap or drag can't lose it for good. Mirrors web's
// how-lor-works-dialog.tsx.
export function HowLorWorksSheet({
  reopened,
  onClose,
}: {
  // Opened again from the workspace sheet.
  reopened: boolean
  onClose: () => void
}) {
  const hint = useHint("how_lor_works")
  const isOpen = !hint.dismissed || reopened
  // Every open starts at step one.
  const [openCount, setOpenCount] = useState(0)
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) setOpenCount((count) => count + 1)
  }

  const close = () => {
    hint.dismiss()
    onClose()
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay
          className="bg-neutral-950/50"
          isCloseOnPress={false}
        />
        <BottomSheet.Content
          enableDynamicSizing={false}
          enablePanDownToClose={false}
          snapPoints={["82%"]}
        >
          <HowLorWorksSteps
            key={openCount}
            onStart={() => {
              close()
              router.push("/session/new")
            }}
          />
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function HowLorWorksSteps({ onStart }: { onStart: () => void }) {
  const { data: auth } = authClient.useSession()
  const foreground = useThemeColor("foreground")
  const [[step, direction], setStep] = useState<[number, number]>([0, 1])
  const go = (next: number) => setStep([next, next > step ? 1 : -1])
  const current = STEPS[step] ?? STEPS[0]
  const last = step === STEPS.length - 1
  const you = {
    name: auth?.user.name ?? "You",
    image: auth?.user.image ?? null,
  }
  const { Scene } = current
  const stepIn = direction > 0 ? forwardIn : backIn
  // Replay remounts the scene; the button shows once it has played.
  const [replays, setReplays] = useState(0)
  const [playedScene, setPlayedScene] = useState<string | null>(null)
  const sceneKey = `${step}-${replays}`

  return (
    <View className="flex-1 gap-five pb-six">
      <View className="flex-row justify-end">
        <BottomSheet.Close />
      </View>
      <View className="h-[260px] overflow-hidden rounded-lor-lg bg-surface-secondary">
        <Animated.View
          className="absolute inset-0"
          entering={stepIn}
          exiting={stepOut}
          key={sceneKey}
        >
          <Scene onDone={() => setPlayedScene(sceneKey)} you={you} />
        </Animated.View>
        {playedScene === sceneKey ? (
          <Animated.View
            className="absolute left-two top-two"
            entering={replayIn}
          >
            <Pressable
              accessibilityLabel="Replay"
              accessibilityRole="button"
              className="flex-row items-center gap-one rounded-full border border-border bg-background px-two py-one active:opacity-70"
              hitSlop={6}
              onPress={() => setReplays((count) => count + 1)}
            >
              <HugeiconsIcon color={foreground} icon={ReplayIcon} size={12} />
              <Text className="text-[12px] font-medium text-foreground">
                Replay
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
      <Animated.View
        className="gap-two px-one"
        entering={stepIn}
        key={`text-${step}`}
      >
        <BottomSheet.Title>{current.title}</BottomSheet.Title>
        <BottomSheet.Description>{current.body}</BottomSheet.Description>
      </Animated.View>
      <View className="mt-auto flex-row items-center justify-between gap-three px-one">
        <View className="flex-row items-center gap-[6px]">
          {STEPS.map((item, index) => (
            <Pressable
              accessibilityLabel={`Step ${index + 1}: ${item.title}`}
              accessibilityRole="button"
              accessibilityState={{ selected: index === step }}
              className={`h-1.5 rounded-full ${
                index === step ? "w-5 bg-foreground" : "w-1.5 bg-muted"
              }`}
              hitSlop={8}
              key={item.title}
              onPress={() => go(index)}
            />
          ))}
        </View>
        <View className="flex-row gap-two">
          {step > 0 ? (
            <Button onPress={() => go(step - 1)} variant="ghost">
              Back
            </Button>
          ) : null}
          {last ? (
            <Button onPress={onStart}>Start a session</Button>
          ) : (
            <Button onPress={() => go(step + 1)}>Next</Button>
          )}
        </View>
      </View>
    </View>
  )
}
