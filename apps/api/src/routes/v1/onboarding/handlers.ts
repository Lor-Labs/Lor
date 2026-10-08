import { type CompanySite, lookupCompanySite } from "@repo/lor/company-site"
import { normalizeDomain } from "@repo/utils/domain"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import { logger } from "@/lib/logger"
import { getRedisClient } from "@/lib/redis"
import type { AppRouteHandler } from "@/lib/types/app-types"
import type { GetCompanySiteRoute } from "@/routes/v1/onboarding/routes"
import { companySiteResponseSchema } from "@/routes/v1/onboarding/schema"

const SITE_CACHE_TTL_SECONDS = 24 * 60 * 60
const EMPTY_SITE: CompanySite = { name: null, description: null }

// Cached per domain: the client starts this lookup as soon as it knows the
// domain, and retyping or a second teammate signing up costs nothing.
export const getCompanySite: AppRouteHandler<GetCompanySiteRoute> = async (
  c
) => {
  const domain = normalizeDomain(c.req.valid("query").domain)
  if (!domain) return c.json(EMPTY_SITE, HttpStatusCodes.OK)

  const cacheKey = `onboarding:site:${domain}`
  try {
    const cached = await (await getRedisClient()).get(cacheKey)
    if (cached) {
      return c.json(
        companySiteResponseSchema.parse(JSON.parse(cached)),
        HttpStatusCodes.OK
      )
    }
  } catch (err) {
    logger.warn({ err, domain }, "Company site cache read failed")
  }

  const site = await lookupCompanySite(domain)
  if (!site) return c.json(EMPTY_SITE, HttpStatusCodes.OK)

  try {
    await (await getRedisClient()).set(cacheKey, JSON.stringify(site), {
      EX: SITE_CACHE_TTL_SECONDS,
    })
  } catch (err) {
    logger.warn({ err, domain }, "Company site cache write failed")
  }
  return c.json(site, HttpStatusCodes.OK)
}
