import {
  Delete02Icon,
  Loading03Icon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Input } from "@repo/ui/components/input"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { apiClient } from "@/lib/api-client"
import type {
  AgentProfile,
  AvailableCapability,
  MerlinCapabilityKey,
} from "@/lib/api-types"

function summarize(
  profile: AgentProfile,
  available: AvailableCapability[]
): string {
  if (profile.grantsAll) return "All tools (and any added later)"
  if (profile.capabilities.length === 0) return "Chat & memory only"
  return profile.capabilities
    .map((k) => available.find((c) => c.key === k)?.label ?? k)
    .join(", ")
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

  const toggle = (key: MerlinCapabilityKey, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const handleSave = () => {
    if (!name.trim()) return
    // Preserve any granted capability the editor can't show (its connector is
    // currently disconnected) so editing doesn't silently drop it.
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
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{profile.name}</span>
            {profile.isDefault && <Badge variant="secondary">Default</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {summarize(profile, available)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Edit profile"
            onClick={() => setEditing(true)}
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={14} />
          </Button>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete profile"
              onClick={onDelete}
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Profile name"
        maxLength={60}
      />
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Tools</div>
        {available.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No connectors are connected yet — connect one under Integrations to
            grant tools.
          </p>
        ) : (
          available.map((cap) => (
            <div key={cap.key} className="flex items-start gap-2">
              <Checkbox
                id={`cap-${cap.key}`}
                checked={selected.has(cap.key)}
                onCheckedChange={(v) => toggle(cap.key, v === true)}
                className="mt-0.5"
              />
              <label
                htmlFor={`cap-${cap.key}`}
                className="min-w-0 cursor-pointer"
              >
                <span className="block text-sm">{cap.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {cap.description}
                </span>
              </label>
            </div>
          ))
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
        <HugeiconsIcon
          icon={Loading03Icon}
          size={20}
          className="animate-spin text-muted-foreground"
        />
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
          <HugeiconsIcon icon={PlusSignIcon} size={16} />
          New profile
        </Button>
      )}
    </div>
  )
}
