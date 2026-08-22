import {
  HashtagIcon,
  Search01Icon,
  SquareLock02Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { CustomSelectItem } from "@repo/ui/components/custom-select-item"
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
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { cn } from "@repo/ui/lib/utils"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { apiClient } from "@/lib/api-client"

const channelTypes = [
  {
    value: "text",
    label: "Text",
    icon: HashtagIcon,
    description: "A text channel for general conversation and discussion",
    disabled: false,
  },
  {
    value: "voice",
    label: "Voice",
    icon: VolumeHighIcon,
    description: "Voice channels are coming soon",
    disabled: true,
  },
] as const

export function CreateChannelDialog({
  open,
  onOpenChange,
  parentId,
  forceType,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  parentId?: string | null
  forceType?: "category"
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const currentUserId = session?.user.id
  const [name, setName] = useState("")
  const [type, setType] = useState<"text" | "voice">("text")
  const [isPrivate, setIsPrivate] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [memberQuery, setMemberQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isCategory = forceType === "category"
  // Channels inside a category inherit its audience — the private toggle
  // only applies to standalone channels.
  const canBePrivate = !isCategory && !parentId

  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: !!workspaceSlug && open && canBePrivate,
  })

  const selectableMembers = useMemo(() => {
    const normalized = memberQuery.trim().toLowerCase()
    return (membersData?.members ?? [])
      .filter((m) => !m.isBot && m.userId !== currentUserId)
      .filter((m) => !normalized || m.name.toLowerCase().includes(normalized))
  }, [membersData, currentUserId, memberQuery])

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
    if (!trimmed || !workspaceSlug) return
    if (forceType !== "category" && !normalizedName) return
    setError(null)
    setLoading(true)

    try {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].channels.$post({
        param: { workspaceSlug },
        json: {
          name: isCategory ? trimmed : normalizedName,
          type: isCategory ? "category" : type,
          ...(parentId && !isCategory ? { parentId } : {}),
          ...(canBePrivate && isPrivate
            ? { audience: "members" as const, memberIds: [...selectedIds] }
            : {}),
        },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(
          (data as { message?: string } | null)?.message ??
            `Failed to create ${isCategory ? "category" : "channel"}`
        )
        return
      }

      const channel = await res.json()
      await queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
      handleOpenChange(false)

      if (!isCategory) {
        navigate({
          to: "/$workspaceSlug/$channelId",
          params: { workspaceSlug, channelId: channel.id },
        })
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setName("")
      setType("text")
      setIsPrivate(false)
      setSelectedIds(new Set())
      setMemberQuery("")
      setError(null)
    }
    onOpenChange(open)
  }

  const normalizedName = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isCategory ? "Create Category" : "Create Channel"}
          </DialogTitle>
          <DialogDescription>
            {isCategory
              ? "Add a new category to organize your channels."
              : "Add a new channel to your workspace."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel
          render={<form onSubmit={handleCreate} />}
          className="space-y-4"
        >
          {!isCategory && (
            <div className="space-y-1.5">
              <Label htmlFor="channel-type">Type</Label>
              <Select
                items={channelTypes.map((ct) => ({
                  value: ct.value,
                  label: ct.label,
                }))}
                value={type}
                onValueChange={(v) => setType(v as "text" | "voice")}
              >
                <SelectTrigger size="lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end" alignItemWithTrigger={false}>
                  {channelTypes.map((ct) => (
                    <CustomSelectItem
                      key={ct.value}
                      value={ct.value}
                      tooltip={ct.description}
                      side="right"
                      disabled={ct.disabled}
                    >
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon
                          icon={ct.icon}
                          className="size-4 text-muted-foreground"
                          strokeWidth={2}
                        />
                        {ct.label}
                      </div>
                    </CustomSelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              id="channel-name"
              size="lg"
              placeholder={isCategory ? "Community" : "general"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              autoFocus
            />
            {!isCategory &&
              normalizedName &&
              normalizedName !== name.trim() && (
                <p className="text-xs text-muted-foreground">
                  Will be created as{" "}
                  <span className="font-mono">#{normalizedName}</span>
                </p>
              )}
          </div>
          {canBePrivate && (
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
                    Only selected members can see this channel
                  </p>
                </div>
              </div>
              <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
            </div>
          )}
          {canBePrivate && isPrivate && (
            <div className="space-y-1.5">
              <Label>
                Members
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  you're always included
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
                <div className="max-h-36 overflow-y-auto p-1">
                  {selectableMembers.length === 0 ? (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      No members found
                    </p>
                  ) : (
                    selectableMembers.map((m) => (
                      <button
                        key={m.userId}
                        type="button"
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
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={
              loading || !name.trim() || (!isCategory && !normalizedName)
            }
          >
            {loading && <Spinner className="mr-2 size-4" />}
            {isCategory ? "Create Category" : "Create Channel"}
          </Button>
        </DialogPanel>
      </DialogContent>
    </Dialog>
  )
}
