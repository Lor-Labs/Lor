import { LOR_USER_ID } from "@repo/db/constants"
import { extractDirectMentionUserIds } from "@repo/messaging/mentions"

// Only the replied-to author matters for routing.
type ReplyTarget = { author: { id: string } } | null | undefined

export function isLorMentioned(content: string | null | undefined): boolean {
  if (!content) return false
  return extractDirectMentionUserIds(content).has(LOR_USER_ID)
}

// Whether the message addresses a teammate (any non-Lor mention).
function mentionsOtherUser(content: string | null | undefined): boolean {
  if (!content) return false
  for (const id of extractDirectMentionUserIds(content)) {
    if (id !== LOR_USER_ID) return true
  }
  return false
}

// A validated reply to one of Lor's messages addresses Lor just as
// explicitly as an @mention. `createMessage` clears invalid/cross-scope reply
// references before routing reaches this helper.
export function isReplyToLor(referencedMessage: ReplyTarget): boolean {
  return referencedMessage?.author.id === LOR_USER_ID
}

// In a session, replying to a teammate's message addresses them like a
// mention, so Lor stays out. Replying to your own message doesn't count.
export function isReplyToPerson(
  referencedMessage: ReplyTarget,
  senderId: string
): boolean {
  const authorId = referencedMessage?.author.id
  return Boolean(authorId && authorId !== LOR_USER_ID && authorId !== senderId)
}

// The session routing rule, decided once per message at send time and stored
// on it (`message.routedToLor`): a plain message goes to Lor; addressing a
// teammate (mention, or reply to someone else) leaves Lor out unless Lor is
// addressed too; "To channel members" never runs Lor; the message that starts
// a session always does.
export function sessionMessageRunsLor(args: {
  content: string | undefined
  toPeople: boolean | undefined
  replyAuthorId: string | null
  senderId: string
  startsSession: boolean
}): boolean {
  if (args.startsSession) return true
  if (args.toPeople) return false
  const reply = args.replyAuthorId
    ? { author: { id: args.replyAuthorId } }
    : null
  const explicitlyAddressesLor =
    isLorMentioned(args.content) || isReplyToLor(reply)
  const addressesPerson =
    mentionsOtherUser(args.content) || isReplyToPerson(reply, args.senderId)
  return explicitlyAddressesLor || !addressesPerson
}
