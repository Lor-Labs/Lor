import { AsyncLocalStorage } from "node:async_hooks"
import { OpenTelemetry } from "@ai-sdk/otel"
import { trace } from "@opentelemetry/api"
import { resourceFromAttributes } from "@opentelemetry/resources"
import { NodeSDK } from "@opentelemetry/sdk-node"
import { PostHogSpanProcessor } from "@posthog/ai/otel"
import { env } from "@repo/env/server"
import { registerTelemetry } from "ai"

type AiObservabilityContext = {
  distinctId?: string
  sessionId: string
  traceName: string
}

const contextStorage = new AsyncLocalStorage<AiObservabilityContext>()
const processSessionId = `process-${process.pid}`

function sessionId(value: string): string {
  return value.replace(/[^A-Za-z0-9\-_~.@()!'|:]/g, "-")
}

const projectToken = env.POSTHOG_PROJECT_TOKEN
const host = env.POSTHOG_HOST
// Eval and model-comparison commands share production helpers but are not
// application traffic, so they must not emit AI Observability telemetry.
const isEvaluationRun = process.argv.some(
  (argument) => argument.includes("/eval/") || argument.includes("eval-")
)

if (env.NODE_ENV !== "production" && !isEvaluationRun) {
  if (!projectToken) {
    console.warn(
      "POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_PROJECT_TOKEN is configured"
    )
  }
  if (!host) {
    console.warn(
      "POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_HOST is configured"
    )
  }
}

export const posthogSpanProcessor =
  projectToken && host && !isEvaluationRun
    ? new PostHogSpanProcessor({
        projectToken,
        host,
        privacyMode: false,
      })
    : null

const telemetrySdk = posthogSpanProcessor
  ? new NodeSDK({
      resource: resourceFromAttributes({ "service.name": "lor" }),
      spanProcessors: [posthogSpanProcessor],
    })
  : null

if (telemetrySdk && posthogSpanProcessor) {
  telemetrySdk.start()
  registerTelemetry(
    new OpenTelemetry({
      enrichSpan: ({ runtimeContext }) => {
        const context = runtimeContext as AiObservabilityContext | undefined
        return {
          "posthog.distinct_id": context?.distinctId,
          $ai_session_id: context?.sessionId,
          $ai_trace_name: context?.traceName,
        }
      },
    })
  )
}

export function aiRuntimeContext(): AiObservabilityContext {
  return (
    contextStorage.getStore() ?? {
      sessionId: processSessionId,
      traceName: "lor.background",
    }
  )
}

export function aiTelemetry(functionId: string) {
  if (!posthogSpanProcessor) return undefined
  return {
    isEnabled: true,
    functionId,
    includeRuntimeContext: {
      distinctId: true,
      sessionId: true,
      traceName: true,
    },
  }
}

export async function withAiObservabilityTurn<T>(
  input: {
    sessionId?: string
    distinctId?: string
    traceName: string
  },
  fn: () => Promise<T>
): Promise<T> {
  if (!posthogSpanProcessor) return fn()

  const context: AiObservabilityContext = {
    sessionId: sessionId(input.sessionId ?? processSessionId),
    ...(input.distinctId ? { distinctId: input.distinctId } : {}),
    traceName: input.traceName,
  }
  return trace
    .getTracer("lor-ai-observability")
    .startActiveSpan(`ai.${input.traceName}`, async (span) => {
      span.setAttributes({
        "gen_ai.operation.name": input.traceName,
        $ai_session_id: context.sessionId,
        ...(context.distinctId
          ? { "posthog.distinct_id": context.distinctId }
          : {}),
      })
      try {
        return await contextStorage.run(context, fn)
      } finally {
        span.end()
      }
    })
}

export async function shutdownAiObservability() {
  if (!telemetrySdk) return

  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3_000)
    timer.unref()
  })
  await Promise.race([telemetrySdk.shutdown().catch(() => {}), timeout])
}
