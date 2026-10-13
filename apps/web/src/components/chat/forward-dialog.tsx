import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ForwardedMessageCard } from "@/components/chat/forwarded-message-card"
import { useSocket } from "@/context/socket-context"
import type { Message } from "@/lib/api-types"

// Forward a message into a channel's chat as your own post (type
// "forward"), with an optional note. Today: a session message into its
// channel, since Lor never posts in chat itself; the target is a prop so
// chat-to-chat forwards between channels can reuse this with a picker.
export function ForwardDialog({
  message,
  workspaceSlug,
  target,
  onClose,
}: {
  message: Message | null
  workspaceSlug: string
  target: { channelId: string; channelName: string }
  onClose: () => void
}) {
  const socket = useSocket()
  const navigate = useNavigate()
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)

  const forward = () => {
    if (!message || sending) return
    if (!socket?.connected) {
      toast.error("Connection lost — try again")
      return
    }
    setSending(true)
    socket.emit(
      "message:send",
      {
        channelId: target.channelId,
        content: note.trim() || undefined,
        referencedMessageId: message.id,
        forward: true,
        nonce: crypto.randomUUID(),
      },
      (result) => {
        setSending(false)
        if (!result.ok) {
          toast.error("Couldn't forward the message")
          return
        }
        setNote("")
        onClose()
        toast(`Forwarded to #${target.channelName}`, {
          action: {
            label: "View",
            onClick: () =>
              void navigate({
                to: "/$workspaceSlug/$channelId",
                params: { workspaceSlug, channelId: target.channelId },
                search: { msgId: result.message.id },
              }),
          },
        })
      }
    )
  }

  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            Forward to #{target.channelName}
          </DialogTitle>
          <DialogDescription>
            Posts as you in the channel chat, with the message under your note.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                forward()
              }
            }}
            placeholder="Add a note (optional)"
            rows={2}
            maxLength={2000}
            autoFocus
          />
          {message && (
            <ForwardedMessageCard
              preview
              forwarded={{
                messageId: message.id,
                author: {
                  id: message.author.id,
                  name: message.overrideName ?? message.author.name,
                  image: message.author.image,
                },
                content: message.content,
                mentions: message.mentions.map(({ id, name, image }) => ({
                  id,
                  name,
                  image,
                })),
                createdAt: message.createdAt,
                source: {
                  channelId: message.channelId,
                  channelName: null,
                  sessionId: null,
                  sessionTitle: null,
                },
              }}
            />
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={forward} disabled={sending}>
            {sending ? "Forwarding…" : "Forward"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
