import { createLogger, type Logger } from "@repo/logger"

// Merlin runs inside the worker (and is invoked from the API), both of which set
// AsyncLocalStorage context via withContext — so these lines inherit jobId /
// channelId / workspaceId automatically. Tokens/secrets are redacted by the
// shared logger config.
export const logger: Logger = createLogger("merlin")
