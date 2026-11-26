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
import { disconnectDiscordGuild, discordGuildFor } from "@/lib/discord/places"
import {
  type DiscordThreadEvent,
  forgetThread,
  joinThread,
  rememberThread,
} from "@/lib/discord/threads"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"

// Lor's one connection to Discord's gateway (reference/always-on-agents.md
// §10): it hears messages in places (Message Content intent) and
// the slash commands and button clicks, which arrive here because the app
// sets no interactions endpoint. One API process holds it, by a Redis lease.

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"
// Guilds, guild messages, message content.
const INTENTS = (1 << 0) | (1 << 9) | (1 << 15)
const LEASE_KEY = "discord:gateway:lease"
const LEASE_MS = 30_000
// Close codes that retrying can't fix: bad token, intents not enabled.
const FATAL_CLOSES = new Set([4004, 4010, 4011, 4012, 4013, 4014])

// Owner-checked renew and release, so a stale owner never touches a
// replacement's lease.
const RENEW_LEASE = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) end return 0`
const RELEASE_LEASE = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`
const REGISTER_ATTEMPTS = 3

// Hello and heartbeat acks can omit `s` and `t`.
type GatewayPayload = {
  op: number
  d: unknown
  s?: number | null
  t?: string | null
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
  private registered = false
  private registering = false

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
    // A reconnect timer from before a stop and restart finds a live socket.
    if (this.stopped || this.ws) return
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
    if (typeof payload.s === "number") this.seq = payload.s
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
      logger.info({ bot: ready.user.username }, "Discord gateway ready")
      void this.registerCommands()
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
      void handleDiscordInteraction(data as DiscordInteraction)
      return
    }
    // The bot was taken out of a server (not an outage, which sets
    // `unavailable`): the server is disconnected and its places go.
    if (type === "GUILD_DELETE") {
      const gone = data as { id: string; unavailable?: boolean }
      if (gone.unavailable) return
      void discordGuildFor(gone.id)
        .then((guild) =>
          guild ? disconnectDiscordGuild(guild.workspaceId, gone.id) : null
        )
        .catch((err) =>
          logger.warn(
            { err, guildId: gone.id },
            "Discord server cleanup failed"
          )
        )
    }
  }

  // A few tries per READY; a later READY tries again if they all fail.
  private async registerCommands() {
    if (this.registered || this.registering) return
    this.registering = true
    for (let attempt = 1; attempt <= REGISTER_ATTEMPTS; attempt++) {
      try {
        await discordRequest(
          `/applications/${env.DISCORD_APPLICATION_ID}/commands`,
          { method: "PUT", body: LOR_COMMANDS }
        )
        this.registered = true
        break
      } catch (err) {
        logger.error({ err, attempt }, "Discord command registration failed")
        if (attempt < REGISTER_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 30_000))
        }
      }
    }
    this.registering = false
  }
}

// Holds the lease while this process runs the gateway; another process
// takes over within LEASE_MS of this one stopping.
export function startDiscordGateway() {
  if (!discordConfigured()) return
  const owner = randomUUID()
  const gateway = new DiscordGateway()
  let running = false
  // When the last confirmed lease runs out.
  let leaseUntil = 0
  let lastTick = 0
  let appliedTick = 0
  const stopGateway = (reason: string) => {
    running = false
    gateway.stop()
    logger.warn(reason)
  }
  const tick = async () => {
    // Renewal failing (Redis down or stalled): stop before another process
    // can take the expired lease.
    if (running && Date.now() >= leaseUntil - LEASE_MS / 3) {
      stopGateway("Discord gateway lease not renewed in time")
    }
    const checkedAt = Date.now()
    const generation = ++lastTick
    try {
      const redis = await getRedisClient()
      const renewed = await redis.eval(RENEW_LEASE, {
        keys: [LEASE_KEY],
        arguments: [owner, String(LEASE_MS)],
      })
      const held =
        renewed === 1 ||
        (await redis.set(LEASE_KEY, owner, { PX: LEASE_MS, NX: true })) !== null
      // Ticks overlap when Redis stalls: a result a newer tick already
      // applied over, or a renewal too late to trust, changes nothing.
      if (generation < appliedTick) return
      appliedTick = generation
      if (held && Date.now() >= checkedAt + LEASE_MS - LEASE_MS / 3) return
      if (held) {
        leaseUntil = checkedAt + LEASE_MS
        if (!running) {
          running = true
          gateway.start()
          logger.info("Discord gateway lease taken")
        }
      } else if (running) {
        stopGateway("Discord gateway lease lost")
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
    await redis
      ?.eval(RELEASE_LEASE, { keys: [LEASE_KEY], arguments: [owner] })
      .catch(() => {})
  }
  // A listener replaces Node's default exit on these signals, so exit here.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void release().finally(() => process.exit(0)))
  }
}
