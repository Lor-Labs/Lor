import { FocusScope } from "@radix-ui/react-focus-scope"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Camera,
  ExternalLink,
  Layers,
  Loader2,
  Lock,
  Plug,
  Settings,
  Upload,
  X,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { MerlinProfilesSection } from "@/components/workspace/merlin-profiles-section"
import { apiClient } from "@/lib/api-client"
import type { ConnectDatadogRequest } from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"

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

export type SectionId = "general" | "integrations" | "merlin"

const SECTIONS: { id: SectionId; label: string; icon: typeof Settings }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "merlin", label: "Agent profiles", icon: Layers },
]

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
  // Close on Escape (no Radix here, so wire it ourselves).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

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
          {/* Trap + restore focus (no Radix Dialog here, so wire it ourselves). */}
          <FocusScope asChild loop trapped>
            <motion.div
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
                {SECTIONS.map((s) => (
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
                    <s.icon className="size-4" />
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
                    <X className="size-4" />
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
                    ) : section === "integrations" ? (
                      <IntegrationsSection workspaceSlug={workspace.slug} />
                    ) : (
                      <MerlinProfilesSection workspaceSlug={workspace.slug} />
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          </FocusScope>
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
  const initials = workspace.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)

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
          <Avatar className="size-20">
            {displayIcon && (
              <AvatarImage src={displayIcon} alt={workspace.name} />
            )}
            <AvatarFallback className="text-lg font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="size-5 text-white" />
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Upload className="size-3" />
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
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}

// How many repo chips to show before collapsing the rest into a "+N more".
const REPO_DISPLAY_LIMIT = 8

function IntegrationsSection({ workspaceSlug }: { workspaceSlug: string }) {
  const queryClient = useQueryClient()
  const [datadogOpen, setDatadogOpen] = useState(false)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["integrations", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].integrations.$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load integrations")
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

  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn't load integrations.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect tools so Merlin can draw on your team's work — searching pull
        requests, issues, code, and logs on demand, and summarizing what matters
        into your workspace's memory.
      </p>
      {data?.providers.map((p) => {
        const Icon = connectorLogo(p.id)
        const repos = p.repos ?? []
        // `repos` may be capped server-side; repoCount is the true total.
        const repoCount = p.repoCount ?? repos.length
        const showRepos = p.connected && (repoCount > 0 || !!p.manageUrl)
        return (
          <div key={p.id} className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <Icon className="size-6 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.connected
                      ? `Connected${p.accountLogin ? ` · ${p.accountLogin}` : ""}`
                      : "Not connected"}
                  </div>
                </div>
              </div>
              {p.connected && p.connectionId ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disconnect.isPending}
                  onClick={() =>
                    p.connectionId && disconnect.mutate(p.connectionId)
                  }
                >
                  Disconnect
                </Button>
              ) : p.authType === "api-key" ? (
                // Keyed connectors connect via an in-app form, not a redirect.
                // Datadog is the only one today.
                <Button
                  size="sm"
                  disabled={!p.available}
                  onClick={() => setDatadogOpen(true)}
                >
                  {p.available ? "Connect" : "Unavailable"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!p.connectUrl}
                  onClick={() => {
                    if (p.connectUrl) window.location.href = p.connectUrl
                  }}
                >
                  {p.connectUrl ? "Connect" : "Unavailable"}
                </Button>
              )}
            </div>

            {showRepos && (
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
                      <ExternalLink className="size-3" />
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
                        {r.private && <Lock className="size-2.5 shrink-0" />}
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
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="datadog-site">Site</Label>
            <Select
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
        </div>
        <DialogFooter>
          <Button
            onClick={() => connect.mutate()}
            disabled={!apiKey.trim() || !appKey.trim() || connect.isPending}
          >
            {connect.isPending && <Loader2 className="size-4 animate-spin" />}
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
