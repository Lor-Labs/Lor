import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  PlusSignIcon,
  Tick02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { companyEmailDomain, normalizeDomain } from "@repo/utils/domain"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { AnimatePresence, motion, type Variants } from "motion/react"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { PrefillInput } from "@/components/onboarding/prefill-input"
import { useCompanySite } from "@/components/onboarding/use-company-site"
import { WebsiteInput } from "@/components/onboarding/website-input"
import { MorphText } from "@/components/ui/morph-text"
import { SETTINGS_SURFACE } from "@/components/workspace/settings-group"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import { apiClient } from "@/lib/api-client"

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
})

type Step = "choose" | "create" | "join"

// Brief "Workspace ready" beat before leaving onboarding.
const SUCCESS_BEAT_MS = 600

// direction: 1 moves forward (enter from the right), -1 goes back.
const stepVariants: Variants = {
  enter: (direction: number) => ({
    x: direction * 16,
    opacity: 0,
    filter: "blur(2px)",
  }),
  center: {
    x: 0,
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.22, ease: EASE_OUT },
  },
  exit: (direction: number) => ({
    x: direction * -16,
    opacity: 0,
    filter: "blur(2px)",
    transition: { duration: 0.12, ease: EASE_OUT },
  }),
}

function parseInviteCode(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed
  const inviteMatch = trimmed.match(
    /(?:^|\/)invite\/([A-Za-z0-9]+)(?:\/)?(?:[?#].*)?$/i
  )
  return inviteMatch?.[1] ?? null
}

async function errorMessage(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { message?: unknown }
    return typeof body.message === "string" ? body.message : fallback
  } catch {
    return fallback
  }
}

function OnboardingPage() {
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()

  useEffect(() => {
    if (isPending || session) return
    void navigate({ to: "/login", search: { redirect: "/onboarding" } })
  }, [isPending, session, navigate])

  if (!session) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  return <OnboardingFlow email={session.user.email} />
}

function OnboardingFlow({ email }: { email: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>("choose")
  const [direction, setDirection] = useState(1)
  // A company email prefills the website; the user can change it.
  const emailDomain = companyEmailDomain(email)
  const [website, setWebsite] = useState(emailDomain ?? "")
  const { domain: siteDomain, site, isReading } = useCompanySite(website)
  // null until typed in: until then the fields show the site lookup, and a
  // new lookup can replace what an old one filled.
  const [editedName, setName] = useState<string | null>(null)
  const [editedDescription, setDescription] = useState<string | null>(null)
  const namePrefill = editedName === null ? (site?.name ?? null) : null
  const descriptionPrefill =
    editedDescription === null ? (site?.description ?? null) : null
  const name = editedName ?? namePrefill ?? ""
  const description = editedDescription ?? descriptionPrefill ?? ""
  const readingLabel = isReading ? `Reading ${siteDomain}…` : null
  const [inviteLink, setInviteLink] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState(false)

  const { data: workspaces } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await authClient.organization.list()
      return res.data
    },
  })
  const hasWorkspaces = (workspaces?.length ?? 0) > 0

  // Workspaces open to this person's verified company domain.
  const { data: joinable } = useQuery({
    queryKey: ["workspaces", "joinable"],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces.joinable.$get()
      if (!res.ok) return []
      return (await res.json()).workspaces
    },
  })
  const join = useMutation({
    mutationFn: async (workspaceSlug: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].join.$post({
        param: { workspaceSlug },
      })
      if (!res.ok) {
        throw new Error(await errorMessage(res, "Couldn't join the workspace"))
      }
      return res.json()
    },
    onSuccess: async ({ workspace, firstChannelId }) => {
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      await navigate(
        firstChannelId
          ? {
              to: "/$workspaceSlug/$channelId",
              params: {
                workspaceSlug: workspace.slug,
                channelId: firstChannelId,
              },
            }
          : { to: "/$workspaceSlug", params: { workspaceSlug: workspace.slug } }
      )
    },
    onError: (err) => toast.error(err.message),
  })

  const goTo = (next: Step) => {
    setDirection(next === "choose" ? -1 : 1)
    setError(null)
    setStep(next)
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (loading || created || !name.trim()) return
    if (website.trim() && !normalizeDomain(website)) {
      setError("Enter a website like acme.com")
      return
    }
    setError(null)
    setLoading(true)

    try {
      const res = await apiClient.v1.workspaces.$post({
        json: {
          name: name.trim(),
          description: description.trim() || undefined,
          website: website.trim() || undefined,
        },
      })
      if (!res.ok) {
        setError(await errorMessage(res, "Couldn't create the workspace"))
        return
      }
      const { workspace } = await res.json()
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] })

      setCreated(true)
      await new Promise((resolve) => setTimeout(resolve, SUCCESS_BEAT_MS))

      await navigate({
        to: "/$workspaceSlug/setup",
        params: { workspaceSlug: workspace.slug },
      })
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleJoin = (e: FormEvent) => {
    e.preventDefault()
    const inviteCode = parseInviteCode(inviteLink)
    if (!inviteCode) {
      setError("Enter a valid invite link or invite code.")
      return
    }
    void navigate({ to: "/invite/$code", params: { code: inviteCode } })
  }

  const handleSignOut = async () => {
    try {
      const { error } = await authClient.signOut()
      if (error) throw error
    } catch {
      toast.error("Couldn't sign out. Please try again.")
      return
    }
    queryClient.clear()
    await navigate({ to: "/login", replace: true })
  }

  const createButtonLabel = created
    ? "Workspace ready"
    : loading
      ? "Creating workspace..."
      : "Create workspace"

  // Pinned near the top rather than centered, so the mark and heading stay
  // put while steps of different heights swap below them.
  return (
    <div className="flex min-h-svh flex-col items-center bg-background px-6 pt-[14vh] pb-10">
      <div className="flex w-full max-w-[360px] flex-col items-center">
        <img src="/lor-mark.svg" alt="Lor" className="mb-8 size-8" />

        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full"
          >
            {step === "choose" && (
              <>
                <StepHeader
                  title="Welcome to Lor"
                  subtitle="Set up a workspace for your team, or join one you were invited to."
                />
                {joinable && joinable.length > 0 && (
                  <div className="mb-5 space-y-2">
                    <p className="px-1 text-xs font-medium text-muted-foreground">
                      Your team is already on Lor
                    </p>
                    <div className={cn(SETTINGS_SURFACE, "space-y-0.5 p-1")}>
                      {joinable.map((w) => (
                        <JoinRow
                          key={w.id}
                          name={w.name}
                          logo={w.logo}
                          memberCount={w.humanMemberCount}
                          joining={join.isPending && join.variables === w.slug}
                          disabled={join.isPending}
                          onJoin={() => join.mutate(w.slug)}
                        />
                      ))}
                    </div>
                  </div>
                )}
                <div className={cn(SETTINGS_SURFACE, "space-y-0.5 p-1")}>
                  <ChoiceRow
                    icon={PlusSignIcon}
                    title="Create a workspace"
                    description="Start fresh for your team"
                    onClick={() => goTo("create")}
                  />
                  <ChoiceRow
                    icon={UserGroupIcon}
                    title="Join with an invite"
                    description="Use a link from a teammate"
                    onClick={() => goTo("join")}
                  />
                </div>
              </>
            )}

            {step === "create" && (
              <>
                <StepHeader
                  title="Create a workspace"
                  subtitle="You can change these later in settings."
                />
                <form onSubmit={handleCreate} className="space-y-5">
                  <Field label="Website" htmlFor="workspace-website">
                    <WebsiteInput
                      id="workspace-website"
                      placeholder="acme.com"
                      inputMode="url"
                      autoComplete="url"
                      value={website}
                      onChange={setWebsite}
                      disabled={loading}
                      autoFocus={!emailDomain}
                    />
                  </Field>
                  <Field label="Name" htmlFor="workspace-name">
                    <PrefillInput
                      id="workspace-name"
                      placeholder="Acme"
                      maxLength={100}
                      value={name}
                      onChange={setName}
                      prefill={namePrefill}
                      pendingLabel={editedName === null ? readingLabel : null}
                      disabled={loading}
                      autoFocus={!!emailDomain}
                    />
                  </Field>
                  <Field
                    label="What are you building?"
                    htmlFor="workspace-description"
                    hint={
                      descriptionPrefill
                        ? `Filled from ${siteDomain}. Lor reads this to understand your team.`
                        : "Optional. Lor reads this to understand your team."
                    }
                  >
                    <PrefillInput
                      id="workspace-description"
                      placeholder="Payments infrastructure for marketplaces"
                      maxLength={280}
                      value={description}
                      onChange={setDescription}
                      prefill={descriptionPrefill}
                      pendingLabel={
                        editedDescription === null ? readingLabel : null
                      }
                      disabled={loading}
                    />
                  </Field>

                  {error && <p className="text-sm text-destructive">{error}</p>}

                  <div className="space-y-2 pt-1">
                    {/* Not disabled once created: the success state shouldn't dim. */}
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!created && (loading || !name.trim())}
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
                      <MorphText>{createButtonLabel}</MorphText>
                    </Button>
                    <BackButton
                      onClick={() => goTo("choose")}
                      disabled={loading || created}
                    />
                  </div>
                </form>
              </>
            )}

            {step === "join" && (
              <>
                <StepHeader
                  title="Join a workspace"
                  subtitle="Paste the invite link or code a teammate sent you."
                />
                <form onSubmit={handleJoin} className="space-y-5">
                  <Field label="Invite link or code" htmlFor="invite-link">
                    <Input
                      id="invite-link"
                      placeholder="https://app.lor.chat/invite/abc123"
                      value={inviteLink}
                      onChange={(e) => setInviteLink(e.target.value)}
                      autoFocus
                    />
                  </Field>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="space-y-2 pt-1">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={!inviteLink.trim()}
                    >
                      Join workspace
                    </Button>
                    <BackButton onClick={() => goTo("choose")} />
                  </div>
                </form>
              </>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-10 flex items-center gap-1.5 text-xs text-muted-foreground">
          {hasWorkspaces ? (
            <Link
              to="/"
              className="font-medium text-foreground/80 hover:text-foreground"
            >
              Back to Lor
            </Link>
          ) : (
            <>
              <span>{email}</span>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="cursor-pointer font-medium text-foreground/80 hover:text-foreground"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-7 space-y-1.5 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-balance text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function ChoiceRow({
  icon,
  title,
  description,
  onClick,
}: {
  icon: IconSvgElement
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-left outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] dark:hover:bg-muted"
    >
      <HugeiconsIcon
        icon={icon}
        className="size-5 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground"
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5"
        strokeWidth={2}
      />
    </button>
  )
}

function JoinRow({
  name,
  logo,
  memberCount,
  joining,
  disabled,
  onJoin,
}: {
  name: string
  logo: string | null
  memberCount: number
  joining: boolean
  disabled: boolean
  onJoin: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
      <WorkspaceAvatar
        name={name}
        logo={logo}
        className="size-8 rounded-lg text-sm"
        imgClassName="rounded-md"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-sm text-muted-foreground">
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </p>
      </div>
      <Button size="sm" disabled={disabled} onClick={onJoin}>
        {joining && <Spinner className="size-4" />}
        Join
      </Button>
    </div>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function BackButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="w-full text-muted-foreground"
      onClick={onClick}
      disabled={disabled}
    >
      <HugeiconsIcon
        icon={ArrowLeft01Icon}
        className="size-4"
        strokeWidth={2}
      />
      Back
    </Button>
  )
}
