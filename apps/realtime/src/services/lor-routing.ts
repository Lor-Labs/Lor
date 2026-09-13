import { LOR_USER_ID } from "@repo/db/constants"
import type { RealtimeReferencedMessage } from "@repo/realtime-types"

// A validated reply to one of Lor's messages addresses Lor just as
// explicitly as an @mention. `createMessage` clears invalid/cross-scope reply
// references before routing reaches this helper.
export function isReplyToLor(
  referencedMessage:
    | Pick<RealtimeReferencedMessage, "author">
    | null
    | undefined
): boolean {
  return referencedMessage?.author.id === LOR_USER_ID
}
