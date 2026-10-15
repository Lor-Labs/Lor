# Connector tool controls

In flight. Shared controls land before the Better Stack connector.

## Locked behavior

- Built-in connections save explicit tool names. Each connector owns recommended
  defaults; Linear includes its reviewed writes, Better Stack starts read only.
- Read only / Read & write presets populate the selection. Customize tools opens
  individual checkboxes. Only explicitly read-only tools show a Read only badge.
- Custom MCP discovery carries the provider's `readOnlyHint`. The label is a
  provider declaration, not a security guarantee or an approval exemption.
- Connection selections intersect agent-profile capabilities. Existing approval
  rules still apply. Disabled tools must never bind to the agent.
- Existing connections retain a frozen snapshot of today's tools until saved.
  Nullable `integration_connection.enabled_tools` means that legacy snapshot,
  never a moving “all tools” default. An empty array enables no tools.
- New connections save today's recommended names. Reconnecting the same account
  preserves its selection. New catalog/upstream tools stay off on saved connections.
- Better Stack uses a curated surface for investigation and explicit opt-in
  state changes. Inbound error alerts and outbound investigation are separate.

## Implementation

- [x] Shared catalog, defaults, frozen legacy snapshots, connection column.
- [x] Management API validates and persists workspace-scoped selections.
- [x] Runtime filters connector tools after profile grants and before binding.
- [x] Shared picker, built-in settings, MCP read-only metadata and bulk selection.
- [x] Better Stack auth, registry, curated tools, profile gates, settings.
- [x] Focused code review, lint, type checking and builds; no tests or evals.

## Rollout

Apply the database schema first, deploy API/worker code next, then deploy the
web app. The new UI requires the updated integration API response. This task does not change the production database or
deploy services. Verify a real Better Stack connection with a user-supplied API
token after deployment; the error-reporting DSN is not that token.

## Better Stack setup

Connect from Workspace settings → Connectors → Better Stack with an API token
from Better Stack's API token settings. Credentials are encrypted with the
existing `INTEGRATION_ENCRYPTION_KEY`; no new deployment secret is required.
The token's product/team access limits which investigation calls succeed.
The connection verifies authenticated MCP discovery, not every product's data
permissions. Replacing a token creates a new credential identity and resets to
the recommended read-only tools; reconnecting the same token preserves choices.

The implementation uses Better Stack's hosted MCP transport, not a Codex plugin.
Only reviewed upstream tools are requested with `X-MCP-Tools-Only`, then filtered
again locally. Local names are prefixed with Better Stack to avoid collisions.
The reviewed surface covers application errors, telemetry queries, uptime
monitors and incidents; it excludes dashboard administration, deletion, user
management, and creating integrations. Resolve incident and Update error state
require both explicit tool selection and the `betterstack_write` profile grant.
They retain normal approval gates and durable action replay protection, and
cannot be called through the bulk-export tool.

Inbound error webhooks remain separate. A connected investigation tool does not
create an alert rule, forward alerts, or change the existing #health webhook.
Selection changes apply when the next response (including a resumed run) builds
its tool set; they do not cancel a tool already executing.

Provider reference: [MCP integration documentation](https://betterstack.com/docs/getting-started/integrations/mcp/).
Exact upstream names were checked against Better Stack's official
[investigation examples](https://github.com/BetterStackHQ/claude-plugin/blob/main/skills/investigate-incident/SKILL.md)
and [error query reference](https://github.com/BetterStackHQ/claude-plugin/blob/main/skills/errors-query/SKILL.md).
These are vendor API reference data, not instructions installed into Lor.

## Additive schema changes

Apply these before deploying API/worker code. No backfill is needed: null tool
selections use the frozen legacy snapshot. The following is a focused alternative
to a full schema push when unrelated schema work is also pending:

```sql
ALTER TABLE integration_connection ADD COLUMN IF NOT EXISTS enabled_tools text[];
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'betterstack' BEFORE 'webhook';
ALTER TYPE lor_capability ADD VALUE IF NOT EXISTS 'betterstack' BEFORE 'web';
ALTER TYPE lor_capability ADD VALUE IF NOT EXISTS 'betterstack_write' BEFORE 'web';
```

New connector tools must be added to `CONNECTOR_TOOLS` as well as the runtime
binding. Never extend `LEGACY_TOOLS`. New recommended defaults affect only new
connections and an explicit Use defaults action. Update the reviewed
`SIDE_EFFECT_TOOLS` set when adding built-in write tools.

## Validation and remaining rollout

Repo-wide lint and type checking passed, including the API build required by
client type generation. The Vite web production build passed. No tests or evals
were run under repository policy. Database changes and an authenticated live
Better Stack connection remain rollout work; the complete credentialed flow has
not been exercised here. Connector administration remains web-only, matching the
existing mobile settings; mobile tool-trail branding includes Better Stack.
