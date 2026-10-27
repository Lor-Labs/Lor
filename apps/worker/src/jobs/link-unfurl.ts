import { db, eq, schema } from "@repo/db"
import type { Embed } from "@repo/db/schema"
import { withContext } from "@repo/logger"
import type {
  LinkUnfurlJobData,
  RealtimeMessageEmbedsUpdated,
} from "@repo/realtime-types"
import type { ServerToClientEvents } from "@repo/realtime-types/events"
import { channelRoom, threadRoom } from "@repo/realtime-types/rooms"
import { fetchPublicResource } from "@repo/utils/network"
import type { Emitter } from "@socket.io/redis-emitter"
import type { Job } from "bullmq"
import ogs from "open-graph-scraper"
import { matchProxyRule } from "@/jobs/link-unfurl-url"
import { logger } from "@/lib/logger"

const OG_FETCH_TIMEOUT_MS = 5000
const MAX_REDIRECT_HOPS = 5
const MAX_HTML_BYTES = 1024 * 1024
const MAX_URLS_PER_MESSAGE = 5
const USER_AGENT = "Lor/1.0 OGBot"

// Every redirect creates a fresh connection pinned to a validated public IP.
// The transport never follows redirects before the next destination is checked.
async function fetchHtmlWithSafeRedirects(
  initialUrl: string
): Promise<{ finalUrl: string; html: string } | null> {
  let current = initialUrl
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), OG_FETCH_TIMEOUT_MS)
    try {
      const res = await fetchPublicResource(
        current,
        {
          redirect: "manual",
          signal: controller.signal,
          headers: { "user-agent": USER_AGENT },
        },
        { maxBytes: MAX_HTML_BYTES, timeoutMs: OG_FETCH_TIMEOUT_MS }
      )

      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel()
        const location = res.headers.get("location")
        if (!location) return null
        current = new URL(location, current).toString()
        continue
      }

      if (!res.ok) {
        await res.body?.cancel()
        return null
      }
      const html = await res.text()
      return { finalUrl: current, html }
    } finally {
      clearTimeout(timeout)
    }
  }
  logger.warn({ initialUrl }, "Exceeded redirect hop limit")
  return null
}

async function fetchOgEmbed(url: string): Promise<Embed | null> {
  const proxy = matchProxyRule(url)
  const fetchUrl = proxy?.fetchUrl ?? url

  try {
    const fetched = await fetchHtmlWithSafeRedirects(fetchUrl)
    if (!fetched) return null

    const { error, result } = await ogs({ html: fetched.html })

    if (error || !result.success) {
      logger.warn({ url, fetchUrl, error }, "OG scrape returned no result")
      return null
    }

    const imageUrl =
      result.ogImage?.[0]?.url ?? result.twitterImage?.[0]?.url ?? undefined

    logger.info(
      { url, title: result.ogTitle, hasImage: !!imageUrl },
      "OG scrape succeeded"
    )

    return {
      type: "link",
      url,
      title: result.ogTitle ?? result.twitterTitle ?? undefined,
      description:
        result.ogDescription ?? result.twitterDescription ?? undefined,
      thumbnail: imageUrl,
      siteName: proxy?.siteName ?? result.ogSiteName ?? undefined,
    }
  } catch (err) {
    logger.error({ err, url, fetchUrl }, "OG scrape threw")
    return null
  }
}

export function createLinkUnfurlProcessor(
  emitter: Emitter<ServerToClientEvents>
) {
  return (job: Job<LinkUnfurlJobData>) =>
    withContext(
      { jobId: job.id, jobName: job.name, channelId: job.data.channelId },
      async () => {
        const { messageId, channelId, urls } = job.data
        logger.info(
          { messageId, urlCount: urls.length },
          "Processing link-unfurl job"
        )

        if (urls.length === 0) return

        const results = await Promise.all(
          urls.slice(0, MAX_URLS_PER_MESSAGE).map(fetchOgEmbed)
        )
        const embeds = results.filter((e): e is Embed => e !== null)

        if (embeds.length === 0) {
          logger.info(
            { messageId },
            "No embeds produced, clearing stored embeds"
          )
        }

        const [updated] = await db
          .update(schema.message)
          .set({ embeds })
          .where(eq(schema.message.id, messageId))
          .returning({
            id: schema.message.id,
            threadRootId: schema.message.threadRootId,
          })

        if (!updated) {
          logger.warn({ messageId }, "Message not found for embed update")
          return
        }

        const payload: RealtimeMessageEmbedsUpdated = {
          channelId,
          messageId,
          embeds,
        }

        // The row also routes jobs enqueued before threadRootId was added.
        const rootId = updated.threadRootId
        emitter
          .to(
            rootId
              ? threadRoom(rootId)
              : [channelRoom(channelId), threadRoom(messageId)]
          )
          .emit("message:embeds:updated", payload)
        logger.info(
          { messageId, embedCount: embeds.length },
          "Embeds updated and emitted"
        )
      }
    )
}
