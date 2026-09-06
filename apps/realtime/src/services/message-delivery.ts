import { randomUUID } from "node:crypto"
import type { createClient } from "redis"
import { logger } from "@/lib/logger"

export const MESSAGE_DELIVERY_RETRY =
  "Message is still being delivered. Please retry shortly."

const RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60
const LEASE_MS = 90_000

// Receipts precede message insertion; expired/legacy nonces remain ack-only.
export async function claimMessageDelivery(
  redis: ReturnType<typeof createClient>,
  userId: string,
  channelId: string,
  nonce: string
) {
  const key = `message-delivery:${userId}:${channelId}:${nonce}`
  const lockKey = `${key}:lock`
  const token = randomUUID()
  if (!(await redis.set(lockKey, token, { NX: true, PX: LEASE_MS }))) {
    const stage = await redis.get(key)
    if (stage === "broadcast" || stage === "complete") {
      return { busy: true as const }
    }
    throw new Error(MESSAGE_DELIVERY_RETRY)
  }
  let leaseLost = false
  const heartbeat = setInterval(() => {
    void redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        { keys: [lockKey], arguments: [token, String(LEASE_MS)] }
      )
      .then((renewed) => {
        if (!renewed) leaseLost = true
      })
      .catch((err) => {
        leaseLost = true
        logger.warn({ err, channelId }, "Message delivery lease renewal failed")
      })
  }, LEASE_MS / 3)
  const release = async () => {
    clearInterval(heartbeat)
    await redis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [lockKey], arguments: [token] }
      )
      .catch((err) =>
        logger.warn({ err, channelId }, "Message delivery unlock failed")
      )
  }
  try {
    const fresh = await redis.set(key, "pending", {
      NX: true,
      EX: RECEIPT_TTL_SECONDS,
    })
    const stage = await redis.get(key)
    if (stage !== "pending" && stage !== "broadcast" && stage !== "complete") {
      throw new Error("Message delivery receipt unavailable")
    }
    return {
      busy: false as const,
      fresh: fresh !== null,
      stage,
      async checkpoint(stage: "broadcast" | "complete") {
        if (leaseLost) throw new Error("Message delivery lease lost")
        const saved = await redis.eval(
          "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]) return 1",
          {
            keys: [lockKey, key],
            arguments: [token, stage, String(RECEIPT_TTL_SECONDS)],
          }
        )
        if (!saved) throw new Error("Message delivery lease lost")
      },
      release,
    }
  } catch (err) {
    await release()
    throw err
  }
}
