import { ReplayIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { isTauri } from "@repo/auth/tauri-fetch"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { AnimatePresence, motion, type Variants } from "motion/react"
import { type ComponentType, useState } from "react"
import { usePageHint } from "@/components/hints/hints-provider"
import {
  ChannelAgentScene,
  type SceneProps,
  SessionStartScene,
  SharedSessionScene,
  WelcomeScene,
} from "@/components/onboarding/how-lor-works-scenes"
import { useOpenNewSession } from "@/hooks/use-open-new-session"

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
    body: `Mention @Lor or ${isTauri ? "press ⌘N" : "click New session in the sidebar"} to start one. Each session belongs to a channel, and the chat stays for your team.`,
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

// direction: 1 moves forward (enter from the right), -1 goes back.
const slide: Variants = {
  enter: (direction: number) => ({
    x: direction * 24,
    opacity: 0,
    filter: "blur(2px)",
  }),
  center: {
    x: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.25, ease: EASE_OUT },
  },
  exit: (direction: number) => ({
    x: direction * -24,
    opacity: 0,
    filter: "blur(2px)",
    transition: { duration: 0.15, ease: EASE_OUT },
  }),
}

// The one-time explainer of the workspace model (reference/onboarding.md,
// Step 11b). Opens by itself until dismissed, and from the workspace menu
// through ?intro.
export function HowLorWorksDialog({
  workspaceName,
}: {
  workspaceName: string
}) {
  const navigate = useNavigate()
  const { intro } = useSearch({ strict: false })
  const { dismissed, dismiss } = usePageHint("how_lor_works")
  const openNewSession = useOpenNewSession()

  const close = () => {
    dismiss()
    if (intro) {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, intro: undefined }),
      })
    }
  }

  return (
    // A stray backdrop click must not lose it for good; X and Escape close it.
    <Dialog
      disablePointerDismissal
      open={!dismissed || intro === true}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogPopup className="overflow-hidden sm:max-w-[640px]">
        <HowLorWorksSteps
          workspaceName={workspaceName}
          onStart={() => {
            dismiss()
            openNewSession()
          }}
        />
      </DialogPopup>
    </Dialog>
  )
}

// Unmounted while the dialog is closed, so every open starts at step one.
function HowLorWorksSteps({
  workspaceName,
  onStart,
}: {
  workspaceName: string
  onStart: () => void
}) {
  const { data: authSession } = authClient.useSession()
  const [[step, direction], setStep] = useState<[number, number]>([0, 1])
  const go = (next: number) => setStep([next, next > step ? 1 : -1])
  const current = STEPS[step] ?? STEPS[0]
  const last = step === STEPS.length - 1
  const you = {
    name: authSession?.user.name ?? "You",
    image: authSession?.user.image ?? null,
  }
  const { Scene } = current
  // Replay remounts the scene; the button shows once it has played.
  const [replays, setReplays] = useState(0)
  const [playedScene, setPlayedScene] = useState<string | null>(null)
  const sceneKey = `${step}-${replays}`

  return (
    <>
      <div className="relative h-[300px] shrink-0 overflow-hidden border-b bg-muted/50">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={sceneKey}
            custom={direction}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            className="absolute inset-0"
          >
            <Scene
              workspaceName={workspaceName}
              you={you}
              onDone={() => setPlayedScene(sceneKey)}
            />
          </motion.div>
        </AnimatePresence>
        {playedScene === sceneKey && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setReplays((count) => count + 1)}
            className="absolute top-3 left-3 z-10 animate-in fade-in duration-200"
          >
            <HugeiconsIcon icon={ReplayIcon} strokeWidth={2} />
            Replay
          </Button>
        )}
      </div>
      <div className="relative h-[124px] shrink-0 overflow-hidden px-6 pt-5">
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <DialogTitle className="text-lg">{current.title}</DialogTitle>
            <DialogDescription className="mt-2 text-pretty">
              {current.body}
            </DialogDescription>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex items-center justify-between gap-3 px-6 pt-1 pb-6">
        <div className="flex items-center gap-1.5">
          {STEPS.map((item, index) => (
            <button
              key={item.title}
              type="button"
              aria-label={`Step ${index + 1}: ${item.title}`}
              aria-current={index === step ? "step" : undefined}
              onClick={() => go(index)}
              className={cn(
                "h-1.5 cursor-pointer rounded-full transition-[width,background-color] duration-200 ease-out",
                index === step
                  ? "w-5 bg-foreground"
                  : "w-1.5 bg-foreground/20 hover:bg-foreground/40"
              )}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {step > 0 && (
            <Button variant="ghost" onClick={() => go(step - 1)}>
              Back
            </Button>
          )}
          {last ? (
            <Button onClick={onStart}>Start a session</Button>
          ) : (
            <Button onClick={() => go(step + 1)}>Next</Button>
          )}
        </div>
      </div>
    </>
  )
}
