import {
  Delete02Icon,
  PencilEdit01Icon,
  PlusSignIcon,
  Tick02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiClient } from "@/lib/api-client"
import type {
  AgentProfile,
  AgentProfilesResponse,
  AvailableCapability,
  MerlinCapabilityKey,
} from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"

type AvailableCustomTool = AgentProfilesResponse["availableCustomTools"][number]

// A profile grants custom tools either via the blanket capability (all,
// including future tools) or an explicit per-tool list.
function hasBlanketTools(profile: {
  grantsAll: boolean
  capabilities: MerlinCapabilityKey[]
}): boolean {
  return profile.grantsAll || profile.capabilities.includes("custom_tools")
}

// Group capabilities by their connector, preserving first-seen order.
function groupByConnector(caps: AvailableCapability[]) {
  const groups: {
    connector: AvailableCapability["connector"]
    connectorLabel: string
    caps: AvailableCapability[]
  }[] = []
  for (const cap of caps) {
    const group = groups.find((g) => g.connector === cap.connector)
    if (group) group.caps.push(cap)
    else
      groups.push({
        connector: cap.connector,
        connectorLabel: cap.connectorLabel,
        caps: [cap],
      })
  }
  return groups
}

function GrantedChips({
  profile,
  available,
  tools,
}: {
  profile: AgentProfile
  available: AvailableCapability[]
  tools: AvailableCustomTool[]
}) {
  const granted = profile.grantsAll
    ? available
    : available.filter((c) => profile.capabilities.includes(c.key))
  const grantedTools = hasBlanketTools(profile)
    ? []
    : tools.filter((t) => profile.customToolIds.includes(t.id))

  if (granted.length === 0 && grantedTools.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">Chat & memory only</span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {granted.map((c) => {
        const Icon = connectorLogo(c.connector)
        return (
          <span
            key={c.key}
            className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-foreground"
          >
            {c.key === "custom_tools" ? (
              <HugeiconsIcon
                icon={Wrench01Icon}
                className="size-3.5 shrink-0"
                strokeWidth={2}
              />
            ) : (
              <Icon className="size-3.5 shrink-0" />
            )}
            {c.label}
          </span>
        )
      })}
      {grantedTools.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground"
        >
          <HugeiconsIcon
            icon={Wrench01Icon}
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
          {t.name}
        </span>
      ))}
    </div>
  )
}

function SelectTile({
  icon,
  title,
  description,
  selected,
  included,
  mono,
  onToggle,
}: {
  icon: React.ReactNode
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
    <button
      type="button"
      aria-pressed={checked}
      disabled={included}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        included
          ? "border-primary/20 bg-primary/5 opacity-60"
          : selected
            ? "cursor-pointer border-primary/40 bg-primary/5"
            : "cursor-pointer border-border hover:bg-accent/40"
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", mono && "font-mono")}>
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">
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
    </button>
  )
}

function CapabilityTile({
  cap,
  selected,
  onToggle,
}: {
  cap: AvailableCapability
  selected: boolean
  onToggle: () => void
}) {
  const Icon = connectorLogo(cap.connector)
  return (
    <SelectTile
      icon={<Icon className="size-5" />}
      title={cap.label}
      description={cap.description}
      selected={selected}
      onToggle={onToggle}
    />
  )
}

function ProfileRow({
  profile,
  available,
  tools,
  onSave,
  onDelete,
  onCancelNew,
  saving,
}: {
  profile?: AgentProfile
  available: AvailableCapability[]
  tools: AvailableCustomTool[]
  onSave: (
    name: string,
    capabilities: MerlinCapabilityKey[],
    customToolIds: string[]
  ) => void
  onDelete?: () => void
  onCancelNew?: () => void
  saving?: boolean
}) {
  const isNew = !profile
  const initialSelected = () => {
    if (!profile) return new Set<MerlinCapabilityKey>()
    if (profile.grantsAll) return new Set(available.map((c) => c.key))
    return new Set(profile.capabilities)
  }
  const initialTools = () => new Set(profile?.customToolIds ?? [])

  const [editing, setEditing] = useState(isNew)
  const [name, setName] = useState(profile?.name ?? "")
  const [selected, setSelected] =
    useState<Set<MerlinCapabilityKey>>(initialSelected)
  const [selectedTools, setSelectedTools] = useState<Set<string>>(initialTools)

  const toggle = (key: MerlinCapabilityKey) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleTool = (id: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = () => {
    if (!name.trim()) return
    const availableKeys = new Set(available.map((c) => c.key))
    const preserved = (profile?.capabilities ?? []).filter(
      (k) => !availableKeys.has(k)
    )
    onSave(
      name.trim(),
      [...new Set([...selected, ...preserved])],
      [...selectedTools]
    )
    if (!isNew) setEditing(false)
  }

  const cancel = () => {
    if (isNew) {
      onCancelNew?.()
      return
    }
    setName(profile?.name ?? "")
    setSelected(initialSelected())
    setSelectedTools(initialTools())
    setEditing(false)
  }

  if (!editing && profile) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-border p-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-sm">{profile.name}</span>
            {profile.isDefault && <Badge variant="secondary">Default</Badge>}
          </div>
          <GrantedChips profile={profile} available={available} tools={tools} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit profile"
            onClick={() => setEditing(true)}
          >
            <HugeiconsIcon
              icon={PencilEdit01Icon}
              className="size-3.5"
              strokeWidth={2}
            />
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete profile"
              onClick={onDelete}
            >
              <HugeiconsIcon
                icon={Delete02Icon}
                className="size-3.5"
                strokeWidth={2}
              />
            </Button>
          )}
        </div>
      </div>
    )
  }

  const generalCaps = available.filter((c) => c.key !== "custom_tools")
  const blanketCap = available.find((c) => c.key === "custom_tools")
  const blanketOn = selected.has("custom_tools")

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Profile name"
        maxLength={60}
      />
      <div className="space-y-2">
        <div className="font-medium text-muted-foreground text-xs">Tools</div>
        {generalCaps.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No connectors are connected yet — connect one under Connectors to
            grant tools.
          </p>
        ) : (
          groupByConnector(generalCaps).map((group) => {
            const Logo = connectorLogo(group.connector)
            return (
              <div key={group.connector ?? "web"} className="space-y-2">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Logo className="size-3.5 shrink-0" />
                  <span className="text-xs font-medium">
                    {group.connectorLabel}
                  </span>
                </div>
                {group.caps.map((cap) => (
                  <CapabilityTile
                    key={cap.key}
                    cap={cap}
                    selected={selected.has(cap.key)}
                    onToggle={() => toggle(cap.key)}
                  />
                ))}
              </div>
            )
          })
        )}
        {blanketCap && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <HugeiconsIcon
                icon={Wrench01Icon}
                className="size-3.5 shrink-0"
                strokeWidth={2}
              />
              <span className="text-xs font-medium">Custom tools</span>
            </div>
            <SelectTile
              icon={
                <HugeiconsIcon
                  icon={Wrench01Icon}
                  className="size-5"
                  strokeWidth={2}
                />
              }
              title={blanketCap.label}
              description={blanketCap.description}
              selected={blanketOn}
              onToggle={() => toggle("custom_tools")}
            />
            {tools.map((tool) => (
              <SelectTile
                key={tool.id}
                icon={
                  <HugeiconsIcon
                    icon={Wrench01Icon}
                    className="size-5"
                    strokeWidth={2}
                  />
                }
                title={tool.name}
                mono
                description={tool.description}
                selected={selectedTools.has(tool.id)}
                included={blanketOn}
                onToggle={() => toggleTool(tool.id)}
              />
            ))}
            {tools.length === 0 && (
              <p className="text-muted-foreground text-xs">
                No custom tools yet — create them in the Custom tools section to
                grant them individually.
              </p>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={cancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!name.trim() || saving}
          onClick={handleSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

export function MerlinProfilesSection({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)

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

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["agent-profiles", workspaceSlug],
    })

  const save = useMutation({
    mutationFn: async (input: {
      id?: string
      name: string
      capabilities: MerlinCapabilityKey[]
      customToolIds: string[]
    }) => {
      const profiles =
        apiClient.v1.workspaces[":workspaceSlug"]["agent-profiles"]
      const res = input.id
        ? await profiles[":profileId"].$patch({
            param: { workspaceSlug, profileId: input.id },
            json: {
              name: input.name,
              capabilities: input.capabilities,
              customToolIds: input.customToolIds,
            },
          })
        : await profiles.$post({
            param: { workspaceSlug },
            json: {
              name: input.name,
              capabilities: input.capabilities,
              customToolIds: input.customToolIds,
            },
          })
      if (!res.ok) throw new Error("Failed to save profile")
      return res.json()
    },
    onSuccess: () => {
      invalidate()
      setCreating(false)
      toast.success("Profile saved")
    },
    onError: () => toast.error("Failed to save profile"),
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

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Profiles control which tools Merlin can use in a channel. A channel
        inherits its category's profile, then the workspace default. Merlin's
        memory and chat search are always available.
      </p>
      {data.profiles.map((p) => (
        <ProfileRow
          key={p.id}
          profile={p}
          available={data.availableCapabilities}
          tools={data.availableCustomTools}
          saving={save.isPending}
          onSave={(name, capabilities, customToolIds) =>
            save.mutate({ id: p.id, name, capabilities, customToolIds })
          }
          onDelete={p.isDefault ? undefined : () => remove.mutate(p.id)}
        />
      ))}
      {creating ? (
        <ProfileRow
          available={data.availableCapabilities}
          tools={data.availableCustomTools}
          saving={save.isPending}
          onSave={(name, capabilities, customToolIds) =>
            save.mutate({ name, capabilities, customToolIds })
          }
          onCancelNew={() => setCreating(false)}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <HugeiconsIcon
            icon={PlusSignIcon}
            className="size-4"
            strokeWidth={2}
          />
          New profile
        </Button>
      )}
    </div>
  )
}
