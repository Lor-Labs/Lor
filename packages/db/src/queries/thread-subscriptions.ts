import { LOR_USER_ID } from "../constants"
import { db } from "../index"
import { threadSubscription } from "../schemas/thread-subscriptions"

type Executor = Pick<typeof db, "insert">

// Who follows a thread (a Lor session, a human thread or a call chat). Starting,
// being mentioned, writing, acting and being added all subscribe; opening never
// does. Unsubscribing deletes the row, so any later trigger adds it back.
export async function subscribeToThread(
  threadRootId: string,
  userIds: Iterable<string>,
  executor: Executor = db
) {
  const rows = [...new Set(userIds)]
    .filter((userId) => userId !== LOR_USER_ID)
    .map((userId) => ({ threadRootId, userId }))
  if (rows.length === 0) return
  await executor.insert(threadSubscription).values(rows).onConflictDoNothing()
}
