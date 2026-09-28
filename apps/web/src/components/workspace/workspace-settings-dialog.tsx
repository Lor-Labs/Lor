import {
  Camera01Icon,
  Cancel01Icon,
  CheckmarkSquare02Icon,
  // CreditCardIcon,
  Layers01Icon,
  Plug01Icon,
  Scroll01Icon,
  Settings01Icon,
  Upload01Icon,
  UserGroupIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useDesktopChrome } from "@/components/desktop-window-frame"
import { AgentProfilesSection } from "@/components/workspace/agent-profiles-section"
import { ApprovalsSection } from "@/components/workspace/approvals-section"
import { BillingSection } from "@/components/workspace/billing-section"
import { ConnectorsSection } from "@/components/workspace/connectors-section"
import { CustomToolsSection } from "@/components/workspace/custom-tools-section"
import { InstructionsSection } from "@/components/workspace/instructions-section"
import { MembersRolesSection } from "@/components/workspace/members-roles-section"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import { useDesktopZoom } from "@/context/desktop-zoom-context"
import { apiClient } from "@/lib/api-client"
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
  | "members"
  | "connectors"
  | "custom-tools"
  | "agent"
  | "approvals"
  | "instructions"
  | "billing"

const SECTIONS: { id: SectionId; label: string; icon: IconSvgElement }[] = [
  { id: "general", label: "General", icon: Settings01Icon },
  { id: "members", label: "Members & Roles", icon: UserGroupIcon },
  { id: "connectors", label: "Connectors", icon: Plug01Icon },
  { id: "custom-tools", label: "Tools", icon: Wrench01Icon },
  { id: "agent", label: "Agent profiles", icon: Layers01Icon },
  { id: "approvals", label: "Approvals", icon: CheckmarkSquare02Icon },
  { id: "instructions", label: "LOR.md", icon: Scroll01Icon },
  // Billing tab hidden pre-launch (LOR-87 PR). Restoring it = uncomment this
  // line + the CreditCardIcon import; the "billing" SectionId, its render
  // branch, and canManageBilling gating are all left intact.
  // { id: "billing", label: "Billing", icon: CreditCardIcon },
]

// Resolves the URL ?tab= value to a section, so openers don't hand-maintain
// the section list.
export function toSectionId(value: string | undefined): SectionId {
  if (value === "integrations") return "connectors"
  if (value === "roles") return "members"
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
  const { isMacDesktop, isFullscreen } = useDesktopChrome()
  const zoom = useDesktopZoom()
  const appScale = (zoom?.levels.app ?? 100) / 100

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
  // Approval policies ride the same admin-or-owner tier (the API enforces the
  // approval:manage grant regardless).
  const sections = SECTIONS.filter(
    (s) => (s.id !== "billing" && s.id !== "approvals") || canManageBilling
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
            style={
              isMacDesktop && !isFullscreen
                ? { top: `max(2rem, ${56 / appScale}px)` }
                : undefined
            }
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
                  ) : section === "members" ? (
                    <MembersRolesSection
                      workspaceId={workspace.id}
                      workspaceSlug={workspace.slug}
                      // Role management rides the same admin-or-owner tier
                      canManageRoles={canManageBilling}
                    />
                  ) : section === "connectors" ? (
                    <ConnectorsSection
                      workspaceSlug={workspace.slug}
                      onOpenAgentProfiles={() => onSectionChange("agent")}
                    />
                  ) : section === "custom-tools" ? (
                    <CustomToolsSection
                      workspaceSlug={workspace.slug}
                      onOpenAgentProfiles={() => onSectionChange("agent")}
                    />
                  ) : section === "approvals" && canManageBilling ? (
                    <ApprovalsSection
                      workspaceId={workspace.id}
                      workspaceSlug={workspace.slug}
                    />
                  ) : section === "instructions" ? (
                    <InstructionsSection workspaceSlug={workspace.slug} />
                  ) : section === "billing" && canManageBilling ? (
                    <BillingSection workspaceSlug={workspace.slug} />
                  ) : (
                    <AgentProfilesSection
                      workspaceSlug={workspace.slug}
                      onOpenConnectors={() => onSectionChange("connectors")}
                      onOpenTools={() => onSectionChange("custom-tools")}
                    />
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
