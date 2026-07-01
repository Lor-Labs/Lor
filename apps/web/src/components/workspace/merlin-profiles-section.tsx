import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import type {
  AgentProfile,
  AvailableCapability,
  MerlinCapabilityKey,
} from "@/lib/api-types"
import { connectorLogo } from "@/lib/connector-ui"

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
}: {
  profile: AgentProfile
  available: AvailableCapability[]
}) {
  const granted = profile.grantsAll
    ? available
    : available.filter((c) => profile.capabilities.includes(c.key))

  if (granted.length === 0) {
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
            <Icon className="size-3.5 shrink-0" />
            {c.label}
          </span>
        )
      })}
    </div>
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
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/5"
          : "border-border hover:bg-accent/40"
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{cap.label}</span>
        <span className="block text-xs text-muted-foreground">
          {cap.description}
        </span>
      </span>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30"
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
    </button>
  )
}

function ProfileRow({
  profile,
  available,
  onSave,
  onDelete,
  onCancelNew,
  saving,
}: {
  profile?: AgentProfile
  available: AvailableCapability[]
  onSave: (name: string, capabilities: MerlinCapabilityKey[]) => void
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

  const [editing, setEditing] = useState(isNew)
  const [name, setName] = useState(profile?.name ?? "")
  const [selected, setSelected] =
    useState<Set<MerlinCapabilityKey>>(initialSelected)

  const toggle = (key: MerlinCapabilityKey) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSave = () => {
    if (!name.trim()) return
    const availableKeys = new Set(available.map((c) => c.key))
    const preserved = (profile?.capabilities ?? []).filter(
      (k) => !availableKeys.has(k)
    )
    onSave(name.trim(), [...new Set([...selected, ...preserved])])
    if (!isNew) setEditing(false)
  }

  const cancel = () => {
    if (isNew) {
      onCancelNew?.()
      return
    }
    setName(profile?.name ?? "")
    setSelected(initialSelected())
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
          <GrantedChips profile={profile} available={available} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit profile"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete profile"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    )
  }

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
        {available.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No connectors are connected yet — connect one under Integrations to
            grant tools.
          </p>
        ) : (
          groupByConnector(available).map((group) => {
            const Logo = connectorLogo(group.connector)
            return (
              <div key={group.connector} className="space-y-2">
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
    }) => {
      const profiles =
        apiClient.v1.workspaces[":workspaceSlug"]["agent-profiles"]
      const res = input.id
        ? await profiles[":profileId"].$patch({
            param: { workspaceSlug, profileId: input.id },
            json: { name: input.name, capabilities: input.capabilities },
          })
        : await profiles.$post({
            param: { workspaceSlug },
            json: { name: input.name, capabilities: input.capabilities },
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
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
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
          saving={save.isPending}
          onSave={(name, capabilities) =>
            save.mutate({ id: p.id, name, capabilities })
          }
          onDelete={p.isDefault ? undefined : () => remove.mutate(p.id)}
        />
      ))}
      {creating ? (
        <ProfileRow
          available={data.availableCapabilities}
          saving={save.isPending}
          onSave={(name, capabilities) => save.mutate({ name, capabilities })}
          onCancelNew={() => setCreating(false)}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          New profile
        </Button>
      )}
    </div>
  )
}
