import { fileURLToPath } from "node:url"
import {
  cli,
  defineAgent,
  type JobContext,
  ServerOptions,
} from "@livekit/agents"
import { env } from "@repo/env/server"
import { transcriberAgentName } from "@repo/voice/server"
import { logger } from "./logger"
import { installVoiceNotifier } from "./realtime"
import { transcribeRoom } from "./room"

// Silent transcriber for voice calls. LiveKit dispatches one job per room
// from the join token; each job runs in its own child process, which
// imports this file again.
export default defineAgent({
  entry: async (ctx: JobContext) => {
    if (!env.DEEPGRAM_API_KEY) throw new Error("DEEPGRAM_API_KEY is not set")
    installVoiceNotifier()
    await transcribeRoom(ctx, env.DEEPGRAM_API_KEY)
  },
})

const missing = [
  !env.LIVEKIT_URL && "LIVEKIT_URL",
  !env.LIVEKIT_API_KEY && "LIVEKIT_API_KEY",
  !env.LIVEKIT_API_SECRET && "LIVEKIT_API_SECRET",
  !env.DEEPGRAM_API_KEY && "DEEPGRAM_API_KEY",
].filter(Boolean)

if (missing.length > 0) {
  const message = `The transcriber needs ${missing.join(", ")}`
  if (env.NODE_ENV === "production") throw new Error(message)
  // Locally, `pnpm run dev` keeps running without voice configured.
  logger.warn(`${message}; not starting`)
  process.exit(0)
}

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: transcriberAgentName(),
    wsURL: env.LIVEKIT_URL,
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
  })
)
