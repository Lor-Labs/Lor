import {
  ArrowLeft01Icon,
  PlusSignIcon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { sluggify } from "@repo/utils/slug"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { AnimatePresence, motion, type Variants } from "motion/react"
import { useEffect, useState } from "react"
import { MorphText } from "@/components/ui/morph-text"
import { apiClient } from "@/lib/api-client"

type Step = "welcome" | "create" | "join"

// Brief "Workspace Ready" beat before leaving onboarding.
const SUCCESS_BEAT_MS = 600

// direction: 1 moves forward (enter from the right), -1 goes back.
const stepVariants: Variants = {
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

const WELCOME_STAGGER =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-backwards motion-safe:duration-300 motion-safe:ease-out"

function normalizeSlugInput(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

function parseInviteCode(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^[A-Za-z0-9]+$/.test(trimmed)) {
    return trimmed
  }

  const inviteMatch = trimmed.match(
    /(?:^|\/)invite\/([A-Za-z0-9]+)(?:\/)?(?:[?#].*)?$/i
  )

  return inviteMatch?.[1] ?? null
}

export function OnboardingDialog({ open }: { open: boolean }) {
  const [step, setStep] = useState<Step>("welcome")
  const [direction, setDirection] = useState(1)
  const [isFirstStep, setIsFirstStep] = useState(true)
  const [created, setCreated] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [inviteLink, setInviteLink] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    if (!slugEdited) {
      setSlug(sluggify(name))
    }
  }, [name, slugEdited])

  const goTo = (next: Step) => {
    setDirection(next === "welcome" ? -1 : 1)
    setIsFirstStep(false)
    setError(null)
    setStep(next)
  }

  const getFirstChannelId = async (workspaceSlug: string) => {
    const channelsRes = await apiClient.v1.workspaces[
      ":workspaceSlug"
    ].channels.$get({
      param: { workspaceSlug },
    })

    if (!channelsRes.ok) return null

    const channels = await channelsRes.json()
    if (channels.uncategorized[0]?.id) return channels.uncategorized[0].id
    for (const cat of channels.categories) {
      if (cat.channels[0]?.id) return cat.channels[0].id
    }
    return null
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedSlug = sluggify(slug)
    if (loading || created || !name.trim() || !normalizedSlug) return
    setError(null)
    setLoading(true)

    try {
      const res = await authClient.organization.create({
        name: name.trim(),
        slug: normalizedSlug,
      })

      if (res.error) {
        const message = (
          res.error.message ?? "Failed to create workspace"
        ).replace(/organization/gi, "Workspace")
        setError(message)
        return
      }

      const createdWorkspaceSlug = res.data?.slug ?? normalizedSlug
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] })

      let firstChannelId: string | null = null
      try {
        firstChannelId = await getFirstChannelId(createdWorkspaceSlug)
      } catch (error) {
        console.error(
          `Failed to fetch first channel for workspace ${createdWorkspaceSlug}:`,
          error
        )
      }

      setCreated(true)
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_BEAT_MS))

      if (firstChannelId) {
        navigate({
          to: "/$workspaceSlug/$channelId",
          params: {
            workspaceSlug: createdWorkspaceSlug,
            channelId: firstChannelId,
          },
        })
        return
      }

      navigate({
        to: "/$workspaceSlug",
        params: { workspaceSlug: createdWorkspaceSlug },
      })
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteLink.trim()) return
    setError(null)
    setLoading(true)

    const inviteCode = parseInviteCode(inviteLink)

    if (!inviteCode) {
      setError("Enter a valid invite link or invite code.")
      setLoading(false)
      return
    }

    await navigate({
      to: "/invite/$code",
      params: { code: inviteCode },
    })
  }

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden p-0 sm:max-w-2xl"
      >
        <div className="flex min-h-[460px]">
          {/* Left decorative panel */}
          <div className="relative hidden w-[220px] shrink-0 overflow-hidden sm:block">
            <img
              src="/lor-onboarding2.png"
              alt="A medieval campsite at night"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>

          {/* Right content panel */}
          <div className="relative flex flex-1 flex-col justify-center overflow-hidden p-8">
            <AnimatePresence
              mode="popLayout"
              initial={false}
              custom={direction}
            >
              <motion.div
                key={step}
                custom={direction}
                variants={stepVariants}
                initial="enter"
                animate="center"
                exit="exit"
              >
                {step === "welcome" && (
                  <>
                    <DialogHeader className="mb-8 text-left">
                      <DialogTitle className="text-2xl">
                        Welcome to Lor
                      </DialogTitle>
                      <DialogDescription className="text-sm">
                        Get started by creating a new workspace or joining one
                        you've been invited to.
                      </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => goTo("create")}
                        className={cn(
                          "group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent",
                          isFirstStep && WELCOME_STAGGER
                        )}
                        style={
                          isFirstStep ? { animationDelay: "120ms" } : undefined
                        }
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary/20">
                          <HugeiconsIcon
                            icon={PlusSignIcon}
                            className="size-5"
                            strokeWidth={2}
                          />
                        </div>
                        <div>
                          <p className="font-medium">Create a Workspace</p>
                          <p className="text-sm text-muted-foreground">
                            Start your own community from scratch
                          </p>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => goTo("join")}
                        className={cn(
                          "group flex w-full items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent",
                          isFirstStep && WELCOME_STAGGER
                        )}
                        style={
                          isFirstStep ? { animationDelay: "180ms" } : undefined
                        }
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary/20">
                          <HugeiconsIcon
                            icon={UserGroupIcon}
                            className="size-5"
                            strokeWidth={2}
                          />
                        </div>
                        <div>
                          <p className="font-medium">
                            Join an Existing Workspace
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Enter an invite link to join a workspace
                          </p>
                        </div>
                      </button>
                    </div>
                  </>
                )}

                {step === "create" && (
                  <>
                    <button
                      type="button"
                      onClick={() => goTo("welcome")}
                      disabled={loading || created}
                      className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <HugeiconsIcon
                        icon={ArrowLeft01Icon}
                        className="size-3.5"
                        strokeWidth={2}
                      />
                      Back
                    </button>

                    <DialogHeader className="mb-6 text-left">
                      <DialogTitle className="text-2xl">
                        Create a Workspace
                      </DialogTitle>
                      <DialogDescription className="text-sm">
                        Give your community a name and a unique URL.
                      </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleCreate} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="workspace-name">Workspace Name</Label>
                        <Input
                          id="workspace-name"
                          placeholder="My Awesome Workspace"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          disabled={loading}
                          autoFocus
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="workspace-slug">Slug</Label>
                        <div className="flex items-center rounded-md border border-input bg-muted px-3 text-sm focus-within:ring-1 focus-within:ring-ring">
                          <span className="shrink-0 text-muted-foreground">
                            lor.chat/
                          </span>
                          <Input
                            id="workspace-slug"
                            className="min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
                            placeholder="my-awesome-workspace"
                            value={slug}
                            onChange={(e) => {
                              setSlugEdited(true)
                              setSlug(normalizeSlugInput(e.target.value))
                            }}
                            onBlur={() =>
                              setSlug((currentSlug) => sluggify(currentSlug))
                            }
                            disabled={loading}
                          />
                        </div>
                      </div>

                      {error && (
                        <p className="text-sm text-destructive">{error}</p>
                      )}

                      {/* Not disabled once created: the success state shouldn't dim. */}
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={
                          !created &&
                          (loading || !name.trim() || !sluggify(slug))
                        }
                      >
                        {created ? (
                          <HugeiconsIcon
                            icon={Tick02Icon}
                            className="motion-safe:fade-in motion-safe:zoom-in-75 size-4 motion-safe:animate-in motion-safe:duration-200 motion-safe:ease-out"
                            strokeWidth={2.5}
                          />
                        ) : (
                          loading && <Spinner className="size-4" />
                        )}
                        <MorphText>
                          {created
                            ? "Workspace Ready"
                            : loading
                              ? "Creating Workspace…"
                              : "Create Workspace"}
                        </MorphText>
                      </Button>
                    </form>
                  </>
                )}

                {step === "join" && (
                  <>
                    <button
                      type="button"
                      onClick={() => goTo("welcome")}
                      className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    >
                      <HugeiconsIcon
                        icon={ArrowLeft01Icon}
                        className="size-3.5"
                        strokeWidth={2}
                      />
                      Back
                    </button>

                    <DialogHeader className="mb-6 text-left">
                      <DialogTitle className="text-2xl">
                        Join a Workspace
                      </DialogTitle>
                      <DialogDescription className="text-sm">
                        Paste an invite link or code to join an existing
                        workspace.
                      </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleJoin} className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="invite-link">Invite Link or Code</Label>
                        <Input
                          id="invite-link"
                          placeholder="https://app.lor.chat/invite/abc123 or abc123"
                          value={inviteLink}
                          onChange={(e) => setInviteLink(e.target.value)}
                          disabled={loading}
                          autoFocus
                        />
                      </div>

                      {error && (
                        <p className="text-sm text-destructive">{error}</p>
                      )}

                      <Button
                        type="submit"
                        className="w-full"
                        disabled={loading || !inviteLink.trim()}
                      >
                        {loading && <Spinner className="mr-2 size-4" />}
                        Join Workspace
                      </Button>
                    </form>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
