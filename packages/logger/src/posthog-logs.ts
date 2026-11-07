import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs"

type PostHogLogCaptureOptions = {
  serviceName: string
  projectToken?: string
  host?: string
}

export type PostHogLogCapture = {
  info: (body: string, attributes?: Record<string, string | number>) => void
  shutdown: () => Promise<void>
}

const noOpLogCapture: PostHogLogCapture = {
  info: () => {},
  shutdown: async () => {},
}

function warnForMissingConfiguration(options: PostHogLogCaptureOptions) {
  if (process.env.NODE_ENV === "production") return

  if (!options.projectToken) {
    console.warn(
      "POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_PROJECT_TOKEN is configured"
    )
  }
  if (!options.host) {
    console.warn(
      "POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_HOST is configured"
    )
  }
}

export function initPostHogLogCapture(
  options: PostHogLogCaptureOptions
): PostHogLogCapture {
  if (!options.projectToken || !options.host) {
    warnForMissingConfiguration(options)
    return noOpLogCapture
  }
  // A host typo must not stop the API or worker from booting.
  if (!URL.canParse(options.host)) {
    console.warn("POSTHOG_HOST is not a valid URL, PostHog logs are disabled")
    return noOpLogCapture
  }

  const loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({ "service.name": options.serviceName }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: new URL("/i/v1/logs", options.host).toString(),
          headers: { Authorization: `Bearer ${options.projectToken}` },
        }),
      }),
    ],
  })
  // This is deliberately provider-local rather than the global logs API: it
  // exports only the lifecycle records explicitly emitted by this integration.
  const logger = loggerProvider.getLogger("posthog-log-capture")

  return {
    info: (body, attributes) => {
      logger.emit({ severityText: "info", body, attributes })
    },
    shutdown: async () => {
      const timeout = new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000)
        timer.unref()
      })
      await Promise.race([loggerProvider.shutdown().catch(() => {}), timeout])
    },
  }
}
