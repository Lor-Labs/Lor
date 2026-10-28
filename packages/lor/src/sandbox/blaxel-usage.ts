import { env } from "@repo/env/server"

const METRICS_URL = "https://api.blaxel.ai/v0/accounts"
const FETCH_TIMEOUT_MS = 20_000

export type SandboxUsageBucket = {
  sandboxName: string
  hourStart: Date
  usageGbs: number
  costUsd: number
}

type MetricsPage = {
  data?: {
    workspace?: string
    resourceName?: string
    timeseries?: { timestamp: string; usage?: number; cost?: number }[]
  }[]
  meta?: { hasMore?: boolean; nextCursor?: string }
}

export function sandboxUsageConfigured() {
  return Boolean(env.BL_API_KEY && env.BL_WORKSPACE && env.BL_ACCOUNT_ID)
}

// Hourly sandbox compute (GB-seconds) and cost per sandbox, from Blaxel's
// Billing API (docs.blaxel.ai/api-reference/billing). One paged query covers
// every sandbox; data lags a few minutes and a bucket grows until its hour
// closes. Account-scoped, so other Blaxel workspaces are filtered out.
export async function blaxelSandboxUsage(
  start: Date,
  end: Date
): Promise<SandboxUsageBucket[]> {
  if (!sandboxUsageConfigured()) return []
  const buckets: SandboxUsageBucket[] = []
  let cursor = ""
  do {
    const params = new URLSearchParams({
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      resolution: "hourly",
      resourceType: "sandbox",
      billingDimension: "sandbox_compute_runtime_gbs",
      groupBy: "resource_name,billing_dimension",
      limit: "100",
      ...(cursor ? { cursor } : {}),
    })
    const response = await fetch(
      `${METRICS_URL}/${env.BL_ACCOUNT_ID}/metrics?${params}`,
      {
        headers: { Authorization: `Bearer ${env.BL_API_KEY}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    )
    if (!response.ok)
      throw new Error(`Blaxel billing metrics failed: ${response.status}`)
    const page = (await response.json()) as MetricsPage
    for (const entry of page.data ?? []) {
      if (entry.workspace !== env.BL_WORKSPACE || !entry.resourceName) continue
      for (const point of entry.timeseries ?? []) {
        if (!point.usage) continue
        buckets.push({
          sandboxName: entry.resourceName,
          hourStart: new Date(point.timestamp),
          usageGbs: point.usage,
          costUsd: point.cost ?? 0,
        })
      }
    }
    cursor = page.meta?.hasMore ? (page.meta.nextCursor ?? "") : ""
  } while (cursor)
  return buckets
}
