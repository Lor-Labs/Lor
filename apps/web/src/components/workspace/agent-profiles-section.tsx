import { ArrowRight01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  hasUnavailableProfileSelections,
  type ProfileToolGroup,
  profileGroupSelection,
  profileSelectedTools,
} from "@repo/connectors"
import {
  DEFAULT_PROFILE_TOOL_ACCESS,
  type ProfileToolAccess,
} from "@repo/db/schema"
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
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  PILL_BUTTON,
  SettingsBackButton,
  SettingsCardButton,
  SettingsFooter,
  SettingsSection,
} from "@/components/workspace/settings-group"
import { apiClient } from "@/lib/api-client"
import type { AgentProfile } from "@/lib/api-types"
import {
  ProfileServiceIcon,
  ProfileToolAccessEditor,
} from "./profile-tool-access-editor"

type ProfileValues = {
  name: string
  toolAccess: ProfileToolAccess
}

const NEW_PROFILE = "new"

function GrantChip({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs text-foreground">
      {icon}
      {children}
    </span>
  )
}

export function GrantedChips({
  profile,
  groups,
}: {
  profile: AgentProfile
  groups: ProfileToolGroup[]
}) {
  const grantedGroups = groups
    .map((group) => {
      const selection = profileGroupSelection(profile.toolAccess, group)
      const count = profileSelectedTools(
        group.tools.map((tool) => tool.name),
        selection
      ).length
      return { group, count, limited: selection?.mode === "custom" }
    })
    .filter(({ count }) => count > 0)

  if (grantedGroups.length === 0) {
    return (
      <span className="block text-sm text-muted-foreground">
        Chat & memory only
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {grantedGroups.map(({ group, count, limited }) => (
        <GrantChip
          key={`${group.kind}:${group.id}`}
          icon={
            <ProfileServiceIcon group={group} className="size-3.5 shrink-0" />
          }
        >
          {limited
            ? `${group.name} · ${count} ${count === 1 ? "tool" : "tools"}`
            : group.name}
        </GrantChip>
      ))}
    </span>
  )
}

function ProfileList({
  profiles,
  groups,
  focusId,
  onOpen,
}: {
  profiles: AgentProfile[]
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
        caption="Channels use the default profile unless you pick another in channel or category settings."
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
                <GrantedChips profile={p} groups={groups} />
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
  groups,
  saving,
  onSave,
  onCancel,
  onDelete,
  onOpenTools,
}: {
  profile?: AgentProfile
  groups: ProfileToolGroup[]
  saving: boolean
  onSave: (values: ProfileValues) => void
  onCancel: () => void
  onDelete?: () => void
  onOpenTools: () => void
}) {
  const nameId = useId()
  const [name, setName] = useState(profile?.name ?? "")
  const [toolAccess, setToolAccess] = useState<ProfileToolAccess>(
    profile?.toolAccess ?? DEFAULT_PROFILE_TOOL_ACCESS
  )

  const handleSave = () => {
    if (
      !name.trim() ||
      saving ||
      hasUnavailableProfileSelections(toolAccess, groups)
    )
      return
    onSave({ name: name.trim(), toolAccess })
  }

  return (
    <fieldset disabled={saving} className="min-w-0 max-w-3xl space-y-6">
      <div className="space-y-4">
        <SettingsBackButton label="All profiles" onClick={onCancel} />
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate text-lg font-semibold">
              {profile?.name ?? "New profile"}
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

      <ProfileToolAccessEditor
        groups={groups}
        value={toolAccess}
        onChange={setToolAccess}
        onOpenTools={onOpenTools}
      />

      {/* -mb-6 takes over the dialog's bottom padding, so the bar sits at the
          same height while pinned and at the end of the page. */}
      <SettingsFooter className="-mb-6 pb-6">
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
      </SettingsFooter>
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
    // Connectors, MCP servers and API tools change in other tabs (OAuth in the
    // browser), so refetch the available services whenever this tab opens.
    staleTime: 0,
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
            json: { name: input.name, toolAccess: input.toolAccess },
          })
        : await profiles.$post({
            param: { workspaceSlug },
            json: { name: input.name, toolAccess: input.toolAccess },
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
