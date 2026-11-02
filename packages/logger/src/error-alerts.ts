import { clearTimeout, setTimeout } from "node:timers"

// Error alerts to a chat channel: every distinct logged error posts once to a
// Discord-compatible webhook (a Lor channel webhook URL with /discord
// appended, or a Discord channel webhook). Repeats within the window collapse
// into one count message. Off unless ERROR_ALERT_WEBHOOK_URL is set; see
// reference/error-reporting.md.

const REPEAT_WINDOW_MS = 5 * 60_000
// Per process. Lor accepts 60 deliveries a minute per webhook.
const MAX_POSTS_PER_MINUTE = 10
const REQUEST_TIMEOUT_MS = 5000
const FLUSH_TIMEOUT_MS = 2000
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const CONTEXT_LABELS = {
  route: "Route",
  status: "Status",
  jobName: "Job",
  queue: "Queue",
  requestId: "Request",
  runId: "Run",
  sessionId: "Session",
  workspaceId: "Workspace",
  channelId: "Channel",
  userId: "User",
} as const

export type ErrorAlert = {
  fatal: boolean
  title: string
  error?: { name: string; message: string; stack?: string }
  context: Record<string, string | number>
  // The logged error object, so one exception logged twice alerts once.
  source?: object
}

type Repeat = {
  title: string
  count: number
  timer: ReturnType<typeof setTimeout>
}

let webhookUrl: URL | undefined
let selfPathPrefix: string | undefined
let service = "backend"
const repeats = new Map<string, Repeat>()
const alerted = new WeakSet<object>()
const pending = new Set<Promise<void>>()
let minuteStart = 0
let postsThisMinute = 0
let dropped = 0
let droppedTimer: ReturnType<typeof setTimeout> | undefined
let lastFailureAt = 0

export function initErrorAlerts(serviceName: string): void {
  const raw = process.env.ERROR_ALERT_WEBHOOK_URL?.trim()
  if (!raw || webhookUrl) return
  try {
    webhookUrl = new URL(raw)
  } catch {
    process.stderr.write("ERROR_ALERT_WEBHOOK_URL is invalid; alerts are off\n")
    return
  }
  service = serviceName
  // When the URL is a Lor webhook, errors raised while delivering to it must
  // not alert again (alert loop).
  const webhookId = webhookUrl.pathname.match(/^\/v1\/webhooks\/([^/]+)\//)?.[1]
  selfPathPrefix = webhookId ? `/v1/webhooks/${webhookId}/` : undefined
}

export function errorAlertsEnabled(): boolean {
  return webhookUrl !== undefined
}

export function queueErrorAlert(alert: ErrorAlert): void {
  if (!webhookUrl) return
  const path = alert.context.path
  if (selfPathPrefix && typeof path === "string") {
    if (path.startsWith(selfPathPrefix)) return
  }
  if (alert.source) {
    if (alerted.has(alert.source)) return
    alerted.add(alert.source)
  }
  const key = fingerprint(alert)
  const repeat = repeats.get(key)
  if (repeat) {
    repeat.count++
    return
  }
  repeats.set(key, { title: alert.title, count: 0, timer: armRepeat(key) })
  post(errorBody(alert))
}

// IDs and long numbers vary per occurrence; short codes (HTTP 401) do not.
function fingerprint(alert: ErrorAlert): string {
  return [
    alert.title,
    alert.error?.name,
    alert.error?.message,
    alert.context.route ?? alert.context.jobName,
  ]
    .join("|")
    .replace(UUID_RE, "<id>")
    .replace(/\d{4,}/g, "<n>")
}

function armRepeat(key: string) {
  return setTimeout(() => closeRepeatWindow(key), REPEAT_WINDOW_MS).unref()
}

// A continuing error posts one count message per window; the full card posts
// again only after a window with no repeats.
function closeRepeatWindow(key: string) {
  const repeat = repeats.get(key)
  if (!repeat) return
  if (repeat.count === 0) {
    repeats.delete(key)
    return
  }
  post(repeatBody(repeat))
  repeat.count = 0
  repeat.timer = armRepeat(key)
}

function post(body: object, notice = false) {
  const now = Date.now()
  if (now - minuteStart >= 60_000) {
    minuteStart = now
    postsThisMinute = 0
  }
  if (!notice && postsThisMinute >= MAX_POSTS_PER_MINUTE) {
    dropped++
    droppedTimer ??= setTimeout(
      sendDroppedNotice,
      minuteStart + 60_000 - now
    ).unref()
    return
  }
  postsThisMinute++
  const request = send(body).finally(() => pending.delete(request))
  pending.add(request)
}

function sendDroppedNotice() {
  if (droppedTimer) clearTimeout(droppedTimer)
  droppedTimer = undefined
  if (dropped === 0) return
  const content = `${dropped} more error alert${dropped === 1 ? "" : "s"} from ${service} not sent (limit ${MAX_POSTS_PER_MINUTE} a minute). See the service logs.`
  dropped = 0
  post({ content }, true)
}

async function send(body: object): Promise<void> {
  if (!webhookUrl) return
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    void response.body?.cancel().catch(() => {})
    if (!response.ok) deliveryFailed(`HTTP ${response.status}`)
  } catch (err) {
    deliveryFailed(err instanceof Error ? err.name : "request failed")
  }
}

// Never through the logger: a failed alert must not raise another alert.
function deliveryFailed(reason: string) {
  const now = Date.now()
  if (now - lastFailureAt < 60_000) return
  lastFailureAt = now
  process.stderr.write(`Error alert delivery failed: ${reason}\n`)
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function codeBlock(text: string, max: number) {
  return `\`\`\`\n${clip(text, max - 8)}\n\`\`\``
}

function errorBody(alert: ErrorAlert) {
  const fields = [
    { name: "Service", value: service, inline: true },
    {
      name: "Environment",
      value: process.env.NODE_ENV ?? "development",
      inline: true,
    },
  ]
  for (const [key, label] of Object.entries(CONTEXT_LABELS)) {
    const value =
      alert.context[key] ?? (key === "route" ? alert.context.path : undefined)
    if (value === undefined || value === "") continue
    fields.push({ name: label, value: clip(String(value), 1024), inline: true })
  }
  const frames = alert.error?.stack
    ?.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at "))
    .slice(0, 8)
    .join("\n")
  if (frames) {
    fields.push({
      name: "Stack",
      value: codeBlock(frames, 1024),
      inline: false,
    })
  }
  const release = process.env.APP_VERSION || process.env.RAILWAY_GIT_COMMIT_SHA
  const error = alert.error
  return {
    embeds: [
      {
        title: clip(alert.title, 256),
        description:
          error && error.message !== alert.title
            ? codeBlock(`${error.name}: ${error.message}`, 4000)
            : undefined,
        color: alert.fatal ? 0x992d22 : 0xe74c3c,
        fields,
        footer: release
          ? { text: `Release ${release.slice(0, 12)}` }
          : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  }
}

function repeatBody(repeat: Repeat) {
  const times = `${repeat.count} more time${repeat.count === 1 ? "" : "s"}`
  return {
    content: `**${clip(repeat.title, 200)}** (${service}) happened ${times} in the last ${REPEAT_WINDOW_MS / 60_000} minutes.`,
  }
}

// Shutdown: post outstanding counts, then wait briefly for deliveries.
export async function flushErrorAlerts(): Promise<void> {
  for (const [key, repeat] of repeats) {
    clearTimeout(repeat.timer)
    if (repeat.count > 0) post(repeatBody(repeat))
    repeats.delete(key)
  }
  if (dropped > 0) sendDroppedNotice()
  if (pending.size === 0) return
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS).unref()),
  ])
}
