import {
  Clock01Icon,
  CornerDownRightIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import {
  type InfiniteData,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useSocket } from "@/context/socket-context"
import { ARRIVE_IN } from "@/hooks/use-appended-ids"
import { messagesCacheKey } from "@/hooks/use-lor-stream"
import { runQueueKey, takeFromRunQueue } from "@/hooks/use-run-queue"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"
import { updateMessagesAcrossPages } from "@/lib/message-cache-utils"
import { toSearchPreviewText } from "@/lib/search-preview"

// Messages waiting while Lor works: each waits for the current answer unless
// steered, which hands it to the active run at its next step. In a thread,
// a Codex-style card tucked into the top of the composer (inset + rounded-t
// so it reads as sliding out from behind it). In a session document, waiting
// turns above the input line: faded, with the writer in the gutter.
export function RunQueuePill({
  messages,
  currentUserId,
  pendingNonces,
  onSteer,
  steeringMessageId,
  variant = "box",
}: {
  messages: Message[]
  currentUserId: string | undefined
  // Send nonces still awaiting their created echo — rows whose id is a nonce
  // aren't server-backed yet, so their actions are held.
  pendingNonces?: { current: Set<string> }
  onSteer: (message: Message) => void
  steeringMessageId?: string | null
  variant?: "box" | "document"
}) {
  if (messages.length === 0) return null
  if (variant === "document") {
    return (
      <div className="flex flex-col gap-1 pb-2">
        {messages.map((message) => (
          <QueuedTurn
            key={message.id}
            message={message}
            isOwn={message.authorId === currentUserId}
            isOptimistic={pendingNonces?.current.has(message.id) ?? false}
            isSteering={steeringMessageId === message.id}
            onSteer={onSteer}
          />
        ))}
      </div>
    )
  }
  return (
    <div className="mx-9 overflow-hidden rounded-t-lg border border-b-0 border-input bg-muted/60">
      {messages.map((message) => (
        <QueueRow
          key={message.id}
          message={message}
          isOwn={message.authorId === currentUserId}
          isOptimistic={pendingNonces?.current.has(message.id) ?? false}
          isSteering={steeringMessageId === message.id}
          onSteer={onSteer}
        />
      ))}
    </div>
  )
}

type QueuedProps = {
  message: Message
  isOwn: boolean
  isOptimistic: boolean
  isSteering: boolean
  onSteer: (message: Message) => void
}

// A waiting message in a session: reads as the next turn of the document,
// faded until Lor takes it.
function QueuedTurn({
  message,
  isOwn,
  isOptimistic,
  isSteering,
  onSteer,
}: QueuedProps) {
  const remove = useRemoveQueued(message)
  const pending = isSteering || remove.isPending || isOptimistic
  const action =
    "cursor-pointer transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:text-muted-foreground"

  return (
    <div className={cn(ARRIVE_IN, "flex gap-3")}>
      <div className="w-7 shrink-0 pt-0.5 opacity-60">
        <UserAvatar
          name={message.overrideName ?? message.author.name}
          src={message.author.image}
          avatarColor={message.author.avatarColor}
          size="sm"
          className="size-7"
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 whitespace-pre-wrap text-[15px] text-muted-foreground leading-6">
          {toSearchPreviewText(message.content, message.mentions)}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-muted-foreground/80 text-xs">
          <span className="inline-flex items-center gap-1">
            <HugeiconsIcon
              icon={Clock01Icon}
              className="size-3"
              strokeWidth={2}
            />
            {isSteering
              ? "Steering…"
              : isOwn
                ? "Queued for Lor"
                : `Queued by ${message.overrideName ?? message.author.name}`}
          </span>
          {!isSteering && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => onSteer(message)}
                disabled={pending}
                title="Lor reads it at its next step instead of after this reply"
                className={action}
              >
                Steer now
              </button>
            </>
          )}
          {isOwn && (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => remove.mutate()}
                disabled={pending}
                className={action}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Withdraws a queued message: the queue row first (it needs the message to
// still exist), then the message itself. A queued message was never visible
// in the transcript, so removing it means it was never sent. Both leave the
// screen at once; a failure brings both back.
function useRemoveQueued(message: Message) {
  const socket = useSocket()
  const queryClient = useQueryClient()
  const messagesKey = messagesCacheKey(message.channelId, message.threadRootId)
  return useMutation({
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: messagesKey })
      const previousMessages =
        queryClient.getQueryData<InfiniteData<{ data: Message[] }>>(messagesKey)
      queryClient.setQueryData<InfiniteData<{ data: Message[] }>>(
        messagesKey,
        (old) =>
          old
            ? updateMessagesAcrossPages(old, (messages) =>
                messages.filter((m) => m.id !== message.id)
              )
            : old
      )
      return {
        previousQueue: takeFromRunQueue(queryClient, message),
        previousMessages,
      }
    },
    mutationFn: async () => {
      // Deleting needs the socket — withdrawing the queue row without the
      // delete would post the message instead of removing it.
      if (!socket) throw new Error("Connection lost — try again")
      const res = await apiClient.v1.runs["queued-messages"][
        ":messageId"
      ].$delete({ param: { messageId: message.id } })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't remove this message")
      }
      socket.emit(
        "message:delete",
        { channelId: message.channelId, messageId: message.id },
        (result) => {
          if (!result.ok) toast.error("Couldn't delete the queued message")
        }
      )
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(
        runQueueKey(message.channelId, message.threadRootId),
        context?.previousQueue
      )
      queryClient.setQueryData(messagesKey, context?.previousMessages)
      toast.error(err.message)
    },
  })
}

function QueueRow({
  message,
  isOwn,
  isOptimistic,
  isSteering,
  onSteer,
}: QueuedProps) {
  const remove = useRemoveQueued(message)
  const pending = isSteering || remove.isPending || isOptimistic

  return (
    <div
      className={cn(
        ARRIVE_IN,
        "flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] not-last:border-b not-last:border-border/50"
      )}
    >
      <HugeiconsIcon
        icon={CornerDownRightIcon}
        className="size-3.5 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
      {!isOwn && (
        <span className="shrink-0 font-medium text-muted-foreground">
          {message.overrideName ?? message.author.name}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-foreground/85">
        {toSearchPreviewText(message.content, message.mentions)}
      </span>
      {isSteering ? (
        <span className="shrink-0 text-[11px] italic text-muted-foreground">
          Steering…
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onSteer(message)}
          disabled={pending}
          title={isOwn ? "Steer now (Enter)" : "Steer now"}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <HugeiconsIcon
            icon={CornerDownRightIcon}
            className="size-3 -scale-y-100"
            strokeWidth={2}
          />
          Steer
        </button>
      )}
      {isOwn && (
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={pending}
          aria-label="Remove from queue"
          className="inline-flex shrink-0 cursor-pointer items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <HugeiconsIcon
            icon={Delete02Icon}
            className="size-3"
            strokeWidth={2}
          />
        </button>
      )}
    </div>
  )
}
