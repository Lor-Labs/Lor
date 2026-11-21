import { randomUUID } from "node:crypto"
import { env } from "@repo/env/server"
import {
  discordConfigured,
  discordLinkByDiscordChannel,
  discordRequest,
} from "@repo/lor/discord"
import {
  type DiscordMessageEvent,
  mirrorDiscordMessage,
} from "@/lib/discord/inbound"
import {
  type DiscordInteraction,
  handleDiscordInteraction,
  LOR_COMMANDS,
} from "@/lib/discord/interactions"
import {
  type DiscordThreadEvent,
  forgetThread,
  joinThread,
  rememberThread,
} from "@/lib/discord/threads"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Lor's one connection to Discord's gateway (reference/always-on-agents.md
// §10): it hears messages in linked channels (Message Content intent) and
// the slash commands and button clicks, which arrive here because the app
// sets no interactions endpoint. One API process holds it, by a Redis lease.

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"
// Guilds, guild messages, message content.
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15)
const LEASE_KEY = "discord:gateway:lease"
const LEASE_MS = 30_000
// Close codes that retrying can't fix: bad token, intents not enabled.
const FATAL_CLOSES = new Set([4004, 4010, 4011, 4012, 4013, 4014])

type GatewayPayload = {
  op: number
  d: unknown
  s: number | null
  t: string | null
}

class DiscordGateway {
  private ws: WebSocket | null = null
  private seq: number | null = null
  private sessionId: string | null = null
  private resumeUrl: string | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private acked = true
  private stopped = false
  private botUserId = ""
  private botName = "Lor"
  private registered = false

  start() {
    this.stopped = false
    this.connect(false)
  }

  stop() {
    this.stopped = true
    this.clearHeartbeat()
    this.ws?.close(1000)
    this.ws = null
  }

  private connect(resume: boolean) {
    if (this.stopped) return
    const url =
      resume && this.resumeUrl
        ? `${this.resumeUrl}/?v=10&encoding=json`
        : GATEWAY_URL
    const ws = new WebSocket(url)
    this.ws = ws
    ws.addEventListener("message", (event) => {
      try {
        this.onPayload(JSON.parse(String(event.data)) as GatewayPayload, resume)
      } catch (err) {
        logger.error({ err }, "Discord gateway payload failed")
      }
    })
    ws.addEventListener("close", (event) => {
      if (this.ws !== ws) return
      this.clearHeartbeat()
      this.ws = null
      if (this.stopped) return
      if (FATAL_CLOSES.has(event.code)) {
        logger.error(
          { code: event.code, reason: event.reason },
          "Discord gateway closed for good: check the bot token and that the Message Content intent is on"
        )
        return
      }
      const canResume = Boolean(this.sessionId) && event.code !== 4007
      setTimeout(() => this.connect(canResume), 2_000)
    })
    ws.addEventListener("error", () => {})
  }

  private send(op: number, d: unknown) {
    this.ws?.send(JSON.stringify({ op, d }))
  }

  private clearHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private onPayload(payload: GatewayPayload, resuming: boolean) {
    if (payload.s !== null) this.seq = payload.s
    switch (payload.op) {
      case 10: {
        const interval = (payload.d as { heartbeat_interval: number })
          .heartbeat_interval
        this.acked = true
        this.clearHeartbeat()
        this.heartbeat = setInterval(() => {
          if (!this.acked) {
            // A missed ack: the connection is a zombie. Reconnect.
            this.ws?.close(4000)
            return
          }
          this.acked = false
          this.send(1, this.seq)
        }, interval)
        if (resuming && this.sessionId) {
          this.send(6, {
            token: env.DISCORD_BOT_TOKEN,
            session_id: this.sessionId,
            seq: this.seq,
          })
        } else {
          this.send(2, {
            token: env.DISCORD_BOT_TOKEN,
            intents: INTENTS,
            properties: { os: "linux", browser: "lor", device: "lor" },
          })
        }
        return
      }
      case 11:
        this.acked = true
        return
      case 1:
        this.send(1, this.seq)
        return
      case 7:
        this.ws?.close(4000)
        return
      case 9: {
        const resumable = payload.d === true
        if (!resumable) {
          this.sessionId = null
          this.seq = null
        }
        this.ws?.close(4000)
        return
      }
      case 0:
        this.onDispatch(payload.t ?? "", payload.d)
        return
    }
  }

  private onDispatch(type: string, data: unknown) {
    if (type === "READY") {
      const ready = data as {
        session_id: string
        resume_gateway_url: string
        user: { id: string; username: string }
      }
      this.sessionId = ready.session_id
      this.resumeUrl = ready.resume_gateway_url
      this.botUserId = ready.user.id
      this.botName = ready.user.username
      logger.info({ bot: ready.user.username }, "Discord gateway ready")
      if (!this.registered) {
        this.registered = true
        void discordRequest(
          `/applications/${env.DISCORD_APPLICATION_ID}/commands`,
          { method: "PUT", body: LOR_COMMANDS }
        ).catch((err) =>
          logger.error({ err }, "Discord command registration failed")
        )
      }
      return
    }
    if (type === "GUILD_CREATE") {
      for (const thread of (data as { threads?: DiscordThreadEvent[] })
        .threads ?? []) {
        rememberThread(thread)
      }
      return
    }
    if (type === "THREAD_LIST_SYNC") {
      for (const thread of (data as { threads?: DiscordThreadEvent[] })
        .threads ?? []) {
        rememberThread(thread)
      }
      return
    }
    if (type === "THREAD_CREATE" || type === "THREAD_UPDATE") {
      const thread = data as DiscordThreadEvent
      rememberThread(thread)
      // Joined in linked channels, so every message there reaches the bot.
      if (type === "THREAD_CREATE" && thread.parent_id) {
        void discordLinkByDiscordChannel(thread.parent_id).then((link) => {
          if (link) void joinThread(thread.id)
        })
      }
      return
    }
    if (type === "THREAD_DELETE") {
      forgetThread((data as { id: string }).id)
      return
    }
    if (type === "MESSAGE_CREATE") {
      void mirrorDiscordMessage(data as DiscordMessageEvent, this.botUserId)
      return
    }
    if (type === "INTERACTION_CREATE") {
      void handleDiscordInteraction(data as DiscordInteraction, this.botName)
    }
  }
}

// Holds the lease while this process runs the gateway; another process
// takes over within LEASE_MS of this one stopping.
export function startDiscordGateway() {
  if (!discordConfigured()) return
  const owner = randomUUID()
  const gateway = new DiscordGateway()
  let running = false
  const tick = async () => {
    try {
      const redis = await getRedisClient()
      const holder = await redis.get(LEASE_KEY)
      if (holder === owner) {
        await redis.set(LEASE_KEY, owner, { PX: LEASE_MS })
      } else if (
        !holder &&
        (await redis.set(LEASE_KEY, owner, { PX: LEASE_MS, NX: true }))
      ) {
        running = true
        gateway.start()
        logger.info("Discord gateway lease taken")
        return
      } else if (running) {
        running = false
        gateway.stop()
        logger.warn("Discord gateway lease lost")
      }
    } catch (err) {
      logger.error({ err }, "Discord gateway lease check failed")
    }
  }
  void tick()
  setInterval(() => void tick(), LEASE_MS / 3)
  const release = async () => {
    gateway.stop()
    const redis = await getRedisClient().catch(() => null)
    if (redis && (await redis.get(LEASE_KEY)) === owner) {
      await redis.del(LEASE_KEY)
    }
  }
  // A listener replaces Node's default exit on these signals, so exit here.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void release().finally(() => process.exit(0)))
  }
}
