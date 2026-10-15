import {
  ApiIcon,
  ArrowRight01Icon,
  File02Icon,
  PlusSignIcon,
  Tick02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  hasUnavailableProfileSelections,
  type ProfileToolGroup,
  profileGroupSelection,
  profileGroupSummary,
  profileSelectedTools,
} from "@repo/connectors"
import type { ProfileToolAccess } from "@repo/db/schema"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  IconTile,
  PILL_BUTTON,
  SettingsBackButton,
  SettingsCardButton,
  SettingsGroup,
  SettingsLink,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { apiClient } from "@/lib/api-client"
import type {
  AgentProfile,
  AgentProfilesResponse,
  AvailableCapability,
  LorCapabilityKey,
} from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"
import {
  ProfileServiceIcon,
  ProfileToolAccessEditor,
} from "./profile-tool-access-editor"

type AvailableCustomTool = AgentProfilesResponse["availableCustomTools"][number]

type ProfileValues = {
  name: string
  capabilities: LorCapabilityKey[]
  customToolIds: string[]
  toolAccess: ProfileToolAccess
}

const NEW_PROFILE = "new"

// A profile grants custom tools either via the blanket capability (all,
// including future tools) or an explicit per-tool list.
export function hasBlanketTools(profile: {
  grantsAll: boolean
  capabilities: LorCapabilityKey[]
}): boolean {
  return profile.grantsAll || profile.capabilities.includes("custom_tools")
}

function toggleIn<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

// A clickable row inside a SettingsGroup. The wrapper carries the group's
// divider so the hover inset can reach past the row's text.
function RowButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <div className="flex flex-col py-1">
      <button
        type="button"
        className={cn(
          "-mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors not-disabled:hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
          className
        )}
        {...props}
      />
    </div>
  )
}

function GrantChip({
  icon,
  mono,
  children,
}: {
  icon: ReactNode
  mono?: boolean
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs text-foreground",
        mono && "font-mono"
      )}
    >
      {icon}
      {children}
    </span>
  )
}

function CapabilityIcon({
  capability,
  className,
}: {
  capability: AvailableCapability
  className?: string
}) {
  if (capability.key === "artifacts" || capability.key === "custom_tools") {
    return (
      <HugeiconsIcon
        icon={capability.key === "artifacts" ? File02Icon : Wrench01Icon}
        className={className}
        strokeWidth={2}
      />
    )
  }
  const Logo = connectorLogo(capability.connector)
  return <Logo className={className} />
}

export function GrantedChips({
  profile,
  available,
  tools,
  groups,
}: {
  profile: AgentProfile
  available: AvailableCapability[]
  tools: AvailableCustomTool[]
  groups: ProfileToolGroup[]
}) {
  const granted = profile.grantsAll
    ? available
    : available.filter((c) => profile.capabilities.includes(c.key))
  const blanket = hasBlanketTools(profile)
  const grantedTools = blanket
    ? []
    : tools.filter((t) => profile.customToolIds.includes(t.id))
  const grantedGroups = groups.filter(
    (group) =>
      profileSelectedTools(
        group.tools.map((tool) => tool.name),
        profileGroupSelection(profile.toolAccess, group)
      ).length > 0
  )

  if (
    granted.length === 0 &&
    grantedTools.length === 0 &&
    grantedGroups.length === 0
  ) {
    return (
      <span className="block text-sm text-muted-foreground">
        Chat & memory only
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {granted.map((capability) => (
        <GrantChip
          key={capability.key}
          icon={
            <CapabilityIcon
              capability={capability}
              className="size-3.5 shrink-0"
            />
          }
        >
          {capability.label}
        </GrantChip>
      ))}
      {grantedTools.map((t) => (
        <GrantChip
          key={t.id}
          mono
          icon={
            <HugeiconsIcon
              icon={ApiIcon}
              className="size-3.5 shrink-0"
              strokeWidth={2}
            />
          }
        >
          {t.name}
        </GrantChip>
      ))}
      {grantedGroups.map((group) => (
        <GrantChip
          key={`${group.kind}:${group.id}`}
          icon={
            <ProfileServiceIcon group={group} className="size-3.5 shrink-0" />
          }
        >
          {group.name} ·{" "}
          {profileGroupSummary(
            group,
            profileGroupSelection(profile.toolAccess, group)
          )}
        </GrantChip>
      ))}
    </span>
  )
}

function SelectRow({
  icon,
  title,
  description,
  selected,
  included,
  mono,
  onToggle,
}: {
  icon: ReactNode
  title: string
  description: string
  selected: boolean
  // Covered by the blanket grant: shown checked but not editable.
  included?: boolean
  mono?: boolean
  onToggle: () => void
}) {
  const checked = selected || included
  return (
    <RowButton
      aria-pressed={checked}
      disabled={included}
      onClick={onToggle}
      className={cn(included && "opacity-60")}
    >
      <IconTile size="sm">{icon}</IconTile>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm", mono && "font-mono")}>
          {title}
        </span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30"
        )}
      >
        {checked && (
          <HugeiconsIcon icon={Tick02Icon} className="size-3" strokeWidth={2} />
        )}
      </span>
    </RowButton>
  )
}

function ProfileList({
  profiles,
  available,
  tools,
  groups,
  focusId,
  onOpen,
}: {
  profiles: AgentProfile[]
  available: AvailableCapability[]
  tools: AvailableCustomTool[]
  groups: ProfileToolGroup[]
  focusId: string | null
  onOpen: (id: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // Back from the editor: return focus to what opened it, or to "New profile"
  // when that profile was just deleted.
  useEffect(() => {
    if (!focusId) return
    const list = listRef.current
    const target =
      list?.querySelector<HTMLElement>(`[data-profile="${focusId}"]`) ??
      list?.querySelector<HTMLElement>(`[data-profile="${NEW_PROFILE}"]`)
    target?.focus({ preventScroll: true })
  }, [])

  return (
    <div ref={listRef}>
      <SettingsSection
        title="Profiles"
        count={profiles.length}
        action={
          <Button
            variant="secondary"
            size="sm"
            className={cn(PILL_BUTTON, "px-3")}
            data-profile={NEW_PROFILE}
            onClick={() => onOpen(NEW_PROFILE)}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            New profile
          </Button>
        }
        caption="A channel uses its own profile, then its category's, then the default. Set profiles in channel or category settings. Lor's memory and chat search are always on."
      >
        <div className="space-y-3">
          {profiles.map((p) => (
            <SettingsCardButton
              key={p.id}
              data-profile={p.id}
              onClick={() => onOpen(p.id)}
              className="gap-4 p-4"
            >
              <span className="block min-w-0 flex-1 space-y-3">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  {p.isDefault && <Badge variant="outline">Default</Badge>}
                </span>
                <GrantedChips
                  profile={p}
                  available={available}
                  tools={tools}
                  groups={groups}
                />
              </span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
            </SettingsCardButton>
          ))}
        </div>
      </SettingsSection>
    </div>
  )
}

function ProfileEditor({
  profile,
  available,
  tools,
  groups,
  saving,
  onSave,
  onCancel,
  onDelete,
  onOpenTools,
}: {
  profile?: AgentProfile
  available: AvailableCapability[]
  tools: AvailableCustomTool[]
  groups: ProfileToolGroup[]
  saving: boolean
  onSave: (values: ProfileValues) => void
  onCancel: () => void
  onDelete?: () => void
  onOpenTools: () => void
}) {
  const nameId = useId()
  const futureToolsId = useId()
  const [name, setName] = useState(profile?.name ?? "")
  const [selected, setSelected] = useState<Set<LorCapabilityKey>>(() => {
    if (!profile) return new Set()
    if (profile.grantsAll) return new Set(available.map((c) => c.key))
    return new Set(
      profile.capabilities.filter((key) =>
        available.some((cap) => cap.key === key)
      )
    )
  })
  const [selectedTools, setSelectedTools] = useState(
    () => new Set(profile?.customToolIds ?? [])
  )
  const [toolAccess, setToolAccess] = useState<ProfileToolAccess>(
    profile?.toolAccess ?? { connectors: {}, mcpServers: {} }
  )

  const handleSave = () => {
    if (
      !name.trim() ||
      saving ||
      hasUnavailableProfileSelections(toolAccess, groups)
    )
      return
    onSave({
      name: name.trim(),
      capabilities: [...selected],
      customToolIds: [...selectedTools],
      toolAccess,
    })
  }

  const generalCaps = available.filter((c) => c.key !== "custom_tools")
  const blanketCap = available.find((c) => c.key === "custom_tools")
  const blanketOn = selected.has("custom_tools")
  const noWorkspaceTools = tools.length === 0

  return (
    <fieldset disabled={saving} className="min-w-0 max-w-3xl space-y-6">
      <div className="space-y-4">
        <SettingsBackButton label="All profiles" onClick={onCancel} />
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">
              {profile ? "Edit profile" : "New profile"}
            </h2>
            {profile?.isDefault && <Badge variant="outline">Default</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Choose what Lor can use in channels with this profile. Approval
            rules still apply.
          </p>
        </div>
        <div className="max-w-md space-y-2">
          <Label htmlFor={nameId}>Profile name</Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Support"
            maxLength={60}
          />
        </div>
      </div>

      <SettingsSection title="Connected services">
        <ProfileToolAccessEditor
          groups={groups}
          value={toolAccess}
          onChange={setToolAccess}
        />
      </SettingsSection>

      <SettingsSection title="Built-in tools">
        <SettingsGroup>
          {generalCaps.length === 0 && (
            <div className="py-3 text-sm text-muted-foreground">
              No tools yet.
            </div>
          )}
          {generalCaps.map((cap) => (
            <SelectRow
              key={cap.key}
              icon={<CapabilityIcon capability={cap} className="size-4" />}
              title={cap.label}
              description={cap.description}
              selected={selected.has(cap.key)}
              onToggle={() => setSelected((prev) => toggleIn(prev, cap.key))}
            />
          ))}
        </SettingsGroup>
      </SettingsSection>

      {blanketCap && (
        <SettingsSection
          title="API tools"
          count={tools.length > 0 ? tools.length : undefined}
        >
          {noWorkspaceTools ? (
            <SettingsGroup>
              <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm text-muted-foreground">
                    No API tools connected
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Add them in{" "}
                    <SettingsLink onClick={onOpenTools}>Tools</SettingsLink>.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Label
                    htmlFor={futureToolsId}
                    className="text-xs font-normal"
                  >
                    Allow future API tools
                  </Label>
                  <Switch
                    id={futureToolsId}
                    checked={blanketOn}
                    onCheckedChange={() =>
                      setSelected((prev) => toggleIn(prev, "custom_tools"))
                    }
                  />
                </div>
              </div>
            </SettingsGroup>
          ) : (
            <SettingsGroup>
              <SelectRow
                icon={
                  <HugeiconsIcon
                    icon={Wrench01Icon}
                    className="size-4"
                    strokeWidth={2}
                  />
                }
                title={blanketCap.label}
                description={blanketCap.description}
                selected={blanketOn}
                onToggle={() =>
                  setSelected((prev) => toggleIn(prev, "custom_tools"))
                }
              />
              {tools.map((tool) => (
                <SelectRow
                  key={tool.id}
                  icon={
                    <HugeiconsIcon
                      icon={ApiIcon}
                      className="size-4"
                      strokeWidth={2}
                    />
                  }
                  title={tool.name}
                  mono
                  description={tool.description}
                  selected={selectedTools.has(tool.id)}
                  included={blanketOn}
                  onToggle={() =>
                    setSelectedTools((prev) => toggleIn(prev, tool.id))
                  }
                />
              ))}
            </SettingsGroup>
          )}
        </SettingsSection>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        {onDelete && (
          <Button
            variant="destructive-outline"
            className={PILL_BUTTON}
            onClick={onDelete}
          >
            Delete profile
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" className={PILL_BUTTON} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className={PILL_BUTTON}
            disabled={
              !name.trim() ||
              hasUnavailableProfileSelections(toolAccess, groups)
            }
            loading={saving}
            onClick={handleSave}
          >
            Save
          </Button>
        </div>
      </div>
    </fieldset>
  )
}

export function AgentProfilesSection({
  workspaceSlug,
  onOpenTools,
}: {
  workspaceSlug: string
  onOpenTools: () => void
}) {
  const queryClient = useQueryClient()
  // A profile id, NEW_PROFILE, or null for the list.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["agent-profiles", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "agent-profiles"
      ].$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load profiles")
      return res.json()
    },
  })

  // The list and the editor share one scroll area; each opens at the top.
  useLayoutEffect(() => {
    topRef.current?.scrollIntoView({ block: "start" })
  }, [editingId])

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["agent-profiles", workspaceSlug],
    })

  const save = useMutation({
    mutationFn: async (input: ProfileValues & { id?: string }) => {
      const profiles =
        apiClient.v1.workspaces[":workspaceSlug"]["agent-profiles"]
      const res = input.id
        ? await profiles[":profileId"].$patch({
            param: { workspaceSlug, profileId: input.id },
            json: {
              name: input.name,
              capabilities: input.capabilities,
              customToolIds: input.customToolIds,
              toolAccess: input.toolAccess,
            },
          })
        : await profiles.$post({
            param: { workspaceSlug },
            json: {
              name: input.name,
              capabilities: input.capabilities,
              customToolIds: input.customToolIds,
              toolAccess: input.toolAccess,
            },
          })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          "message" in error ? error.message : "Failed to save profile"
        )
      }
      return res.json()
    },
    onSuccess: () => {
      invalidate()
      setEditingId(null)
      toast.success("Profile saved")
    },
    onError: (error) => {
      invalidate()
      toast.error(error.message)
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "agent-profiles"
      ][":profileId"].$delete({ param: { workspaceSlug, profileId: id } })
      if (!res.ok) throw new Error("Failed to delete profile")
    },
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
      setEditingId(null)
      toast.success("Profile deleted")
    },
    onError: () => toast.error("Failed to delete profile"),
  })

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
        <p className="text-sm text-muted-foreground">Couldn't load profiles.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const editing =
    editingId === NEW_PROFILE
      ? null
      : data.profiles.find((p) => p.id === editingId)
  const showEditor = editingId === NEW_PROFILE || !!editing

  return (
    <div ref={topRef} className="scroll-mt-6">
      {showEditor ? (
        <ProfileEditor
          key={editingId}
          profile={editing ?? undefined}
          available={data.availableCapabilities}
          tools={data.availableCustomTools}
          groups={data.availableToolGroups}
          saving={save.isPending}
          onSave={(values) => save.mutate({ id: editing?.id, ...values })}
          onCancel={() => setEditingId(null)}
          onDelete={
            editing && !editing.isDefault
              ? () => setDeleteTarget({ id: editing.id, name: editing.name })
              : undefined
          }
          onOpenTools={onOpenTools}
        />
      ) : (
        <ProfileList
          profiles={data.profiles}
          available={data.availableCapabilities}
          tools={data.availableCustomTools}
          groups={data.availableToolGroups}
          focusId={returnFocusId}
          onOpen={(id) => {
            setReturnFocusId(id)
            setEditingId(id)
          }}
        />
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">{deleteTarget?.name}</span>?
              Channels using it fall back to the workspace default profile. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => {
                if (deleteTarget) remove.mutate(deleteTarget.id)
              }}
            >
              Delete Profile
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
