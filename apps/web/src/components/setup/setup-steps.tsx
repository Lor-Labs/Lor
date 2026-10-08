import {
  ArrowRight01Icon,
  Copy01Icon,
  Tick02Icon,
  UserAdd02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { EASE_OUT } from "@repo/ui/lib/motion"
import { cn } from "@repo/ui/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { type ReactNode, useState } from "react"
import { MorphText } from "@/components/ui/morph-text"
import {
  IconTile,
  PILL_BUTTON,
  SETTINGS_SURFACE,
} from "@/components/workspace/settings-group"
import { apiClient } from "@/lib/api-client"
import type { IntegrationStatus } from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"
import { openGithubConnect } from "@/lib/github-connect"
import { getInviteUrl } from "@/lib/invite-url"
import { openExternal } from "@/lib/open-external"

const INVITE_EXPIRY_MINUTES = 7 * 24 * 60
const COPIED_RESET_MS = 2000

// Done states pop in on the onboarding favicon's snap: damping ratio ~0.8,
// no visible bounce.
const swapMotion = {
  initial: { opacity: 0, scale: 0.85, filter: "blur(2px)" },
  animate: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      scale: { type: "spring", stiffness: 420, damping: 33, mass: 1 },
      opacity: { duration: 0.15, ease: EASE_OUT },
      filter: { duration: 0.2, ease: EASE_OUT },
    },
  },
  exit: {
    opacity: 0,
    scale: 0.85,
    filter: "blur(2px)",
    transition: { duration: 0.12, ease: EASE_OUT },
  },
} as const

function StepRow({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode
  title: string
  detail: ReactNode
  action: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-sm text-muted-foreground">{detail}</p>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {action}
      </AnimatePresence>
    </div>
  )
}

function connectedDetail(p: IntegrationStatus) {
  const account = p.accountLogin ?? "Connected"
  if (p.repoCount === null) return account
  return `${account} · ${p.repoCount} ${p.repoCount === 1 ? "repo" : "repos"}`
}

export function ConnectStep({
  workspaceSlug,
  provider,
  title,
  pitch,
}: {
  workspaceSlug: string
  provider: IntegrationStatus
  title: string
  pitch: string
}) {
  const Logo = connectorLogo(provider.id)
  const blocker = !provider.canManage
    ? "Admin only"
    : provider.connectUrl
      ? null
      : "Unavailable"

  return (
    <StepRow
      icon={
        <IconTile>
          <Logo className="size-5" />
        </IconTile>
      }
      title={title}
      detail={provider.connected ? connectedDetail(provider) : pitch}
      action={
        provider.connected ? (
          <motion.span
            key="done"
            className="flex items-center gap-1.5 pr-1 text-sm text-muted-foreground"
            {...swapMotion}
          >
            <HugeiconsIcon
              icon={Tick02Icon}
              className="size-4 text-foreground"
              strokeWidth={2.5}
            />
            Connected
          </motion.span>
        ) : (
          <motion.span key="connect" {...swapMotion}>
            <Button
              variant="secondary"
              size="sm"
              className={cn(PILL_BUTTON, "px-3")}
              disabled={!!blocker}
              onClick={() => {
                if (provider.id === "github") {
                  void openGithubConnect(workspaceSlug)
                } else if (provider.connectUrl) {
                  openExternal(provider.connectUrl)
                }
              }}
            >
              {blocker ?? "Connect"}
            </Button>
          </motion.span>
        )
      }
    />
  )
}

export function InviteStep({
  workspaceSlug,
  joinedNames,
}: {
  workspaceSlug: string
  joinedNames: string[]
}) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), COPIED_RESET_MS)
    } catch {
      // Safari drops clipboard access after the request's await; the Copy
      // button is right there.
    }
  }

  const createLink = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].invites.$post(
        {
          param: { workspaceSlug },
          json: { expiresInMinutes: INVITE_EXPIRY_MINUTES, maxUses: null },
        }
      )
      if (!res.ok) throw new Error("Failed to create invite")
      const { invite } = await res.json()
      return getInviteUrl(invite.code)
    },
    onSuccess: (url) => {
      setInviteUrl(url)
      void copy(url)
    },
    onError: () => toast.error("Couldn't create an invite link"),
  })

  const joined =
    joinedNames.length === 0
      ? null
      : joinedNames.length === 1
        ? `${joinedNames[0]} joined`
        : `${joinedNames[0]} and ${joinedNames.length - 1} more joined`

  return (
    <StepRow
      icon={
        <IconTile>
          <HugeiconsIcon
            icon={UserAdd02Icon}
            className="size-5"
            strokeWidth={1.5}
          />
        </IconTile>
      }
      title="Invite your team"
      detail={inviteUrl ?? joined ?? "Share a link so teammates can join."}
      action={
        inviteUrl ? (
          <motion.span key="copy" {...swapMotion}>
            <Button
              variant="secondary"
              size="sm"
              className={cn(PILL_BUTTON, "px-3")}
              onClick={() => void copy(inviteUrl)}
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                className="size-4"
                strokeWidth={2}
              />
              <MorphText>{copied ? "Copied" : "Copy"}</MorphText>
            </Button>
          </motion.span>
        ) : (
          <motion.span key="create" {...swapMotion}>
            <Button
              variant="secondary"
              size="sm"
              className={cn(PILL_BUTTON, "px-3")}
              disabled={createLink.isPending}
              onClick={() => createLink.mutate()}
            >
              Create invite link
            </Button>
          </motion.span>
        )
      }
    />
  )
}

export function AskLorSuggestions({
  suggestions,
  onAsk,
}: {
  suggestions: string[]
  onAsk: (question: string) => void
}) {
  return (
    <div className={cn(SETTINGS_SURFACE, "space-y-0.5 p-1")}>
      {suggestions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onAsk(question)}
          className="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] dark:hover:bg-muted"
        >
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">@Lor </span>
            {question}
          </span>
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </button>
      ))}
    </div>
  )
}
