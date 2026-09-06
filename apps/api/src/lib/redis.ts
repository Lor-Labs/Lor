import { env } from "@repo/env/server"
import { createClient, type RedisClientType } from "redis"
import { logger } from "@/lib/logger"

const redisClient: RedisClientType = createClient({ url: env.REDIS_URL })

let connectPromise: Promise<RedisClientType> | null = null

redisClient.on("error", (error) => {
  logger.error({ err: error }, "Redis error")
})

export async function getRedisClient() {
  if (redisClient.isReady) return redisClient

  if (!connectPromise) {
    connectPromise = (async () => {
      if (!redisClient.isOpen) {
        // A reconnecting open client must await ready, not call connect twice.
        void redisClient.connect().catch((err) => {
          logger.error({ err }, "Redis connection failed")
        })
      }
      if (!redisClient.isReady) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer)
            redisClient.off("ready", onReady)
            redisClient.off("end", onEnd)
          }
          const onReady = () => {
            cleanup()
            resolve()
          }
          const onEnd = () => {
            cleanup()
            reject(new Error("Redis connection closed"))
          }
          const timer = setTimeout(() => {
            cleanup()
            reject(new Error("Redis readiness timed out"))
          }, 10_000)
          redisClient.once("ready", onReady)
          redisClient.once("end", onEnd)
          if (redisClient.isReady) onReady()
        })
      }
      return redisClient
    })().finally(() => {
      connectPromise = null
    })
  }
  return connectPromise
}
