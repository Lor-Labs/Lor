import {
  ArrowDown01Icon,
  Camera01Icon,
  Cancel01Icon,
  CreditCardIcon,
  Layers01Icon,
  LinkSquare02Icon,
  Plug01Icon,
  Scroll01Icon,
  Settings01Icon,
  SquareLock02Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { CodeBlock } from "@repo/ui/components/tool-ui/code-block"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { BillingSection } from "@/components/workspace/billing-section"
import { InstructionsSection } from "@/components/workspace/instructions-section"
import { MerlinProfilesSection } from "@/components/workspace/merlin-profiles-section"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import { apiClient } from "@/lib/api-client"
import type {
  ConnectCloudwatchRequest,
  ConnectDatadogRequest,
} from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"
import { openExternal } from "@/lib/open-external"
import { isAdminOrOwner } from "@/lib/permissions"

const MAX_WORKSPACE_ICON_BYTES = 2 * 1024 * 1024
const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]

function validateIconFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    return "Only JPEG, PNG, WebP, and SVG images are allowed"
  }
  if (file.size > MAX_WORKSPACE_ICON_BYTES) {
    return "Icon must be under 2 MB"
  }
  return null
}

type Workspace = {
  id: string
  name: string
  slug: string
  logo?: string | null
}

export type SectionId =
  | "general"
  | "connectors"
  | "merlin"
  | "instructions"
  | "billing"

const SECTIONS: { id: SectionId; label: string; icon: IconSvgElement }[] = [
  { id: "general", label: "General", icon: Settings01Icon },
  { id: "connectors", label: "Connectors", icon: Plug01Icon },
  { id: "merlin", label: "Agent profiles", icon: Layers01Icon },
  { id: "instructions", label: "Instructions", icon: Scroll01Icon },
  { id: "billing", label: "Billing", icon: CreditCardIcon },
]

// Resolves the URL ?tab= value to a section, so openers don't hand-maintain
// the section list.
export function toSectionId(value: string | undefined): SectionId {
  if (value === "integrations") return "connectors"
  return SECTIONS.some((s) => s.id === value) ? (value as SectionId) : "general"
}

export function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  workspace,
  section,
  onSectionChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspace: Workspace
  section: SectionId
  onSectionChange: (section: SectionId) => void
}) {
  // Billing is admin-only; same queries the sidebar runs, deduped by
  // react-query. Non-admins never see the nav item (server enforces too).
  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspace.slug],
    queryFn: async (): Promise<{ userId: string; role: string } | null> => {
      const res = await authClient.organization.getActiveMember()
      return res.data
        ? {
            userId: res.data.userId as string,
            role: res.data.role as string,
          }
        : null
    },
    enabled: open,
  })
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspace.slug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspace.slug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: open,
  })
  const canManageBilling =
    activeMember && membersData?.ownerId
      ? isAdminOrOwner(activeMember, { ownerId: membersData.ownerId })
      : false
  const sections = SECTIONS.filter(
    (s) => s.id !== "billing" || canManageBilling
  )

  // Close on Escape (no dialog primitive here, so wire it ourselves).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // Nested layers (e.g. the Datadog connect dialog) preventDefault when
      // they dismiss on Escape — don't close settings on the same press.
      if (e.key === "Escape" && !e.defaultPrevented) onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  // Loose focus trap: cycle Tab within the dialog, but only while focus is
  // actually inside it — nested Base UI popups portal outside the container
  // and manage their own focus, so we leave them alone.
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const node = dialogRef.current
    if (!node) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    if (!node.contains(document.activeElement)) node.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !node.contains(document.activeElement)) return
      const focusables = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === node)
      ) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      previouslyFocused?.focus()
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close settings"
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-50 cursor-default bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          />
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace settings"
            className="fixed inset-x-3 inset-y-3 z-50 flex overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-x-8 sm:inset-y-8"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
          >
            {/* Section nav */}
            <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3">
              <div className="truncate px-2 pb-2 text-sm font-semibold text-foreground">
                {workspace.name}
              </div>
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSectionChange(s.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    section === s.id
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  )}
                >
                  <HugeiconsIcon
                    icon={s.icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                  {s.label}
                </button>
              ))}
            </nav>

            {/* Content */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
                <span className="text-sm font-semibold">
                  {SECTIONS.find((s) => s.id === section)?.label}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  aria-label="Close"
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                <div className="mx-auto max-w-2xl">
                  {section === "general" ? (
                    // key on identity so the form resets if the workspace
                    // changes under us (no stale name/icon saved onto another).
                    <GeneralSection
                      key={workspace.id}
                      workspace={workspace}
                      onClose={() => onOpenChange(false)}
                    />
                  ) : section === "connectors" ? (
                    <ConnectorsSection workspaceSlug={workspace.slug} />
                  ) : section === "instructions" ? (
                    <InstructionsSection workspaceSlug={workspace.slug} />
                  ) : section === "billing" && canManageBilling ? (
                    <BillingSection workspaceSlug={workspace.slug} />
                  ) : (
                    <MerlinProfilesSection workspaceSlug={workspace.slug} />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}

function GeneralSection({
  workspace,
  onClose,
}: {
  workspace: Workspace
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(workspace.name)
  const [iconPreview, setIconPreview] = useState<string | null>(null)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const iconPreviewRef = useRef<string | null>(null)
  const dragCountRef = useRef(0)

  useEffect(() => {
    return () => {
      if (iconPreviewRef.current) URL.revokeObjectURL(iconPreviewRef.current)
    }
  }, [])

  const setIconFromFile = useCallback((file: File) => {
    const error = validateIconFile(file)
    if (error) {
      toast.error(error)
      return
    }
    setIconFile(file)
    if (iconPreviewRef.current) URL.revokeObjectURL(iconPreviewRef.current)
    const url = URL.createObjectURL(file)
    iconPreviewRef.current = url
    setIconPreview(url)
  }, [])

  const handleIconSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) setIconFromFile(file)
    },
    [setIconFromFile]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCountRef.current = 0
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) setIconFromFile(file)
    },
    [setIconFromFile]
  )

  const uploadIcon = useCallback(
    async (file: File): Promise<string> => {
      const res = await apiClient.v1.uploads["workspace-icon"].presign.$post({
        json: {
          workspaceId: workspace.id,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        },
      })
      if (!res.ok) throw new Error("Failed to get upload URL")
      const { uploadUrl, fileUrl } = await res.json()
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      })
      if (!uploadRes.ok) throw new Error("Failed to upload icon")
      return fileUrl
    },
    [workspace.id]
  )

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      let logoUrl: string | null | undefined
      if (iconFile) logoUrl = await uploadIcon(iconFile)

      const res = await apiClient.v1.workspaces[":workspaceSlug"].$patch({
        param: { workspaceSlug: workspace.slug },
        json: {
          ...(name.trim() !== workspace.name ? { name: name.trim() } : {}),
          ...(logoUrl !== undefined ? { logo: logoUrl } : {}),
        },
      })
      if (!res.ok) throw new Error("Failed to update workspace")

      setIconFile(null)
      if (iconPreviewRef.current) {
        URL.revokeObjectURL(iconPreviewRef.current)
        iconPreviewRef.current = null
        setIconPreview(null)
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["active-workspace"] }),
      ])
      toast.success("Workspace updated")
      onClose()
    } catch {
      toast.error("Failed to update workspace")
    } finally {
      setIsSaving(false)
    }
  }, [workspace, name, iconFile, uploadIcon, queryClient, onClose])

  const hasChanges = name.trim() !== workspace.name || iconFile !== null
  const isValid = name.trim().length > 0
  const displayIcon = iconPreview ?? workspace.logo

  return (
    <div className="space-y-6">
      <button
        type="button"
        className={cn(
          "flex w-full flex-col items-center gap-4 rounded-lg border-2 border-dashed p-6 transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-transparent"
        )}
        onDragEnter={(e) => {
          e.preventDefault()
          dragCountRef.current += 1
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          dragCountRef.current -= 1
          if (dragCountRef.current === 0) setIsDragging(false)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <span className="group relative shrink-0">
          <WorkspaceAvatar
            name={workspace.name}
            logo={displayIcon}
            className="size-20 rounded-xl text-2xl"
            imgClassName="rounded-lg"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <HugeiconsIcon
              icon={Camera01Icon}
              className="size-5 text-white"
              strokeWidth={2}
            />
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={Upload01Icon}
            className="size-3"
            strokeWidth={2}
          />
          Click or drag & drop to change icon
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
          className="hidden"
          onChange={handleIconSelect}
        />
      </button>

      <div className="space-y-1.5">
        <Label htmlFor="workspace-name">Workspace Name</Label>
        <Input
          id="workspace-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="My Awesome Workspace"
        />
      </div>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || !isValid || isSaving}
        >
          {isSaving && <Spinner className="size-4" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}

// How many repo chips to show before collapsing the rest into a "+N more".
const REPO_DISPLAY_LIMIT = 8

const NOTIFY_OFF = "__off__"

function ConnectorsSection({ workspaceSlug }: { workspaceSlug: string }) {
  const queryClient = useQueryClient()
  const [datadogOpen, setDatadogOpen] = useState(false)
  const [cloudwatchOpen, setCloudwatchOpen] = useState(false)
  const [notionConnect, setNotionConnect] = useState<{
    url: string
    replacing: boolean
  } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<{
    connectionId: string
    name: string
  } | null>(null)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["integrations", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load connectors")
      return res.json()
    },
  })

  const disconnect = useMutation({
    mutationFn: async (connectionId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].$delete({ param: { workspaceSlug, connectionId } })
      if (!res.ok) throw new Error("Failed to disconnect")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("Disconnected")
    },
    onError: () => toast.error("Failed to disconnect"),
  })

  const { data: channelsData } = useQuery({
    queryKey: ["channels", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels.$get(
        { param: { workspaceSlug } }
      )
      if (!res.ok) throw new Error("Failed to load channels")
      return res.json()
    },
  })
  const textChannels = [
    ...(channelsData?.uncategorized ?? []),
    ...(channelsData?.categories ?? []).flatMap((cat) => cat.channels),
  ].filter((ch) => ch.type === "text")
  const notifyChannelItems = [
    { value: NOTIFY_OFF, label: "Off" },
    ...textChannels.map((ch) => ({ value: ch.id, label: `#${ch.name}` })),
  ]

  const updateNotifyChannel = useMutation({
    mutationFn: async (input: {
      connectionId: string
      event: string
      notifyChannelId: string | null
    }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].$patch({
        param: { workspaceSlug, connectionId: input.connectionId },
        json: { event: input.event, notifyChannelId: input.notifyChannelId },
      })
      if (!res.ok) throw new Error("Failed to update notifications")
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
    },
    onError: () => toast.error("Failed to update notifications"),
  })
  const pendingNotify = updateNotifyChannel.isPending
    ? updateNotifyChannel.variables
    : null

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn't load connectors.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>
          Connect tools so Merlin can draw on your team's work and act on it
          when allowed.
        </p>
        <p className="text-xs">
          Agent profiles control which channels can use each connector's tools.
        </p>
      </div>
      {data?.providers.map((p) => {
        const Icon = connectorLogo(p.id)
        const repos = p.repos ?? []
        // `repos` may be capped server-side; repoCount is the true total.
        const repoCount = p.repoCount ?? repos.length
        const showRepos = p.connected && (repoCount > 0 || !!p.manageUrl)
        const showNotify =
          p.connected && !!p.connectionId && p.events.length > 0
        const hasDetails = p.capabilities.length > 0 || showNotify || showRepos
        const isExpanded = expandedId === p.id
        const activeEvents = p.events.filter((ev) => ev.channelId).length
        const statusParts = p.connected
          ? [
              "Connected",
              ...(p.accountLogin ? [p.accountLogin] : []),
              ...(activeEvents > 0
                ? [
                    `posting ${activeEvents} ${activeEvents === 1 ? "event" : "events"}`,
                  ]
                : []),
            ]
          : ["Not connected"]
        return (
          <div key={p.id} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Icon className="size-6 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{p.name}</div>
                  <p className="text-xs text-muted-foreground">
                    {p.description}
                  </p>
                  <div className="mt-1 truncate text-xs text-muted-foreground/80">
                    {statusParts.join(" · ")}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {p.connected && p.connectionId ? (
                  <>
                    {p.id === "notion" && p.canManage && p.connectUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          p.connectUrl &&
                          setNotionConnect({
                            url: p.connectUrl,
                            replacing: true,
                          })
                        }
                      >
                        Reconnect
                      </Button>
                    )}
                    {p.canManage ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disconnect.isPending}
                        onClick={() =>
                          p.connectionId &&
                          setDisconnectTarget({
                            connectionId: p.connectionId,
                            name: p.name,
                          })
                        }
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Admin managed
                      </span>
                    )}
                  </>
                ) : p.authType === "api-key" ? (
                  // Keyed connectors connect via an in-app form, not a redirect.
                  <Button
                    size="sm"
                    disabled={!p.available}
                    onClick={() =>
                      p.id === "cloudwatch"
                        ? setCloudwatchOpen(true)
                        : setDatadogOpen(true)
                    }
                  >
                    {p.available ? "Connect" : "Unavailable"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!p.canManage || !p.connectUrl}
                    onClick={() => {
                      if (!p.connectUrl) return
                      if (p.id === "notion") {
                        setNotionConnect({
                          url: p.connectUrl,
                          replacing: false,
                        })
                        return
                      }
                      openExternal(p.connectUrl)
                    }}
                  >
                    {!p.canManage
                      ? "Admin only"
                      : p.connectUrl
                        ? "Connect"
                        : "Unavailable"}
                  </Button>
                )}
                {hasDetails && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground"
                    aria-expanded={isExpanded}
                    aria-label={
                      isExpanded
                        ? `Hide what ${p.name} can do`
                        : `Show what ${p.name} can do`
                    }
                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                  >
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={cn(
                        "size-4 transition-transform",
                        isExpanded && "rotate-180"
                      )}
                      strokeWidth={2}
                    />
                  </Button>
                )}
              </div>
            </div>

            {isExpanded && p.capabilities.length > 0 && (
              <div className="mt-3 border-border/60 border-t pt-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  What Merlin can do
                </div>
                <ul className="space-y-1.5">
                  {p.capabilities.map((capability) => (
                    <li
                      key={capability.key}
                      className="flex gap-2 text-xs text-muted-foreground/80"
                    >
                      <span
                        className="mt-1.5 size-1 shrink-0 rounded-full bg-current"
                        aria-hidden="true"
                      />
                      <span>{capability.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isExpanded && showNotify && (
              <div className="mt-3 space-y-2 border-border/60 border-t pt-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Post activity to channels
                </div>
                {p.events.map((ev) => (
                  <div
                    key={ev.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 truncate text-xs text-muted-foreground/80">
                      {ev.label}
                    </span>
                    <Select
                      items={notifyChannelItems}
                      value={ev.channelId ?? NOTIFY_OFF}
                      disabled={
                        pendingNotify?.connectionId === p.connectionId &&
                        pendingNotify?.event === ev.key
                      }
                      onValueChange={(value) => {
                        if (!p.connectionId) return
                        updateNotifyChannel.mutate({
                          connectionId: p.connectionId,
                          event: ev.key,
                          notifyChannelId: value === NOTIFY_OFF ? null : value,
                        })
                      }}
                    >
                      <SelectTrigger className="w-44 shrink-0" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NOTIFY_OFF}>Off</SelectItem>
                        {textChannels.map((ch) => (
                          <SelectItem key={ch.id} value={ch.id}>
                            #{ch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}

            {isExpanded && showRepos && (
              <div className="mt-3 border-border/60 border-t pt-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {repoCount > 0
                      ? `${repoCount} ${repoCount === 1 ? "repository" : "repositories"} Merlin can read`
                      : "No repositories"}
                  </span>
                  {p.manageUrl && (
                    <a
                      href={p.manageUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                    >
                      Manage on {p.name}
                      <HugeiconsIcon
                        icon={LinkSquare02Icon}
                        className="size-3"
                        strokeWidth={2}
                      />
                    </a>
                  )}
                </div>
                {repos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {repos.slice(0, REPO_DISPLAY_LIMIT).map((r) => (
                      <span
                        key={r.fullName}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      >
                        {r.private && (
                          <HugeiconsIcon
                            icon={SquareLock02Icon}
                            className="size-2.5 shrink-0"
                            strokeWidth={2}
                          />
                        )}
                        {r.fullName}
                      </span>
                    ))}
                    {repoCount > REPO_DISPLAY_LIMIT && (
                      <span className="px-1.5 py-0.5 text-xs text-muted-foreground">
                        +{repoCount - REPO_DISPLAY_LIMIT} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      <DatadogConnectDialog
        workspaceSlug={workspaceSlug}
        open={datadogOpen}
        onOpenChange={setDatadogOpen}
      />
      <CloudwatchConnectDialog
        workspaceSlug={workspaceSlug}
        open={cloudwatchOpen}
        onOpenChange={setCloudwatchOpen}
      />
      <AlertDialog
        open={!!notionConnect}
        onOpenChange={(open) => {
          if (!open) setNotionConnect(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {notionConnect?.replacing
                ? "Reconnect Notion?"
                : "Connect Notion?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Pages selected here will be available to members of this Lor
              workspace. The Notion member authorizing the connection remains
              responsible for managing which pages it can access.
              {notionConnect?.replacing
                ? " This will replace the current Notion authorization."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                if (notionConnect) openExternal(notionConnect.url)
                setNotionConnect(null)
              }}
            >
              Continue to Notion
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!disconnectTarget}
        onOpenChange={(open) => {
          if (!open) setDisconnectTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Disconnect {disconnectTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Merlin will no longer be able to search{" "}
              {disconnectTarget?.name ?? "this connector"}, and its activity
              posts to channels will stop. You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              onClick={() => {
                if (disconnectTarget) {
                  disconnect.mutate(disconnectTarget.connectionId)
                }
                setDisconnectTarget(null)
              }}
            >
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

type DatadogSite = ConnectDatadogRequest["site"]

// Keyed by the API's site union so a new site is a compile error here.
const DATADOG_SITE_LABELS: Record<DatadogSite, string> = {
  "datadoghq.com": "US1 · datadoghq.com",
  "datadoghq.eu": "EU · datadoghq.eu",
  "us3.datadoghq.com": "US3 · us3.datadoghq.com",
  "us5.datadoghq.com": "US5 · us5.datadoghq.com",
  "ap1.datadoghq.com": "AP1 · ap1.datadoghq.com",
  "ap2.datadoghq.com": "AP2 · ap2.datadoghq.com",
}
const DATADOG_SITES = Object.keys(DATADOG_SITE_LABELS) as DatadogSite[]

function DatadogConnectDialog({
  workspaceSlug,
  open,
  onOpenChange,
}: {
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [site, setSite] = useState<DatadogSite>("datadoghq.com")
  const [apiKey, setApiKey] = useState("")
  const [appKey, setAppKey] = useState("")

  const connect = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.datadog.connect.$post({
        param: { workspaceSlug },
        json: { site, apiKey: apiKey.trim(), appKey: appKey.trim() },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't connect Datadog")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("Datadog connected")
      setApiKey("")
      setAppKey("")
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Datadog</DialogTitle>
          <DialogDescription>
            Paste an API key and an application key with logs read access —
            ideally scoped keys from a service account. They're stored
            encrypted.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="datadog-site">Site</Label>
            <Select
              items={DATADOG_SITES.map((s) => ({
                value: s,
                label: DATADOG_SITE_LABELS[s],
              }))}
              value={site}
              onValueChange={(v) => setSite(v as DatadogSite)}
            >
              <SelectTrigger id="datadog-site" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATADOG_SITES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {DATADOG_SITE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="datadog-api-key">API key</Label>
            <Input
              id="datadog-api-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="datadog-app-key">Application key</Label>
            <Input
              id="datadog-app-key"
              type="password"
              autoComplete="off"
              value={appKey}
              onChange={(e) => setAppKey(e.target.value)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            onClick={() => connect.mutate()}
            disabled={!apiKey.trim() || !appKey.trim() || connect.isPending}
          >
            {connect.isPending && <Spinner className="size-4" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type AwsRegion = ConnectCloudwatchRequest["region"]

// Keyed by the API's region union so a new region is a compile error here.
const AWS_REGION_LABELS: Record<AwsRegion, string> = {
  "us-east-1": "US East (N. Virginia) · us-east-1",
  "us-east-2": "US East (Ohio) · us-east-2",
  "us-west-1": "US West (N. California) · us-west-1",
  "us-west-2": "US West (Oregon) · us-west-2",
  "ca-central-1": "Canada (Central) · ca-central-1",
  "eu-west-1": "Europe (Ireland) · eu-west-1",
  "eu-west-2": "Europe (London) · eu-west-2",
  "eu-west-3": "Europe (Paris) · eu-west-3",
  "eu-central-1": "Europe (Frankfurt) · eu-central-1",
  "eu-north-1": "Europe (Stockholm) · eu-north-1",
  "ap-south-1": "Asia Pacific (Mumbai) · ap-south-1",
  "ap-southeast-1": "Asia Pacific (Singapore) · ap-southeast-1",
  "ap-southeast-2": "Asia Pacific (Sydney) · ap-southeast-2",
  "ap-northeast-1": "Asia Pacific (Tokyo) · ap-northeast-1",
  "ap-northeast-2": "Asia Pacific (Seoul) · ap-northeast-2",
  "sa-east-1": "South America (São Paulo) · sa-east-1",
}
const AWS_REGIONS = Object.keys(AWS_REGION_LABELS) as AwsRegion[]

// One paste-able run for the user (or their agent) with IAM admin access: it
// provisions the read-only IAM user this connector expects — the policy is
// exactly the calls the tools make — and prints the two keys to enter above.
// --no-cli-pager everywhere: the CLI v2 pager would otherwise swallow the
// output and stall the && chain until the user quits less.
const CLOUDWATCH_KEY_COMMAND = `aws iam create-user --user-name lor-cloudwatch --no-cli-pager --output text --query User.Arn && \\
aws iam put-user-policy --user-name lor-cloudwatch --policy-name lor-cloudwatch-readonly --no-cli-pager --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["logs:DescribeLogGroups","logs:StartQuery","logs:GetQueryResults","logs:StopQuery","cloudwatch:ListMetrics","cloudwatch:GetMetricData"],"Resource":"*"}]}' && \\
aws iam create-access-key --user-name lor-cloudwatch --no-cli-pager --output text --query 'AccessKey.[AccessKeyId,SecretAccessKey]'`

function CloudwatchConnectDialog({
  workspaceSlug,
  open,
  onOpenChange,
}: {
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [region, setRegion] = useState<AwsRegion>("us-east-1")
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")

  const connect = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.cloudwatch.connect.$post({
        param: { workspaceSlug },
        json: {
          region,
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't connect CloudWatch")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
      toast.success("CloudWatch connected")
      setAccessKeyId("")
      setSecretAccessKey("")
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect CloudWatch</DialogTitle>
          <DialogDescription>
            Paste an access key for a read-only IAM user with CloudWatch logs
            and metrics read access. It's stored encrypted.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <Collapsible>
            <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                className="size-4 transition-transform group-data-[panel-open]:rotate-180"
              />
              No keys yet? Create them with the AWS CLI
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="space-y-1.5 pt-2">
                <CodeBlock
                  id="cloudwatch-provision-keys"
                  code={CLOUDWATCH_KEY_COMMAND}
                  language="bash"
                  lineNumbers="hidden"
                  // min-w-0 so the block fits the dialog instead of forcing
                  // its min-w-80 floor; long lines scroll horizontally.
                  className="min-w-0"
                />
                <p className="text-xs text-muted-foreground">
                  Run this with the AWS CLI (needs IAM admin) — it creates a
                  read-only user and prints the access key ID and secret to
                  paste below.
                </p>
              </div>
            </CollapsiblePanel>
          </Collapsible>
          <div className="space-y-1.5">
            <Label htmlFor="cloudwatch-region">Region</Label>
            <Select
              items={AWS_REGIONS.map((r) => ({
                value: r,
                label: AWS_REGION_LABELS[r],
              }))}
              value={region}
              onValueChange={(v) => setRegion(v as AwsRegion)}
            >
              <SelectTrigger id="cloudwatch-region" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AWS_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {AWS_REGION_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cloudwatch-access-key-id">Access key ID</Label>
            <Input
              id="cloudwatch-access-key-id"
              autoComplete="off"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cloudwatch-secret-access-key">
              Secret access key
            </Label>
            <Input
              id="cloudwatch-secret-access-key"
              type="password"
              autoComplete="off"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            onClick={() => connect.mutate()}
            disabled={
              !accessKeyId.trim() ||
              !secretAccessKey.trim() ||
              connect.isPending
            }
          >
            {connect.isPending && <Spinner className="size-4" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
