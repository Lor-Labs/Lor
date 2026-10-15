# Connector tool controls

Shared controls and the Better Stack connector are implemented. The backend profile
tool-access model is implemented; its editor and the picker redesign remain
separate review batches.

## Locked behavior

- Built-in connections save explicit tool names. Each connector owns recommended
  defaults; Linear includes its reviewed writes, Better Stack starts read only.
- Read only / Read & write presets populate the selection. Customize tools opens
  individual checkboxes. Only explicitly read-only tools show a Read only badge.
- Custom MCP discovery carries the provider's `readOnlyHint`. The label is a
  provider declaration, not a security guarantee or an approval exemption.
- Profile connector/MCP selections intersect workspace-enabled tool names.
  Capability groups are internal startup/approval plumbing. Existing approval
  rules still apply. Disabled tools must never bind to the agent.
- `integration_connection.enabled_tools` is a required explicit list. An empty
  array enables no tools. Pre-launch configurations need no compatibility path.
- New connections save today's recommended names. Reconnecting the same account
  preserves its selection. New catalog/upstream tools stay off on saved connections.
- Better Stack uses a curated surface for investigation and explicit opt-in
  state changes. Inbound error alerts and outbound investigation are separate.

## Implementation

- [x] Shared catalog, defaults, explicit selections, connection column.
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
require both workspace enablement and inclusion in the profile's effective tool
selection. They retain normal approval gates and durable action replay protection, and
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

## Schema rollout

Apply these before deploying API/worker code. Any old null tool selections reset
to no enabled tools; reconnect or select tools in settings afterward. There is
no attempt to preserve those pre-launch configurations. The following is a
focused alternative to a full schema push when unrelated schema work is pending:

```sql
ALTER TABLE integration_connection
  ADD COLUMN IF NOT EXISTS enabled_tools text[] NOT NULL DEFAULT '{}';
UPDATE integration_connection SET enabled_tools = '{}' WHERE enabled_tools IS NULL;
ALTER TABLE integration_connection
  ALTER COLUMN enabled_tools SET DEFAULT '{}',
  ALTER COLUMN enabled_tools SET NOT NULL;
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'betterstack' BEFORE 'webhook';
ALTER TYPE lor_capability ADD VALUE IF NOT EXISTS 'betterstack' BEFORE 'web';
ALTER TYPE lor_capability ADD VALUE IF NOT EXISTS 'betterstack_write' BEFORE 'web';
```

New connector tools must be added to `CONNECTOR_TOOLS` as well as the runtime
binding. New recommended defaults affect only new connections and an explicit
Use defaults action. Update the reviewed
`SIDE_EFFECT_TOOLS` set when adding built-in write tools.

## Validation and remaining rollout

Repo-wide lint and type checking passed, including the API build required by
client type generation. The Vite web production build passed. No tests or evals
were run under repository policy. Database changes and an authenticated live
Better Stack connection remain rollout work; the complete credentialed flow has
not been exercised here. Connector administration remains web-only, matching the
existing mobile settings; mobile tool-trail branding includes Better Stack.

## Profile tool access — backend batch implemented

- Connector settings define the tools available to the workspace.
- Agent profiles follow that workspace selection by default and can turn off a
  connector or select a narrower set of individual tools, grouped by connector.
- Read-only selection is a convenience preset rather than the unit of access.
- Approval rules remain a separate control over permitted actions.
- Remove the customer-facing Capabilities section and replace broad profile
  capability switches with tool access. Built-in tools and custom MCP tools
  should use consistent access concepts.
- Pre-launch breaking changes are acceptable. Do not add compatibility paths for
  the previous profile configuration format.

- [x] Profile access model, API, and enforcement.
- [ ] Profile editor and configuration-proposal summaries using the new tool
  access contract.
- [ ] Connector tool-picker redesign and removal of the Capabilities section.

This batch does not update the profile editor. Do not deploy it with the old
editor: connector capability writes and nonempty whole-server `mcpServerIds`
writes are rejected, and the editor cannot yet configure the new selections.
The old MCP grant join table is no longer read for authorization; its schema
can be removed with the editor/API cleanup. No old connector grants are converted
or preserved through a fallback.

### API contract

Profile GET/create/update responses include `toolAccess`. Profile listing also
returns `availableToolGroups` with connected built-in services, saved MCP
servers, and only their workspace-enabled tool names. Built-in tool metadata
includes read-only labels; saved MCP tool names have unknown annotations here
until discovery metadata is made available to the editor. No external MCP
handshakes run just to list profiles.

`toolAccess` has `connectors` (provider IDs) and `mcpServers` (server UUIDs).
Each override is `{ "mode": "workspace" }`, `{ "mode": "off" }`, or
`{ "mode": "custom", "tools": ["tool_name"] }`. Omitted entries follow workspace
selections, including subsequently enabled workspace tools. Custom selections
are fixed names and never gain newly enabled names automatically. Profiles
cannot enable tools disabled in workspace settings. An empty custom list denies
all tools for that service.

PATCH replaces the whole `toolAccess` object rather than merging nested groups;
clients must send every override they want to retain. Other profile fields are
unchanged by a toolAccess-only PATCH. API validation rejects foreign MCP IDs,
disconnected providers, and names absent from the workspace-enabled list.
Configuration proposals validate and persist the same access format.

Example profile create/update tool-access payload:

```json
{
  "toolAccess": {
    "connectors": {
      "linear": {
        "mode": "custom",
        "tools": ["search_linear", "fetch_linear", "create_linear_issue"]
      },
      "betterstack": { "mode": "off" }
    },
    "mcpServers": {}
  }
}
```

Standalone abilities (web, artifacts) and individual HTTP tools retain their
existing internal grants in this batch. `grantsAll` never overrides connector or
MCP tool restrictions. Channel resolution remains channel → category → workspace
default. Missing channels and failed profile reads do not grant external tools.
Runs without a channel also honor the workspace default profile.

### Other execution paths

- Main and resumed runs bind only effective connector/MCP tool names.
- Archive synthesis applies the same per-tool intersection and excludes tools
  with approval gates, because this background task cannot request approval.
- Bulk export refuses approval-gated tools; those must be called directly so
  the normal approval flow runs.
- Composer record search requires the matching enabled search tool; GitHub file
  browsing requires `investigate_code` independently of record-search access.
- Lor's core `fetch_source` reads stored summaries only. Live reads must use an
  explicitly enabled connector fetch tool, which also carries its approval gate.
  This avoids a core-tool path around connector restrictions. Direct source
  content reads outside Lor retain their existing live-fetch behavior.
- Shared brain and stored-source visibility remain separate from tool access;
  disabling a connector tool does not erase already ingested workspace memory.

### Profile schema rollout

Apply before starting this backend version, and release the new profile editor
with it. Existing rows reset to workspace-following connector/MCP access; there
is no conversion from their old capability or MCP grant lists.

```sql
ALTER TABLE agent_profile
  ADD COLUMN IF NOT EXISTS tool_access jsonb NOT NULL
  DEFAULT '{"connectors":{},"mcpServers":{}}'::jsonb;
```

The database has not been changed by this batch. Review runtime enforcement and
API behavior before proceeding to the editor batch.
