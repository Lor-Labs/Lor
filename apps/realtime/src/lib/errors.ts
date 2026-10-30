import { BetaAccessError } from "@repo/db/queries/beta-access"
import { ZodError } from "zod"
import { logger } from "@/lib/logger"

const GENERIC_ERROR = "Something went wrong. Try again."

// Ack errors reach the client. App code throws plain Errors with user-facing
// text; library errors (Drizzle "Failed query: …", Postgres, AWS SDK, fetch)
// are subclasses or carry a system code, and can leak SQL, hosts or keys.
function isUserFacing(error: Error) {
  if (error instanceof BetaAccessError) return true
  return (
    Object.getPrototypeOf(error) === Error.prototype &&
    !("code" in error) &&
    !("errno" in error) &&
    !("syscall" in error)
  )
}

export function toErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0]
    return issue?.message ?? "Invalid payload"
  }

  if (error instanceof Error && isUserFacing(error)) {
    return error.message
  }

  logger.warn({ err: error }, "Realtime ack error hidden from client")
  return GENERIC_ERROR
}
