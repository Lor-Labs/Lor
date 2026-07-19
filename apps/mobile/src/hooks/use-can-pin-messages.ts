import { useChannelPermissions } from "@/hooks/use-channel-permissions"

export function useCanPinMessages(workspaceId?: string) {
  return useChannelPermissions(workspaceId).canPinMessages
}
