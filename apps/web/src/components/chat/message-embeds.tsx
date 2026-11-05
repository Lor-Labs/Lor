import { authClient } from "@repo/auth/client"
import { workspaceAuthorityHasPermissions } from "@repo/auth/permissions"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import { toast } from "@repo/ui/components/toast"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useState } from "react"
import { EmbedCard } from "@/components/chat/embed-card"
import {
  isAttioRecording,
  MeetingRecordingCard,
} from "@/components/chat/meeting-recording-card"
import { toCustomRoleMap, useWorkspaceRoles } from "@/hooks/use-workspace-roles"
import { apiClient } from "@/lib/api-client"
import type { Message } from "@/lib/api-types"

// Remove link preview (LOR-138): the author, or anyone with "Delete others'
// messages", can hide a link preview for everyone. The server re-checks.
function useCanRemoveEmbeds(
  workspaceSlug: string | undefined,
  isOwnMessage: boolean
): boolean {
  const checkRole = !!workspaceSlug && !isOwnMessage
  // Same queries the approval card runs, deduped by react-query.
  const { data: activeMember } = useQuery({
    queryKey: ["active-workspace-member", workspaceSlug],
    queryFn: async (): Promise<{ userId: string; role: string } | null> => {
      const res = await authClient.organization.getActiveMember()
      return res.data
        ? { userId: res.data.userId as string, role: res.data.role as string }
        : null
    },
    enabled: checkRole,
  })
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug: workspaceSlug as string },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
    enabled: checkRole,
  })
  const { data: customRoles } = useWorkspaceRoles(
    checkRole ? membersData?.workspaceId : undefined
  )

  if (!workspaceSlug) return false
  if (isOwnMessage) return true
  if (!activeMember || !membersData?.ownerId) return false
  return workspaceAuthorityHasPermissions(
    {
      role: activeMember.role,
      isOwner: membersData.ownerId === activeMember.userId,
      customGrants: toCustomRoleMap(customRoles)[activeMember.role] ?? null,
    },
    { message: ["delete"] }
  )
}

export function MessageEmbeds({
  message,
  isOwnMessage,
  readOnly = false,
}: {
  message: Message
  isOwnMessage: boolean
  readOnly?: boolean
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const removable =
    !readOnly &&
    message.embeds.some((embed) => embed.type === "link" && embed.url)
  const canRemove = useCanRemoveEmbeds(
    removable ? workspaceSlug : undefined,
    isOwnMessage
  )
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  // Hidden at once; the embeds:updated broadcast then drops it for everyone.
  const [removedUrls, setRemovedUrls] = useState<string[]>([])

  const handleRemoveConfirm = async () => {
    const url = pendingUrl
    setPendingUrl(null)
    if (!url || !workspaceSlug) return
    setRemovedUrls((urls) => [...urls, url])
    const restore = () =>
      setRemovedUrls((urls) => urls.filter((removed) => removed !== url))
    try {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].messages[":messageId"].embeds.$delete({
        param: {
          workspaceSlug,
          channelId: message.channelId,
          messageId: message.id,
        },
        query: { url },
      })
      if (!res.ok) {
        restore()
        toast.error("Couldn't remove the preview")
      }
    } catch {
      restore()
      toast.error("Couldn't remove the preview")
    }
  }

  const embeds = message.embeds.filter(
    (embed) =>
      !(embed.type === "link" && embed.url && removedUrls.includes(embed.url))
  )
  if (embeds.length === 0) return null
  // Keyed by URL and its occurrence, not position: removing an earlier
  // preview must not remount the cards after it.
  const seen = new Map<string, number>()
  const keys = embeds.map((embed) => {
    const url = embed.url ?? ""
    const n = seen.get(url) ?? 0
    seen.set(url, n + 1)
    return `${url}#${n}`
  })

  return (
    <>
      <div className="flex flex-col gap-1">
        {embeds.map((embed, index) =>
          isAttioRecording(embed) ? (
            <MeetingRecordingCard
              // recordingId keeps card state (transcript expand) pinned
              // to the recording if embeds reorder; eventLabel-matched
              // embeds lack it.
              key={embed.meeting?.recordingId ?? keys[index]}
              embed={embed}
              message={message}
            />
          ) : (
            <EmbedCard
              key={keys[index]}
              embed={embed}
              onRemove={
                canRemove && embed.type === "link" && embed.url
                  ? () => setPendingUrl(embed.url ?? null)
                  : undefined
              }
            />
          )
        )}
      </div>
      <AlertDialog
        open={pendingUrl !== null}
        onOpenChange={(open) => {
          if (!open) setPendingUrl(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove preview</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the link preview from this message for everyone. The
              link itself stays in the message.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => void handleRemoveConfirm()}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
