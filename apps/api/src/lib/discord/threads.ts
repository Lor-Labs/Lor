import { discordRequest } from "@repo/lor/discord"
import { logger } from "@/lib/logger"

// Public threads the bot can see, by id, from the gateway's GUILD_CREATE and
// THREAD_* events: a message in a thread names only the thread, so this is
// how it finds the linked channel above it. Private threads are left out.
const PUBLIC_THREAD_TYPES = new Set([10, 11])

type ThreadInfo = { parentId: string; name: string }
const threads = new Map<string, ThreadInfo>()

export type DiscordThreadEvent = {
  id: string
  type: number
  parent_id?: string | null
  name?: string
}

export function rememberThread(thread: DiscordThreadEvent) {
  if (!PUBLIC_THREAD_TYPES.has(thread.type) || !thread.parent_id) return
  threads.set(thread.id, {
    parentId: thread.parent_id,
    name: thread.name ?? "",
  })
}

export function forgetThread(threadId: string) {
  threads.delete(threadId)
}

export function threadInfo(threadId: string): ThreadInfo | null {
  return threads.get(threadId) ?? null
}

// Joining a thread makes sure its messages reach the bot.
export async function joinThread(threadId: string) {
  await discordRequest(`/channels/${threadId}/thread-members/@me`, {
    method: "PUT",
  }).catch((err: unknown) =>
    logger.warn({ err, threadId }, "Discord thread join failed")
  )
}
