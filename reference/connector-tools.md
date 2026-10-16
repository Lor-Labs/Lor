# Connector tool controls

Shared controls, the Better Stack connector, profile tool access, and the
simplified connector picker are implemented. Notion and Attio write tools are
implemented and awaiting authenticated rollout; Attio is ready for review.

## Locked behavior

- Built-in connections save explicit tool names. Each connector owns recommended
  defaults; Linear, Notion, and Attio include their reviewed writes, Better Stack
  starts read only.
- The tool picker groups tools as Read and Write (built-ins) or Read only and
  Other tools (MCP). Only an explicit `readOnlyHint: true` joins the read group.
  Each group header has a group checkbox and expands to individual checkboxes;
  partly selected groups (and all MCP groups) start open. Built-ins offer Reset
  to defaults. Selections save explicit names and never auto-enable future
  tools. Built-in Save/Cancel actions appear only for changed selections. MCPs
  keep their existing form save and OAuth completion actions.
- Custom MCP discovery carries the provider's `readOnlyHint`. The label is a
  provider declaration, not a security guarantee or an approval exemption.
- Profile connector/MCP selections intersect workspace-enabled tool names.
  Approval rules target individual tools. Connector capability groups are
  removed; disabled tools must never bind to the agent.
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

Apply the [per-tool approval migration](approval-policies.md#breaking-rollout)
and database schema first, deploy API/web code together, configure approval rules,
then start workers. The new UI requires the updated integration API response. This task does not change the production database or
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
```

New connector tools must be added to `CONNECTOR_TOOLS` as well as the runtime
binding. New recommended defaults affect only new connections and an explicit
Use defaults action. Update the reviewed
`SIDE_EFFECT_TOOLS` set when adding built-in write tools.

## Notion write tools

Notion uses the existing official JavaScript SDK and OAuth connection, with no
MCP server or new deployment secrets. All five writes default on, appear in
the shared Write group, and retain workspace/profile tool selections and normal
approval gates. Each tool has its own approval rule; connector read/write
capability groups no longer exist.

| Tool | Behavior | Notion capability |
|---|---|---|
| Create page | Create a page under a shared page, or an entry in a shared data source, optionally with Markdown | Insert content |
| Append page content | Add Markdown at the end, preserving existing content | Update content |
| Edit page content | Targeted search-and-replace; missing or ambiguous matches are rejected | Update content |
| Update page properties | Update named writable fields, including title, status, dates, people, and relations | Update content |
| Add comment | Comment on a page or reply using a fetched discussion ID | Insert comments |

Edits do not expose the full-page replacement operation and explicitly disable
child-page/database deletion. Property inputs exclude computed values and use
existing select/status option IDs, so they cannot create options or change a
database schema. Array properties replace that field's values; Lor is instructed
to retain existing values and avoid updates based on incomplete reads. There are
no move, archive, delete, or database administration tools.

Each tool makes one mutation request and returns a bounded receipt for the tool
trail. SDK mutation retries are disabled; only an explicitly rejected 401 can
refresh authorization and retry. Timeouts and server errors return an unknown
outcome with instructions to inspect the target before another write. Recorded
successes and unknown outcomes replay through the existing per-run result store,
including when the receipt exceeds its output cap. This is recovery protection,
not provider-level exactly-once delivery. These tools are blocked from bulk
export and are not available to background archive synthesis.

### Setup and rollout

1. Apply the [per-tool approval migration](approval-policies.md#breaking-rollout),
   then `pnpm db:push`, before deploying the backend. No Notion-specific enum is needed.
2. In the Lor Notion connection's Developer portal → Configuration → Capabilities,
   keep Read content, Read comments, and User information without email addresses.
   Enable Insert content, Update content, and Insert comments for these writes.
3. Reconnect Notion in Lor after changing the public connection's capabilities.
   Select the pages/databases Lor should access; shared parents include children.
   Reconnecting the same account preserves the saved tool selection.
4. New connections enable all nine read/write tools by default. For an existing
   connection, use Reset to defaults or select the desired tools in Workspace
   settings → Connectors → Notion. Check the relevant agent profile and configure
   approval rules for the individual tools that should ask first.
5. Verify the enabled operations on a disposable shared page/database after
   deployment, including approval and a disabled-tool case.

Connection setup still verifies only read access; it never performs write probes
or claims the saved read-scope marker proves write permission. Notion enforces
the actual token capabilities and page access at execution, and denied writes
return permission/reconnect guidance. No provider settings, database changes, or
authenticated writes were performed during implementation. Focused review, lint,
and type checking are local validation; live behavior remains rollout work.

Provider references: [connection capabilities](https://developers.notion.com/reference/capabilities),
[Markdown updates](https://developers.notion.com/reference/update-page-markdown),
[page properties](https://developers.notion.com/reference/patch-page), and
[comments](https://developers.notion.com/reference/create-a-comment).
Append currently uses the supported `insert_content` operation with an explicit
end position; Notion labels this operation legacy, so revisit it when upgrading
the pinned API version (`2026-03-11`).

## Attio write tools

Attio keeps its existing REST API and OAuth connection. Seven writes join the
shared Write checklist and default on for new connections and Reset to defaults.
Reconnecting the same account preserves its explicit saved selection; it does
not automatically enable newly added tools. Workspace and profile selections
still intersect. Approval rules target each individual Attio tool; there is no
separate connector capability or approval group.

| Tool | Behavior | Required write scope |
|---|---|---|
| Create CRM record | Create a person, company, deal, or custom record | `record_permission:read-write` |
| Update CRM record | Update supplied fields on an existing record | `record_permission:read-write` |
| Add record to list | Create an entry for an existing record | `list_entry:read-write` |
| Update list entry | Update a pipeline stage or other entry fields | `list_entry:read-write` |
| Add note | Create a Markdown note attached to a record | `note:read-write` |
| Create task | Create a plaintext task with records, assignees, and a deadline | `task:read-write` |
| Update task | Complete/reopen a task or update its deadline, links, or assignees | `task:read-write` |

Record and list-entry updates append multiselect values by default (`PATCH`).
An explicit overwrite choice uses `PUT` to replace supplied fields' multiselect
values; unrelated attributes remain unchanged. Lor is instructed to preserve
all intended values and avoid overwriting incomplete reads. Creating a list
entry does not deduplicate existing memberships: Attio permits multiple entries
for one parent, so Lor must check memberships before adding one.

Attribute values support bounded scalars, flat structured objects, and arrays.
Nested record-creation references are not accepted, keeping Update separate from
Create. References to existing records use IDs. These tools do not expose
deletion, merging, schema administration, creating select/status options, or
editing existing notes. Task updates omit text because Attio's API only supports
deadline, completion, linked records, and assignees. Task list fields replace
their current contents; omitted fields stay unchanged.

The existing `query_attio` read tool now supports `schema`, `select_options`, and
`statuses`, with `targetType=objects|lists` and an optional attribute slug/ID.
This exposes writable flags, types, cardinality, and valid choices without a
separate permission path. Attribute and option lists expose bounded pages and
`nextOffset` when more results may remain. `mode=task` reads a task by ID, including
tasks without linked records, so Lor can inspect them before updating. Read
results flag omitted field data with `dataTruncated`; activity also names failed
or potentially partial `incompleteSections`. The existing catalog still resolves
object/list IDs and workspace member IDs.

Writes make one mutation request without automatic retries and return bounded
receipts in the tool trail. Missing tokens and denied permissions return clear
reconnection guidance. Timeout, server-error, or malformed success responses
return an unknown outcome; recorded unknown outcomes and successes use the
existing run replay protection. The tools cannot run through bulk export or
background archive synthesis. No provider-level exactly-once guarantee is made.

### Setup and rollout

1. Apply the [per-tool approval migration](approval-policies.md#breaking-rollout),
   then `pnpm db:push`. No Attio-specific enum is needed.
2. In the Attio app's Developer Console, retain the required read scopes and
   `webhook:read-write`. Set records, list entries, notes, and tasks to read/write
   using the four scopes above. Their read/write scopes also satisfy the
   corresponding read requirements. Object/list configuration and other products
   remain read only; unsupported write scopes are still rejected on connection.
3. Reconnect Attio in Lor to authorize the new scopes. Existing tokens may only
   have read access; Notion's permissions and reconnection are independent.
4. For an existing connection, Reset to defaults or select the desired tools.
   New connections start with all eleven reads/writes. Check the channel's agent
   profile and optionally require approval for the individual tools.
5. Verify operations on disposable CRM records and a list after deployment,
   including approval, a disabled tool, multiselect preservation, and task completion.

No database, Attio app settings, or authenticated CRM data were changed during
implementation. Live verification remains rollout work. This adds no new secrets,
events, or webhook subscriptions. Lor-created notes/list entries can produce the
same events as changes made in Attio; existing event routing remains in effect.

Provider references: [OpenAPI definition](https://api.attio.com/openapi/api),
[OAuth setup](https://docs.attio.com/rest-api/tutorials/connect-an-app-through-oauth),
[record updates](https://docs.attio.com/rest-api/endpoint-reference/records/update-a-record-overwrite-multiselect-values),
[list-entry updates](https://docs.attio.com/rest-api/endpoint-reference/entries/update-a-list-entry-overwrite-multiselect-values),
[notes](https://docs.attio.com/rest-api/endpoint-reference/notes/create-a-note),
and [task updates](https://docs.attio.com/rest-api/endpoint-reference/tasks/update-a-task).

## Validation and remaining rollout

Repo-wide lint and type checking passed, including the API build required by
client type generation. The Vite web production build passed. No tests or evals
were run under repository policy. Database changes and an authenticated live
Better Stack connection remain rollout work; the complete credentialed flow has
not been exercised here. Connector administration remains web-only, matching the
existing mobile settings; mobile tool-trail branding includes Better Stack.

## Profile tool access

- Connector settings define the tools available to the workspace.
- Agent profiles follow that workspace selection by default and can turn off a
  connector or select a narrower set of individual tools, grouped by connector.
- Read-only selection is a convenience preset rather than the unit of access.
- Approval rules remain a separate control over permitted actions.
- The customer-facing Capabilities section is removed. Profile controls and
  tool selections now describe access; approvals also target individual tools.
- Pre-launch breaking changes are acceptable. Do not add compatibility paths for
  the previous profile configuration format.

- [x] Profile access model, API, and enforcement.
- [x] Profile editor and configuration-proposal summaries using the new tool
  access contract.
- [x] Connector tool-picker redesign and removal of the Capabilities section.

The web and mobile profile editors show one row per connected service with a
switch: off is Off, on follows workspace tools. Opening the row shows the same
Read/Write checklist as connector settings; changing a checkbox saves a custom
list, and Use all tools returns to following. Built-in and API tools use the
same switch rows. Grouping, description cleanup, summaries and notes live in
`@repo/connectors` (`tool-groups.ts`, `profile-tools.ts`) so both apps match.
Only an explicit `readOnlyHint: true` counts as read only. Built-in abilities
and custom HTTP API tools remain separate; All API tools no longer implies MCP
access. Profile chips name a service, with a tool count only for custom lists.

Configuration-proposal cards show workspace-following behavior, every service
override, and the complete custom tool selection without truncating permission
lines. Names are resolved from the workspace catalog where available; unavailable
MCP servers fall back to their IDs. Editors flag saved selections that no longer
exist, and require an explicit removal before saving rather than silently dropping
restrictions. No old connector grants are converted or preserved through a fallback.

The obsolete `mcpServerIds` request/response field, `availableMcpServers` duplicate
list, proposal `mcpServers` grant array, and `agent_profile_mcp_server` schema have
been removed. Profile writes reject unknown fields, including the removed grant
fields. MCP access is now solely in `toolAccess.mcpServers`.

### API contract

Profile GET/create/update responses include `toolAccess`. Profile listing also
returns `availableToolGroups` with connected built-in services, saved MCP
servers, and only their workspace-enabled tool names. Built-in tool metadata
comes from the reviewed catalog. Custom MCP descriptions and read-only hints
come from `mcp_server.tool_metadata`, a display-only snapshot for enabled tools.
Only explicit `readOnlyHint: true` shows Read only; false and unknown have no
badge. Both web and mobile profile editors consume this metadata. No external
MCP handshakes run just to list profiles.

Static server creation and saves discover missing metadata server-side; metadata
failures leave hints unknown and do not block configuration saves. Saved-server
Refresh tools replaces the snapshot only when discovery used the saved endpoint,
headers, and secrets. Unsaved discovery previews do not overwrite saved labels.
OAuth completion reads raw tool definitions to preserve annotations, and saves
the verified selection and its metadata together. Reauthorization, disconnect,
and connection edits clear metadata from the previous connection. Snapshot
checks prevent late discovery from writing metadata over changed settings.

Existing MCP servers acquire labels on their next Refresh tools or OAuth tool
review. Metadata never changes enabled tools, profile permissions, or approval
rules. It is a provider declaration, not an authorization or safety guarantee.

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
existing internal grants. `grantsAll` never overrides connector or
MCP tool restrictions. Channel resolution remains channel → category → workspace
default. Missing channels and failed profile reads do not grant external tools.
Runs without a channel also honor the workspace default profile.

### Other execution paths

- Main and resumed runs bind only effective connector/MCP tool names.
- Archive synthesis applies the same per-tool intersection and excludes tools
  with approval gates, because this background task cannot request approval.
- Bulk export refuses approval-gated tools by their individual identity; those must be called directly so
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

ALTER TABLE mcp_server
  ADD COLUMN IF NOT EXISTS tool_metadata jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Once all services use tool_access, remove the unused grant table.
DROP TABLE IF EXISTS agent_profile_mcp_server;
```

Apply the schema changes before running the updated API. The metadata column
has a non-null empty-array default, so existing rows start with unknown hints;
Refresh tools populates their snapshots. No database changes were executed by
this implementation. Review the profile editor and connector picker before
committing. Lint, type checking, and builds are the validation workflow; no tests
or browser harnesses are run.
