import { isNativeError } from "node:util/types"
import * as Sentry from "@sentry/node-core/light"
import type { LogFn } from "pino"
import { getAllContext } from "./context.js"

let client: Sentry.LightNodeClient | undefined
let service = "backend"
const capturedErrors = new WeakSet<object>()
const CONTEXT_KEYS = [
  "requestId",
  "method",
  "path",
  "route",
  "userId",
  "workspaceId",
  "channelId",
  "socketId",
  "jobId",
  "jobName",
  "runId",
  "sessionId",
  "queue",
  "status",
  "trace_id",
  "span_id",
] as const

export function redactLogPath(path: string): string {
  return path.replace(/(\/v1\/webhooks\/[^/\s?#]+\/)[^/\s?#]+/g, "$1[REDACTED]")
}

function scrubText(text: string): string {
  return redactLogPath(text)
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(
      /([?&](?:token|key|api_key|secret|password)=)[^&#\s]+/gi,
      "$1[REDACTED]"
    )
    .replace(/\bBearer\s+[\w.+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[REDACTED EMAIL]")
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 15) return undefined
  if (typeof value === "string") return scrubText(value)
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/^(?:authorization|cookie|set-cookie|password|.*secret.*|.*token.*|api[_-]?key|dsn|email|headers|body|payload|vars)$/i.test(
            key
          )
      )
      .map(([key, item]) => [key, scrub(item, depth + 1)])
  )
}

function operationContext(fields: Record<string, unknown>) {
  return Object.fromEntries(
    CONTEXT_KEYS.flatMap((key) => {
      const value = fields[key]
      return typeof value === "string" || typeof value === "number"
        ? [[key, value]]
        : []
    })
  )
}

function beforeSend(event: Sentry.ErrorEvent, hint: Sentry.EventHint) {
  const operation = operationContext({
    ...getAllContext(),
    ...event.contexts?.operation,
  })
  // This channel's delivery errors remain in stdout to avoid an alert loop.
  const alertWebhookId = process.env.BETTERSTACK_ALERT_WEBHOOK_ID?.trim()
  if (
    alertWebhookId &&
    typeof operation.path === "string" &&
    operation.path.startsWith(`/v1/webhooks/${alertWebhookId}/`)
  ) {
    return null
  }
  const original = hint.originalException
  if (original && typeof original === "object") {
    if (capturedErrors.has(original)) return null
    capturedErrors.add(original)
  }
  event.tags = { ...event.tags, service }
  event.contexts = { ...event.contexts, operation }
  if (process.versions.bun) {
    event.contexts.runtime = { name: "bun", version: process.versions.bun }
  }
  // Send operation identifiers, never HTTP bodies, headers or user profiles.
  delete event.request
  delete event.user
  delete event.breadcrumbs
  return scrub(event) as Sentry.ErrorEvent
}

export function initErrorReporting(serviceName: string): void {
  const dsn = process.env.BETTERSTACK_ERRORS_DSN?.trim()
  if (client || !dsn || process.env.NODE_ENV === "test") return
  service = serviceName
  try {
    client = Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      release:
        process.env.APP_VERSION ||
        process.env.RAILWAY_GIT_COMMIT_SHA ||
        undefined,
      defaultIntegrations: false,
      integrations: [
        Sentry.onUncaughtExceptionIntegration(),
        // API/worker and LiveKit already install rejection handlers.
        Sentry.onUnhandledRejectionIntegration({
          mode: ["api", "worker", "transcriber"].includes(serviceName)
            ? "none"
            : "strict",
        }),
      ],
      sendDefaultPii: false,
      includeServerName: false,
      sendClientReports: false,
      enableLogs: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      maxValueLength: 2000,
      shutdownTimeout: 2000,
      beforeSend,
    })
  } catch {
    process.stderr.write("Error reporting could not be initialized\n")
  }
}

// Runs before Pino serializes Errors, preserving their original stack traces.
export function reportLog(
  args: Parameters<LogFn>,
  level: number,
  bindings: Record<string, unknown>
): void {
  if (!client || level < 50) return
  try {
    const first: unknown = args[0]
    const fields =
      first && typeof first === "object" && !isNativeError(first)
        ? (first as Record<string, unknown>)
        : {}
    const message =
      typeof first === "string"
        ? first
        : typeof args[1] === "string"
          ? args[1]
          : typeof fields.msg === "string"
            ? fields.msg
            : "Backend error"
    // The SDK's process listener captures this; retain the existing stdout log.
    if (message === "Unhandled promise rejection") return
    const error = isNativeError(first)
      ? first
      : (fields.err ?? fields.error ?? bindings.err ?? bindings.error)
    const response = fields.res
    const context = operationContext({
      ...bindings,
      ...getAllContext(),
      ...fields,
      status:
        fields.status ??
        (response && typeof response === "object" && "status" in response
          ? response.status
          : undefined),
    })
    const captureContext = {
      level: level >= 60 ? ("fatal" as const) : ("error" as const),
      tags: { logger: String(bindings.service ?? service) },
      contexts: { operation: context },
      extra: { logMessage: message },
    }
    if (isNativeError(error) || typeof error === "string") {
      Sentry.captureException(error, captureContext)
    } else if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
    ) {
      // Some libraries serialize errors. Keep the stack, not arbitrary payloads.
      const exception = new Error(error.message)
      if ("stack" in error && typeof error.stack === "string")
        exception.stack = error.stack
      if ("name" in error && typeof error.name === "string")
        exception.name = error.name
      else if ("type" in error && typeof error.type === "string")
        exception.name = error.type
      Sentry.captureException(exception, captureContext)
    } else {
      Sentry.captureMessage(message, {
        ...captureContext,
        fingerprint: [service, String(context.route ?? ""), message],
      })
    }
  } catch {
    // Reporting must never break the operation that emitted the log.
  }
}

export async function flushErrorReports(): Promise<void> {
  try {
    await client?.flush(2000)
  } catch {
    // Shutdown proceeds even when the collector is unavailable.
  }
}
