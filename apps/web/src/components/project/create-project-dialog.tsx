import {
  FolderOpenIcon,
  Search01Icon,
  SquareLock02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { Textarea } from "@repo/ui/components/textarea"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { apiClient } from "@/lib/api-client"

// A project is a lifecycle-scoped channel group; private (default) restricts
// every channel in it to the selected members.
export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [isPrivate, setIsPrivate] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [memberQuery, setMemberQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: !!workspaceSlug && open,
  })

  const selectableMembers = useMemo(() => {
    const normalized = memberQuery.trim().toLowerCase()
    return (membersData?.members ?? [])
      .filter((m) => !m.isBot && m.userId !== currentUserId)
      .filter((m) => !normalized || m.name.toLowerCase().includes(normalized))
  }, [membersData, currentUserId, memberQuery])

  const reset = () => {
    setName("")
    setDescription("")
    setIsPrivate(true)
    setSelectedIds(new Set())
    setMemberQuery("")
    setError(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const toggleMember = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !workspaceSlug || loading) return
    setError(null)
    setLoading(true)

    try {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].projects.$post({
        param: { workspaceSlug },
        json: {
          name: trimmed,
          description: description.trim() || undefined,
          audience: isPrivate ? "members" : "workspace",
          memberIds: [...selectedIds],
          channels: [{ name: "general", type: "text" }],
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(
          (data as { message?: string } | null)?.message ??
            "Failed to create project"
        )
        return
      }

      const project = await res.json()
      await queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
      await queryClient.invalidateQueries({
        queryKey: ["projects", workspaceSlug],
      })
      handleOpenChange(false)

      const firstChannel = project.channels.find((ch) => ch.type === "text")
      if (firstChannel) {
        navigate({
          to: "/$workspaceSlug/$channelId",
          params: { workspaceSlug, channelId: firstChannel.id },
        })
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={FolderOpenIcon}
              className="size-5 text-muted-foreground"
              strokeWidth={2}
            />
            New project
          </DialogTitle>
          <DialogDescription>
            A group of channels scoped to one unit of work. Archive it when the
            work ships — Lor consolidates what happened into memory.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Mobile launch"
                maxLength={100}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">
                Description
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  optional
                </span>
              </Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project trying to achieve?"
                maxLength={2000}
                rows={2}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <HugeiconsIcon
                  icon={SquareLock02Icon}
                  className="size-4 text-muted-foreground"
                  strokeWidth={2}
                />
                <div>
                  <p className="text-sm font-medium">Private</p>
                  <p className="text-xs text-muted-foreground">
                    Only members can see this project and its channels
                  </p>
                </div>
              </div>
              <Switch
                checked={isPrivate}
                onCheckedChange={(next) => {
                  setIsPrivate(next)
                  // Selection means access (private) vs. roster (workspace) —
                  // don't carry picks across modes.
                  setSelectedIds(new Set())
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>
                Members
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {isPrivate
                    ? "who can access — you're always included"
                    : "the project roster — you're always included"}
                </span>
              </Label>
              <div className="rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <HugeiconsIcon
                    icon={Search01Icon}
                    className="size-3.5 shrink-0 text-muted-foreground"
                    strokeWidth={2}
                  />
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="Search members"
                    className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto p-1">
                  {selectableMembers.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      No members found
                    </p>
                  ) : (
                    selectableMembers.map((m) => (
                      // biome-ignore lint/a11y/useSemanticElements: row is a composite button; the nested Checkbox is decorative, so selection state is exposed here
                      <button
                        key={m.userId}
                        type="button"
                        role="checkbox"
                        aria-checked={selectedIds.has(m.userId)}
                        onClick={() => toggleMember(m.userId)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
                          "hover:bg-accent"
                        )}
                      >
                        <Checkbox
                          checked={selectedIds.has(m.userId)}
                          tabIndex={-1}
                          className="pointer-events-none"
                        />
                        <UserAvatar
                          name={m.name}
                          src={m.image}
                          avatarColor={m.avatarColor}
                          size="sm"
                        />
                        <span className="truncate text-sm">{m.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || loading}>
                {loading && <Spinner className="size-4" />}
                Create project
              </Button>
            </div>
          </form>
        </DialogPanel>
      </DialogContent>
    </Dialog>
  )
}
