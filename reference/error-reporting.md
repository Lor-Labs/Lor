# Backend error reporting

Backend error events go directly to Better Stack Errors through the
Sentry-compatible SDK. Full stdout logs still go through Railway / Locomotive
to Better Stack Logs. These are independent pipelines: log ingestion does not
populate Errors, and the Lor channel webhook URL is not an ingestion DSN.

## Configuration and rollout

1. Create an application in Better Stack Errors. Copy its DSN from the Ingest
   tab; the existing backend application can be shared by all backend services.
2. In Railway, set `BETTERSTACK_ERRORS_DSN` on **api**, **worker**,
   **realtime**, and **transcriber**. Leave it unset locally unless local error
   reporting is wanted. The DSN is deployment configuration, never committed.
3. On **api**, set `BETTERSTACK_ALERT_WEBHOOK_ID` to the UUID of the Lor
   webhook receiving error notifications (the path segment immediately after
   `/v1/webhooks/`, not its secret token). Failures delivering to that webhook
   stay in stdout but do not generate another error alert. Other channel
   webhooks still report failures normally.
4. Deploy the code and variables together. `APP_VERSION` can specify a release;
   otherwise the SDK and stdout logger use Railway's `RAILWAY_GIT_COMMIT_SHA`.
   The error environment is `NODE_ENV`. Reporting is disabled in `test`.
5. Under Better Stack **Errors → Outgoing webhooks**, add an Error webhook
   pointing to the Lor channel's native webhook URL. Select **New error**,
   **Reoccurred**, and **Spike**. Use POST with `Content-Type: application/json`.
   In Advanced settings, replace the default JSON body with:

   ```json
   {
     "content": "**$APPLICATION_NAME** · $ENVIRONMENT · $EVENT\n[View error]($ERROR_URL)"
   }
   ```

   Lor accepts at most 2,000 characters in `content`. Link to the full report
   rather than copying an unbounded error message or stack into the template.
   The webhook's Post effect should be on; Act can stay off. Retain an email
   notification path for when Lor is unavailable. If Error webhooks are absent
   from the team's UI, resolve access with Better Stack before rollout.
6. Review the first captured production errors in Better Stack and their
   outgoing delivery logs. Confirm the application, service, release, original
   stack, and request/job identifiers match the operation being investigated.
   The completed webhook setup alone only demonstrates notification delivery;
   the deployed SDK is what starts collecting application errors.

## Implementation

- Each service imports `src/instrumentation.ts` before its application graph.
  This loads development env files and initializes reporting early enough for
  startup failures. Transcriber job subprocesses initialize independently.
- `packages/logger/src/error-reporting.ts` uses `@sentry/node-core/light`:
  error capture and process handlers without OpenTelemetry, automatic HTTP
  instrumentation, performance tracing, session tracking, or a second log drain.
  The light SDK uses Node APIs supported by the production Bun services and
  the Node transcriber. Live ingestion in both runtimes remains a deployment
  verification step; lint, type checks and builds do not confirm delivery.
- Pino's shared `logMethod` hook reports `error` and `fatal` calls. Native
  Errors retain their original stacks; serialized errors retain their message,
  type and stack; plain log messages become grouped error-level events.
- The service is a process-level tag (`api`, `worker`, `realtime`,
  `transcriber`); `logger` identifies the emitting package (`lor`, `auth`, etc.).
  Only explicit operation identifiers and HTTP route/status fields are copied
  from log bindings, rather than arbitrary payloads.
- A WeakSet deduplicates the same exception object across catch/rethrow paths,
  process handlers, and HTTP response logs. Distinct Error instances remain
  separate occurrences for Better Stack's grouping and spike detection.
- HTTP 5xx completions log at error level in production too. Thrown exceptions
  are reused on completion so one exception does not become two reports.
  Expected HTTP 4xx responses stay at warn level and do not generate reports.
- No HTTP headers, bodies, breadcrumbs, or user profiles are sent. Known
  credential fields, credential-bearing URLs, bearer tokens, email addresses,
  and Lor webhook tokens are scrubbed from event data. This does not guarantee
  removal of sensitive text embedded in arbitrary exception messages; callers
  must avoid putting secrets or customer content in messages.
- Worker shutdown and bootstrap failures, realtime bootstrap failures, and
  transcriber job completion/failure flush queued events for up to two seconds.
  Uncaught fatal exceptions use the SDK's bounded flush before exiting.
  Forced termination can still lose buffered reports. Reporting failures never
  throw through the shared logger.

## Scope

This implements backend error capture only. Frontend/Expo SDKs, build source-map
uploads, and a customer-facing Better Stack connector are separate work. The
SDK interface and environment-based DSN keep a later Sentry migration contained;
webhooks, source-map upload settings and historical data remain provider-specific.

Provider references:

- [Error ingestion](https://betterstack.com/docs/errors/collecting-errors/sentry-sdk/)
- [Error webhooks](https://betterstack.com/docs/errors/integrations/outgoing-webhooks/)
- [Source maps](https://betterstack.com/docs/errors/collecting-errors/upload-source-maps/)
