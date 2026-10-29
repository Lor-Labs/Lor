import {
  ArrowRight01Icon,
  Copy01Icon,
  Delete02Icon,
  ImageAdd01Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  SourceCodeIcon,
  SquareLock02Icon,
  Tick02Icon,
  WebhookIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { env } from "@repo/env/client"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import {
  SettingsBackButton,
  SettingsCard,
  SettingsDisclosureRow,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import {
  formatActWindowShort,
  TriggerEffects,
  type TriggerEffectsValue,
} from "@/components/workspace/trigger-effects"
import { apiClient } from "@/lib/api-client"

const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"]
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const DEFAULT_WEBHOOK_NAME = "New Webhook"

function webhookUrl(id: string, token: string) {
  return `${env.NEXT_PUBLIC_API_URL}/v1/webhooks/${id}/${token}`
}

function validateAvatarFile(file: File): string | null {
  if (!AVATAR_MIME_TYPES.includes(file.type)) {
    return "Only JPEG, PNG, GIF, and WebP images are allowed"
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return "Avatar must be under 2 MB"
  }
  return null
}

async function uploadWebhookAvatar(
  channelId: string,
  file: File
): Promise<string> {
  const res = await apiClient.v1.uploads["webhook-avatar"].presign.$post({
    json: {
      channelId,
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
  if (!uploadRes.ok) throw new Error("Failed to upload avatar")
  return fileUrl
}

function formatCreatedAt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function WebhookAvatar({
  src,
  className,
  iconClassName,
}: {
  src: string | null
  className?: string
  iconClassName?: string
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border border-border bg-card text-muted-foreground",
        className
      )}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <HugeiconsIcon
          icon={WebhookIcon}
          className={iconClassName}
          strokeWidth={2}
        />
      )}
    </span>
  )
}

// The webhook's avatar in the detail header: click or drop an image.
function AvatarPicker({
  src,
  busy,
  onFile,
}: {
  src: string | null
  busy: boolean
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dragCountRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  const selectFile = (file: File) => {
    if (busy) return
    const error = validateAvatarFile(file)
    if (error) {
      toast.error(error)
      return
    }
    onFile(file)
  }

  return (
    <>
      <button
        type="button"
        title="Change avatar: click or drop an image"
        className="group relative shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-wait"
        aria-disabled={busy}
        aria-busy={busy}
        onClick={() => {
          if (!busy) inputRef.current?.click()
        }}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          e.stopPropagation()
          if (busy) return
          dragCountRef.current += 1
          setIsDragging(true)
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = busy ? "none" : "copy"
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dragCountRef.current = Math.max(0, dragCountRef.current - 1)
          if (dragCountRef.current === 0) setIsDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          dragCountRef.current = 0
          setIsDragging(false)
          if (busy) return
          if (e.dataTransfer.files.length > 1) {
            toast.error("Drop one image at a time")
            return
          }
          const file = e.dataTransfer.files[0]
          if (file) selectFile(file)
        }}
        aria-label="Change avatar: click or drop an image"
      >
        <WebhookAvatar
          src={src}
          className={cn(
            "pointer-events-none size-12 rounded-full transition-colors motion-reduce:transition-none",
            isDragging && "border-primary bg-primary/10 ring-2 ring-primary"
          )}
          iconClassName="size-5"
        />
        <span className="pointer-events-none absolute -right-1 -bottom-1 flex items-center justify-center rounded-full border border-border bg-background p-1 text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
          {busy ? (
            <Spinner className="size-3" />
          ) : (
            <HugeiconsIcon
              icon={ImageAdd01Icon}
              className="size-3"
              strokeWidth={2}
            />
          )}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_MIME_TYPES.join(",")}
        className="hidden"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) selectFile(file)
        }}
      />
    </>
  )
}

// What a webhook does with a delivery, for its list row.
function effectsSummary(hook: {
  post: boolean
  actInstructions: string | null
  actWindowSeconds: number
}) {
  const parts = [
    hook.post ? "Posts" : null,
    hook.actInstructions !== null
      ? hook.actWindowSeconds > 0
        ? `Acts, batched ${formatActWindowShort(hook.actWindowSeconds)}`
        : "Acts"
      : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "Does nothing yet"
}

function HowToSend() {
  const rows = [
    [
      "POST",
      <>
        JSON like{" "}
        <code className="text-foreground">{'{ "content": "..." }'}</code> to the
        URL
      </>,
    ],
    [
      "subject",
      <>
        Optional field: deliveries with the same subject share one Lor session
      </>,
    ],
    ["/discord", <>Append to send Discord webhook payloads unchanged</>],
    ["/slack", <>Append to send Slack incoming-webhook payloads unchanged</>],
  ] as const
  return (
    <SettingsGroup>
      <SettingsDisclosureRow
        icon={
          <HugeiconsIcon
            icon={SourceCodeIcon}
            className="size-4"
            strokeWidth={2}
          />
        }
        title="How to send"
        summary="Payload shape, Discord and Slack formats"
      >
        <div className="space-y-2.5 py-3 text-xs text-muted-foreground">
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
            {rows.map(([badge, text]) => (
              <div key={badge} className="contents">
                <Badge
                  variant="outline"
                  size="sm"
                  className="justify-self-start px-1.5 font-mono font-normal"
                >
                  {badge}
                </Badge>
                <span className="min-w-0">{text}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <HugeiconsIcon
              icon={SquareLock02Icon}
              className="size-3.5 shrink-0"
              strokeWidth={2}
            />
            The URL is the credential: treat it like a password.
          </div>
        </div>
      </SettingsDisclosureRow>
    </SettingsGroup>
  )
}

export function ChannelWebhooksTab({
  workspaceSlug,
  channelId,
  channelName,
}: {
  workspaceSlug: string
  channelId: string
  channelName: string | null
}) {
  const queryClient = useQueryClient()
  const [openId, setOpenId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [avatarSavingId, setAvatarSavingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
  } | null>(null)

  const queryKey = ["channel-webhooks", workspaceSlug, channelId]
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].webhooks.$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to load webhooks")
      return res.json()
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].webhooks.$post({
        param: { workspaceSlug, channelId },
        json: { name: DEFAULT_WEBHOOK_NAME },
      })
      if (!res.ok) throw new Error("Failed to create webhook")
      return res.json()
    },
    onSuccess: ({ webhook }) => {
      queryClient.invalidateQueries({ queryKey })
      setOpenId(webhook.id)
      setDraftName(webhook.name)
    },
    onError: () => toast.error("Failed to create webhook"),
  })

  const updateMutation = useMutation({
    mutationFn: async (input: {
      webhookId: string
      name?: string
      avatarUrl?: string
      post?: boolean
      actInstructions?: string | null
      actSessionMode?: TriggerEffectsValue["actSessionMode"]
      actCode?: TriggerEffectsValue["actCode"]
      actWindowSeconds?: number
      hourlyRunCap?: number
      dailyRunCap?: number
    }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].webhooks[":webhookId"].$patch({
        param: { workspaceSlug, channelId, webhookId: input.webhookId },
        json: {
          name: input.name,
          avatarUrl: input.avatarUrl,
          post: input.post,
          actInstructions: input.actInstructions,
          actSessionMode: input.actSessionMode,
          actCode: input.actCode,
          actWindowSeconds: input.actWindowSeconds,
          hourlyRunCap: input.hourlyRunCap,
          dailyRunCap: input.dailyRunCap,
        },
      })
      if (!res.ok) {
        // A refused repo or session mode says why.
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Failed to update webhook")
      }
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (webhookId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].webhooks[":webhookId"].$delete({
        param: { workspaceSlug, channelId, webhookId },
      })
      if (!res.ok) throw new Error("Failed to delete webhook")
    },
    onSuccess: (_, webhookId) => {
      setDeleteTarget(null)
      if (openId === webhookId) setOpenId(null)
      queryClient.invalidateQueries({ queryKey })
    },
    onError: () => toast.error("Failed to delete webhook"),
  })

  const openWebhook = (hookId: string, hookName: string) => {
    setOpenId(hookId)
    setDraftName(hookName)
  }

  const handleCopy = async (id: string, token: string) => {
    try {
      await navigator.clipboard.writeText(webhookUrl(id, token))
    } catch {
      toast.error("Failed to copy webhook URL")
      return
    }
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  const webhooks = data?.webhooks ?? []
  const open = webhooks.find((hook) => hook.id === openId) ?? null
  const target = channelName ? `#${channelName}` : "this channel"

  const deleteDialog = (
    <AlertDialog
      open={deleteTarget !== null}
      onOpenChange={(next) => {
        if (!next) setDeleteTarget(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Webhook</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete{" "}
            <span className="font-semibold">{deleteTarget?.name}</span>? Its URL
            stops working immediately and anything still posting to it will
            fail. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => {
              if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
            }}
          >
            Delete Webhook
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  if (open) {
    const saveName = () => {
      const name = draftName.trim()
      if (!name || name === open.name) return
      updateMutation.mutate({ webhookId: open.id, name })
    }
    return (
      <div className="space-y-6">
        <SettingsBackButton label="Webhooks" onClick={() => setOpenId(null)} />
        <div className="flex items-center gap-3">
          <AvatarPicker
            src={open.avatarUrl}
            busy={avatarSavingId === open.id}
            onFile={async (file) => {
              setAvatarSavingId(open.id)
              try {
                const avatarUrl = await uploadWebhookAvatar(channelId, file)
                updateMutation.mutate(
                  { webhookId: open.id, avatarUrl },
                  { onSettled: () => setAvatarSavingId(null) }
                )
              } catch {
                setAvatarSavingId(null)
                toast.error("Failed to upload avatar")
              }
            }}
          />
          <div className="min-w-0 flex-1">
            {/* The buttons share the name field's row; the caption sits
              under both. */}
            <div className="flex items-center gap-2">
              <Input
                aria-label="Webhook name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={80}
                size="sm"
                className="min-w-0 flex-1"
                onBlur={saveName}
                onKeyDown={(e) => {
                  // Escape closes the dialog without a blur. Enter would
                  // submit the dialog's form (the channel's settings).
                  if (e.key === "Escape") saveName()
                  if (e.key !== "Enter") return
                  e.preventDefault()
                  saveName()
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => handleCopy(open.id, open.token)}
              >
                <HugeiconsIcon
                  icon={copiedId === open.id ? Tick02Icon : Copy01Icon}
                  className="size-3.5"
                  strokeWidth={2}
                />
                Copy URL
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Webhook options"
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                    />
                  }
                >
                  <HugeiconsIcon icon={MoreHorizontalIcon} size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      setDeleteTarget({ id: open.id, name: open.name })
                    }
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={14} />
                    Delete webhook
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Created {formatCreatedAt(open.createdAt)}
              {open.createdByName ? ` by ${open.createdByName}` : ""}
            </p>
          </div>
        </div>

        <SettingsSection title="When data arrives">
          <TriggerEffects
            idPrefix={`webhook-${open.id}`}
            channelLabel={channelName}
            subjectLabel="One session per subject field"
            codeScope={{ workspaceSlug, channelId }}
            disabled={updateMutation.isPending}
            value={{
              post: open.post,
              actInstructions: open.actInstructions,
              actSessionMode: open.actSessionMode,
              actCode: open.actCode,
              actWindowSeconds: open.actWindowSeconds,
              hourlyRunCap: open.hourlyRunCap,
              dailyRunCap: open.dailyRunCap,
              lastAct: open.lastAct,
            }}
            onPatch={(patch) =>
              updateMutation.mutate({ webhookId: open.id, ...patch })
            }
          />
        </SettingsSection>
        {deleteDialog}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Webhooks"
        count={webhooks.length || undefined}
        description={`Let other apps and services post data into ${target}.`}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <Spinner className="size-3.5" />
            ) : (
              <HugeiconsIcon
                icon={PlusSignIcon}
                className="size-3.5"
                strokeWidth={2}
              />
            )}
            New webhook
          </Button>
        }
      >
        {isPending ? (
          <SettingsCard className="flex justify-center">
            <Spinner className="size-4 text-muted-foreground" />
          </SettingsCard>
        ) : webhooks.length === 0 ? (
          <SettingsCard className="py-8 text-center">
            <p className="text-sm">No webhooks yet</p>
            <p className="text-xs text-muted-foreground">
              Create one to get a URL other services can post to.
            </p>
          </SettingsCard>
        ) : (
          <SettingsGroup>
            {webhooks.map((hook) => (
              <div key={hook.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openWebhook(hook.id, hook.name)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <WebhookAvatar
                    src={hook.avatarUrl}
                    className="size-8 rounded-full"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{hook.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {effectsSummary(hook)}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Copy ${hook.name}'s URL`}
                  title="Copy URL"
                  onClick={() => handleCopy(hook.id, hook.token)}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={copiedId === hook.id ? Tick02Icon : Copy01Icon}
                    className="size-3.5"
                    strokeWidth={2}
                  />
                </button>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className="size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
              </div>
            ))}
          </SettingsGroup>
        )}
      </SettingsSection>
      <HowToSend />
      {deleteDialog}
    </div>
  )
}
