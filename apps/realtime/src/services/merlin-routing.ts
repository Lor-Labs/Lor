import { MERLIN_USER_ID } from "@repo/db/constants"
import type { RealtimeReferencedMessage } from "@repo/realtime-types"

// A validated reply to one of Merlin's messages addresses Merlin just as
// explicitly as an @mention. `createMessage` clears invalid/cross-scope reply
// references before routing reaches this helper.
export function isReplyToMerlin(
  referencedMessage:
    | Pick<RealtimeReferencedMessage, "author">
    | null
    | undefined
): boolean {
  return referencedMessage?.author.id === MERLIN_USER_ID
}
