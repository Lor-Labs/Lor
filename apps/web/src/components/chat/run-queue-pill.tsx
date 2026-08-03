import { useMutation } from "@tanstack/react-query"
import { CornerDownRight, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useSocket } from "@/context/socket-context"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"

// Codex-style queue card tucked into the top of the thread composer while
// Merlin is working: each queued message waits for the current answer unless
// steered — which stops the active run immediately and reprompts with the
// queue. Inset + rounded-t only so it reads as a card sliding out from
// behind the composer.
export function RunQueuePill({
  messages,
  currentUserId,
}: {
  messages: Message[]
  currentUserId: string | undefined
}) {
  if (messages.length === 0) return null
  return (
    <div className="mx-9 overflow-hidden rounded-t-lg border border-b-0 border-input bg-muted/60">
      {messages.map((message) => (
        <QueueRow
          key={message.id}
          message={message}
          isOwn={message.authorId === currentUserId}
        />
      ))}
    </div>
  )
}

function QueueRow({ message, isOwn }: { message: Message; isOwn: boolean }) {
  const socket = useSocket()
  const steer = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.runs["queued-messages"][
        ":messageId"
      ].steer.$post({ param: { messageId: message.id } })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't steer this message")
      }
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: async () => {
      // Withdraw the queue row first (needs the message to still exist),
      // then delete the message itself — a queued message was never visible
      // in the transcript, so removing it means it was never sent.
      const res = await apiClient.v1.runs["queued-messages"][
        ":messageId"
      ].$delete({ param: { messageId: message.id } })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't remove this message")
      }
      socket?.emit(
        "message:delete",
        { channelId: message.channelId, messageId: message.id },
        (result) => {
          if (!result.ok) toast.error("Couldn't delete the queued message")
        }
      )
    },
    onError: (err) => toast.error(err.message),
  })

  const pending = steer.isPending || remove.isPending

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] not-last:border-b not-last:border-border/50">
      <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
      {!isOwn && (
        <span className="shrink-0 font-medium text-muted-foreground">
          {message.overrideName ?? message.author.name}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-foreground/85">
        {message.content}
      </span>
      {steer.isPending ? (
        <span className="shrink-0 text-[11px] italic text-muted-foreground">
          Steering…
        </span>
      ) : (
        <button
          type="button"
          onClick={() => steer.mutate()}
          disabled={pending}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <CornerDownRight className="size-3 -scale-y-100" />
          Steer
        </button>
      )}
      {isOwn && (
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={pending}
          aria-label="Remove from queue"
          className="inline-flex shrink-0 cursor-pointer items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  )
}
