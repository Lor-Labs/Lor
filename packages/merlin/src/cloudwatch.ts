import {
  CloudWatchClient,
  GetMetricDataCommand,
  ListMetricsCommand,
} from "@aws-sdk/client-cloudwatch"
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  GetQueryResultsCommand,
  StartQueryCommand,
  StopQueryCommand,
} from "@aws-sdk/client-cloudwatch-logs"
import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import {
  awsClientConfig,
  getCloudwatchCredentials,
} from "./providers/cloudwatch"

const LOG_GROUPS_DEFAULT = 25
const LOG_GROUPS_MAX = 50
const QUERY_LIMIT_DEFAULT = 50
const QUERY_LIMIT_MAX = 200
const MESSAGE_MAX = 2_000
// Logs Insights queries are async; bound the poll so a slow scan can't hold up
// the chat response indefinitely.
const QUERY_DEADLINE_MS = 25_000
const QUERY_POLL_MS = 1_000
const METRICS_LIST_MAX = 50
const DATAPOINTS_MAX = 500
const ERROR_MESSAGE_MAX = 300

const cloudwatchContext = z.object({ externalId: z.string() })

export async function resolveWorkspaceCloudwatch(
  workspaceId: string
): Promise<{ externalId: string } | null> {
  const conn = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "cloudwatch"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return conn ? { externalId: conn.externalId } : null
}

async function clientsFor(externalId: string) {
  const creds = await getCloudwatchCredentials(externalId)
  if (!creds) return null
  const config = awsClientConfig(creds)
  return {
    region: creds.region,
    logs: new CloudWatchLogsClient(config),
    metrics: new CloudWatchClient(config),
  }
}

// The console escapes URL-encoded characters with $ instead of % in the
// #logsV2 fragment ("/aws/lambda/x" → "$252Faws$252Flambda$252Fx").
function consoleEscape(name: string): string {
  return encodeURIComponent(encodeURIComponent(name)).replaceAll("%", "$")
}

function logGroupUrl(region: string, name: string): string {
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${consoleEscape(name)}`
}

const NOT_CONNECTED = {
  error: "CloudWatch credentials are missing or invalid for this workspace",
}

// Tool results must be the { error } record shape, never a thrown rejection —
// the tool trail and the model both consume the error text. AWS SDK errors
// carry the useful classification in `name` (e.g. AccessDeniedException).
function awsError(err: unknown): { error: string } {
  const name =
    err instanceof Error && err.name && err.name !== "Error"
      ? `${err.name}: `
      : ""
  const message = (err instanceof Error ? err.message : String(err)).slice(
    0,
    ERROR_MESSAGE_MAX
  )
  return { error: `CloudWatch request failed: ${name}${message}` }
}

const HOUR_MS = 60 * 60 * 1000

// Validates the raw inputs (a malformed timestamp is an { error } result, not
// a throw); when startTime is absent it defaults to spanMs before endTime.
function parseTimeRange(
  input: {
    startTime?: string
    endTime?: string
  },
  spanMs: number = HOUR_MS
): { start: Date; end: Date } | { error: string } {
  const end = input.endTime ? new Date(input.endTime) : new Date()
  if (Number.isNaN(end.getTime())) {
    return { error: "startTime/endTime must be ISO 8601 timestamps" }
  }
  const start = input.startTime
    ? new Date(input.startTime)
    : new Date(end.getTime() - spanMs)
  if (Number.isNaN(start.getTime())) {
    return { error: "startTime/endTime must be ISO 8601 timestamps" }
  }
  if (start >= end) {
    return { error: "startTime must be before endTime" }
  }
  return { start, end }
}

export const cloudwatchTools = {
  list_cloudwatch_log_groups: tool({
    description:
      "List the CloudWatch log groups in the connected AWS account's region. Use this to discover what can be searched before calling search_cloudwatch_logs.",
    inputSchema: z.object({
      prefix: z
        .string()
        .max(512)
        .optional()
        .describe("log group name prefix, e.g. /aws/lambda/"),
      limit: z.number().int().min(1).max(LOG_GROUPS_MAX).optional(),
    }),
    contextSchema: cloudwatchContext,
    execute: async ({ prefix, limit }, { context }) => {
      try {
        const clients = await clientsFor(context.externalId)
        if (!clients) return NOT_CONNECTED
        const response = await clients.logs.send(
          new DescribeLogGroupsCommand({
            logGroupNamePrefix: prefix,
            limit: limit ?? LOG_GROUPS_DEFAULT,
          })
        )
        return {
          region: clients.region,
          groups: (response.logGroups ?? []).flatMap((group) =>
            group.logGroupName
              ? [
                  {
                    name: group.logGroupName,
                    retentionDays: group.retentionInDays ?? null,
                    storedBytes: group.storedBytes ?? null,
                    url: logGroupUrl(clients.region, group.logGroupName),
                  },
                ]
              : []
          ),
        }
      } catch (err) {
        return awsError(err)
      }
    },
  }),

  search_cloudwatch_logs: tool({
    description:
      "Run a CloudWatch Logs Insights query over one or more log groups. The query uses Logs Insights syntax, e.g. `fields @timestamp, @message | filter @message like /error/ | sort @timestamp desc | limit 50`. Defaults to the last hour unless a time range is given.",
    inputSchema: z.object({
      logGroups: z
        .array(z.string().max(512))
        .min(1)
        .max(10)
        .describe("log group names from list_cloudwatch_log_groups"),
      query: z.string().max(4_000).describe("Logs Insights query string"),
      startTime: z
        .string()
        .optional()
        .describe("ISO 8601 start; default one hour before endTime"),
      endTime: z.string().optional().describe("ISO 8601 end; default now"),
      limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional(),
    }),
    contextSchema: cloudwatchContext,
    execute: async (
      { logGroups, query, startTime, endTime, limit },
      { context }
    ) => {
      try {
        const clients = await clientsFor(context.externalId)
        if (!clients) return NOT_CONNECTED
        const range = parseTimeRange({ startTime, endTime })
        if ("error" in range) return range

        const started = await clients.logs.send(
          new StartQueryCommand({
            logGroupNames: logGroups,
            queryString: query,
            startTime: Math.floor(range.start.getTime() / 1000),
            endTime: Math.floor(range.end.getTime() / 1000),
            limit: limit ?? QUERY_LIMIT_DEFAULT,
          })
        )
        const queryId = started.queryId
        if (!queryId) return { error: "CloudWatch did not accept the query" }

        const deadline = Date.now() + QUERY_DEADLINE_MS
        let timedOut = false
        let results = await clients.logs.send(
          new GetQueryResultsCommand({ queryId })
        )
        while (
          results.status === "Running" ||
          results.status === "Scheduled" ||
          results.status === "Unknown"
        ) {
          if (Date.now() > deadline) {
            timedOut = true
            // Stop the scan and fall through with whatever landed so far.
            await clients.logs
              .send(new StopQueryCommand({ queryId }))
              .catch(() => {})
            break
          }
          await new Promise((resolve) => setTimeout(resolve, QUERY_POLL_MS))
          results = await clients.logs.send(
            new GetQueryResultsCommand({ queryId })
          )
        }
        // Timeout is CloudWatch's own execution limit, distinct from our poll
        // deadline above — all three end states mean the query has no results.
        if (
          results.status === "Failed" ||
          results.status === "Cancelled" ||
          results.status === "Timeout"
        ) {
          return { error: `CloudWatch query ${results.status.toLowerCase()}` }
        }

        const rows = (results.results ?? []).map((row) =>
          Object.fromEntries(
            row
              .filter((f) => f.field && f.field !== "@ptr")
              .map((f) => [f.field, (f.value ?? "").slice(0, MESSAGE_MAX)])
          )
        )
        return {
          region: clients.region,
          status: timedOut ? "partial" : "complete",
          ...(timedOut
            ? { note: "Query hit the time budget — results may be partial" }
            : {}),
          recordsMatched: results.statistics?.recordsMatched ?? null,
          recordsScanned: results.statistics?.recordsScanned ?? null,
          rows,
        }
      } catch (err) {
        return awsError(err)
      }
    },
  }),

  list_cloudwatch_metrics: tool({
    description:
      "Discover CloudWatch metrics: list metric names and their dimensions, optionally filtered by namespace (e.g. AWS/Lambda, AWS/RDS) or metric name. Use this to find the exact namespace/dimensions for get_cloudwatch_metrics.",
    inputSchema: z.object({
      namespace: z.string().max(256).optional(),
      metricName: z.string().max(256).optional(),
    }),
    contextSchema: cloudwatchContext,
    execute: async ({ namespace, metricName }, { context }) => {
      try {
        const clients = await clientsFor(context.externalId)
        if (!clients) return NOT_CONNECTED
        const response = await clients.metrics.send(
          new ListMetricsCommand({
            Namespace: namespace,
            MetricName: metricName,
          })
        )
        return {
          region: clients.region,
          metrics: (response.Metrics ?? [])
            .slice(0, METRICS_LIST_MAX)
            .map((metric) => ({
              namespace: metric.Namespace ?? null,
              name: metric.MetricName ?? null,
              dimensions: (metric.Dimensions ?? []).map((d) => ({
                name: d.Name ?? "",
                value: d.Value ?? "",
              })),
            })),
        }
      } catch (err) {
        return awsError(err)
      }
    },
  }),

  get_cloudwatch_metrics: tool({
    description:
      "Fetch datapoints for one CloudWatch metric (namespace + name + dimensions, from list_cloudwatch_metrics). Defaults to the last three hours at five-minute resolution.",
    inputSchema: z.object({
      namespace: z.string().max(256).describe("e.g. AWS/Lambda"),
      metricName: z.string().max(256).describe("e.g. Errors"),
      dimensions: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .max(10)
        .optional(),
      stat: z
        .enum([
          "Average",
          "Sum",
          "Minimum",
          "Maximum",
          "SampleCount",
          "p50",
          "p90",
          "p95",
          "p99",
        ])
        .optional()
        .describe("default Average"),
      periodSeconds: z.number().int().min(60).max(86_400).optional(),
      startTime: z
        .string()
        .optional()
        .describe("ISO 8601 start; default three hours before endTime"),
      endTime: z.string().optional().describe("ISO 8601 end; default now"),
    }),
    contextSchema: cloudwatchContext,
    execute: async (
      {
        namespace,
        metricName,
        dimensions,
        stat,
        periodSeconds,
        startTime,
        endTime,
      },
      { context }
    ) => {
      try {
        const clients = await clientsFor(context.externalId)
        if (!clients) return NOT_CONNECTED
        const range = parseTimeRange({ startTime, endTime }, 3 * HOUR_MS)
        if ("error" in range) return range

        const response = await clients.metrics.send(
          new GetMetricDataCommand({
            StartTime: range.start,
            EndTime: range.end,
            // Newest first, so the DATAPOINTS_MAX slice below is guaranteed to
            // keep the most recent datapoints.
            ScanBy: "TimestampDescending",
            MetricDataQueries: [
              {
                Id: "m1",
                MetricStat: {
                  Metric: {
                    Namespace: namespace,
                    MetricName: metricName,
                    Dimensions: dimensions?.map((d) => ({
                      Name: d.name,
                      Value: d.value,
                    })),
                  },
                  Period: periodSeconds ?? 300,
                  Stat: stat ?? "Average",
                },
              },
            ],
          })
        )
        const series = response.MetricDataResults?.[0]
        const times = series?.Timestamps ?? []
        const values = series?.Values ?? []
        // Surface everything that means "you're not seeing the full picture":
        // AWS-side partial data / pagination, AWS diagnostic messages, and our
        // own local truncation.
        const awsMessages = [
          ...(response.Messages ?? []),
          ...(series?.Messages ?? []),
        ].flatMap((m) => (m.Value ? [m.Value] : []))
        const notes = [
          series?.StatusCode === "PartialData" || response.NextToken
            ? "AWS returned partial data for this range"
            : null,
          times.length > DATAPOINTS_MAX
            ? `showing the newest ${DATAPOINTS_MAX} of ${times.length} datapoints — use a larger periodSeconds or a narrower time range for full coverage`
            : null,
          ...awsMessages,
        ].filter((n): n is string => n !== null)
        return {
          region: clients.region,
          metric: `${namespace} ${metricName} (${stat ?? "Average"})`,
          datapoints: times.slice(0, DATAPOINTS_MAX).map((time, i) => ({
            time: time.toISOString(),
            value: values[i] ?? null,
          })),
          ...(notes.length > 0 ? { note: notes.join(" · ") } : {}),
        }
      } catch (err) {
        return awsError(err)
      }
    },
  }),
}
