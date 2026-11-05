import { Alert } from "react-native"
import { api } from "@/lib/api"

// Remove link preview (LOR-138): hides it for everyone after a confirm. The
// message:embeds:updated broadcast drops it from every open view.
export function confirmRemoveEmbed(input: {
  workspaceSlug: string
  channelId: string
  messageId: string
  url: string
}) {
  Alert.alert(
    "Remove preview?",
    "This removes the link preview from this message for everyone. The link itself stays in the message.",
    [
      { style: "cancel", text: "Cancel" },
      {
        style: "destructive",
        text: "Remove",
        onPress: () => {
          void removeEmbed(input).catch(() => {
            Alert.alert("Preview not removed", "Please try again in a moment.")
          })
        },
      },
    ]
  )
}

async function removeEmbed(input: {
  workspaceSlug: string
  channelId: string
  messageId: string
  url: string
}) {
  const response = await api.v1.workspaces[":workspaceSlug"].channels[
    ":channelId"
  ].messages[":messageId"].embeds.$delete({
    param: {
      workspaceSlug: input.workspaceSlug,
      channelId: input.channelId,
      messageId: input.messageId,
    },
    query: { url: input.url },
  })
  if (!response.ok) throw new Error("Could not remove the preview")
}
