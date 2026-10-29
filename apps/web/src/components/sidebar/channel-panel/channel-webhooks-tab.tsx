import {
  ArrowDown01Icon,
  Clock01Icon,
  ImageAdd01Icon,
  PlusSignIcon,
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { MorphText } from "@/components/ui/morph-text"
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
        "flex shrink-0 items-center justify-center overflow-hidden border border-border bg-muted text-muted-foreground",
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

// Large avatar with an image-picker badge, for the expanded editor.
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
        className="group flex shrink-0 cursor-pointer flex-col items-center gap-2 self-start rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring aria-disabled:cursor-wait"
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
        <span className="pointer-events-none relative">
          <WebhookAvatar
            src={src}
            className={cn(
              "size-20 rounded-xl transition-colors motion-reduce:transition-none",
              isDragging && "border-primary bg-primary/10 ring-2 ring-primary"
            )}
            iconClassName="size-8"
          />
          <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full border border-border bg-background p-1.5 text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
            {busy ? (
              <Spinner className="size-3.5" />
            ) : (
              <HugeiconsIcon
                icon={ImageAdd01Icon}
                className="size-3.5"
                strokeWidth={2}
              />
            )}
          </span>
        </span>
        <span
          className={cn(
            "pointer-events-none text-[11px] text-muted-foreground",
            isDragging && "text-primary"
          )}
        >
          {busy ? "Uploading…" : isDragging ? "Drop image" : "Click or drop"}
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
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey })
    },
    onError: () => toast.error("Failed to delete webhook"),
  })

  const handleToggle = (hookId: string, hookName: string) => {
    if (openId === hookId) {
      setOpenId(null)
      return
    }
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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Incoming webhooks</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Let other apps and services post data into{" "}
            {channelName ? `#${channelName}` : "this channel"}.
          </p>
        </div>
        <Button
          type="button"
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
          New Webhook
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          <Badge
            variant="outline"
            size="sm"
            className="justify-self-start px-1.5 font-mono font-normal"
          >
            POST
          </Badge>
          <span className="min-w-0">
            Send JSON like{" "}
            <code className="text-foreground">{'{ "content": "..." }'}</code> to
            the webhook URL
          </span>
          <Badge
            variant="outline"
            size="sm"
            className="justify-self-start px-1.5 font-mono font-normal"
          >
            /discord
          </Badge>
          <span className="min-w-0">
            Append to the URL to send Discord webhook payloads unchanged
          </span>
          <Badge
            variant="outline"
            size="sm"
            className="justify-self-start px-1.5 font-mono font-normal"
          >
            /slack
          </Badge>
          <span className="min-w-0">
            Append to the URL to send Slack incoming-webhook payloads unchanged
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 border-border border-t pt-2.5 text-xs text-muted-foreground">
          <HugeiconsIcon
            icon={SquareLock02Icon}
            className="size-3.5 shrink-0"
            strokeWidth={2}
          />
          The URL is the credential — treat it like a password.
        </div>
      </div>

      {isPending ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <Empty className="py-8 md:py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="mb-3">
              <HugeiconsIcon icon={WebhookIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle className="text-sm">No webhooks yet</EmptyTitle>
            <EmptyDescription className="text-xs">
              Create one to get a URL other services can post to.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {webhooks.map((hook) => {
              const isOpen = openId === hook.id
              const nameDirty =
                isOpen &&
                draftName.trim().length > 0 &&
                draftName.trim() !== hook.name
              return (
                <li
                  key={hook.id}
                  className="rounded-lg border border-border bg-muted/20"
                >
                  <button
                    type="button"
                    onClick={() => handleToggle(hook.id, hook.name)}
                    className="flex w-full cursor-pointer items-center gap-3 p-3 text-left"
                  >
                    <WebhookAvatar
                      src={hook.avatarUrl}
                      className="size-12 rounded-full"
                      iconClassName="size-5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {hook.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <HugeiconsIcon
                          icon={Clock01Icon}
                          className="size-3"
                          strokeWidth={2}
                        />
                        <span className="truncate">
                          Created on {formatCreatedAt(hook.createdAt)}
                          {hook.createdByName
                            ? ` by ${hook.createdByName}`
                            : ""}
                        </span>
                      </div>
                    </div>
                    {!isOpen && (
                      <div className="hidden shrink-0 items-center gap-1 sm:flex">
                        {hook.post && (
                          <Badge variant="outline" size="sm">
                            Post
                          </Badge>
                        )}
                        {hook.actInstructions !== null && (
                          <>
                            <Badge variant="outline" size="sm">
                              Act
                            </Badge>
                            {hook.actWindowSeconds > 0 && (
                              <span className="text-[11px] text-muted-foreground">
                                batched{" "}
                                {formatActWindowShort(hook.actWindowSeconds)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        isOpen && "rotate-180"
                      )}
                      strokeWidth={2}
                    />
                  </button>

                  {isOpen && (
                    <div className="border-border border-t p-4">
                      <div className="flex gap-5">
                        <AvatarPicker
                          src={hook.avatarUrl}
                          busy={avatarSavingId === hook.id}
                          onFile={async (file) => {
                            setAvatarSavingId(hook.id)
                            try {
                              const avatarUrl = await uploadWebhookAvatar(
                                channelId,
                                file
                              )
                              updateMutation.mutate(
                                { webhookId: hook.id, avatarUrl },
                                {
                                  onSettled: () => setAvatarSavingId(null),
                                }
                              )
                            } catch {
                              setAvatarSavingId(null)
                              toast.error("Failed to upload avatar")
                            }
                          }}
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <Label htmlFor={`webhook-name-${hook.id}`}>
                            Name
                          </Label>
                          <Input
                            id={`webhook-name-${hook.id}`}
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            maxLength={80}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && nameDirty) {
                                e.preventDefault()
                                updateMutation.mutate({
                                  webhookId: hook.id,
                                  name: draftName.trim(),
                                })
                              }
                            }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 space-y-2 border-border border-t pt-4">
                        <div className="text-xs font-medium text-muted-foreground">
                          When data arrives
                        </div>
                        <TriggerEffects
                          idPrefix={`webhook-${hook.id}`}
                          channelLabel={channelName}
                          subjectLabel="One session per subject field"
                          codeScope={{ workspaceSlug, channelId }}
                          disabled={updateMutation.isPending}
                          value={{
                            post: hook.post,
                            actInstructions: hook.actInstructions,
                            actSessionMode: hook.actSessionMode,
                            actCode: hook.actCode,
                            actWindowSeconds: hook.actWindowSeconds,
                            hourlyRunCap: hook.hourlyRunCap,
                            dailyRunCap: hook.dailyRunCap,
                            lastAct: hook.lastAct,
                          }}
                          onPatch={(patch) =>
                            updateMutation.mutate({
                              webhookId: hook.id,
                              ...patch,
                            })
                          }
                        />
                      </div>

                      <div className="mt-4 flex items-center gap-2 border-border border-t pt-4">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => handleCopy(hook.id, hook.token)}
                        >
                          {copiedId === hook.id && (
                            <HugeiconsIcon
                              icon={Tick02Icon}
                              className="size-3.5"
                              strokeWidth={2}
                            />
                          )}
                          Copy Webhook URL
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteMutation.isPending}
                          onClick={() =>
                            setDeleteTarget({ id: hook.id, name: hook.name })
                          }
                        >
                          Delete Webhook
                        </Button>
                        {nameDirty && (
                          <Button
                            type="button"
                            size="sm"
                            className="ml-auto"
                            disabled={updateMutation.isPending}
                            onClick={() =>
                              updateMutation.mutate({
                                webhookId: hook.id,
                                name: draftName.trim(),
                              })
                            }
                          >
                            <MorphText>
                              {updateMutation.isPending ? "Saving..." : "Save"}
                            </MorphText>
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Webhook</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">{deleteTarget?.name}</span>? Its
              URL stops working immediately and anything still posting to it
              will fail. This action cannot be undone.
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
    </div>
  )
}
