# Lor projects linked to Linear projects

> Status: starting point for a separate design thread. Split out of
> `reference/onboarding.md` on 2026-10-07. Nothing is decided. Facts
> below were verified against code on 2026-10-07.

## Idea

A team that runs its work in Linear projects should be able to create a Lor
project from a Linear project. Lor then knows which Linear project a channel
belongs to, scopes its Linear tools to it, and can optionally post that
project's issue activity into the project's channel. Onboarding would later
gain a "Create projects from Linear" option under the Linear setup card.

## What exists today

- **Lor projects** are lifecycle over a category channel
  (`packages/db/src/schemas/projects.ts`). The name, audience and members
  live on the category. The `project` row adds `description`, `targetDate`,
  `status` (`active | archiving | archived`), archive summary and memories,
  and a brain folder. No external reference column. The only Linear hint is a
  comment: "a linked Linear project can autofill it later"
  (`apps/api/src/routes/v1/projects/schema.ts:38`).
- **Archive** is inline logic in the `archiveProject` handler. There is no
  unarchive route and no `archivedBy` column.
- **Lor's Linear tools** are issue-only (`packages/lor/src/linear.ts`).
  `list_linear_issues` already filters by project id, slugId, or name.
  `create_linear_issue` has no project parameter. No tool reads a project's
  lead, members, status, target date, health, or updates. The registry copy
  ("Search issues and projects") claims more than the tools do.
- **`@linear/sdk` 87** exposes the full `Project` model: `lead`, `members()`,
  `status`, `targetDate`, `health`, `projectUpdates()`, `issues()`, and a
  `ProjectWebhookPayload` with `memberIds`, `leadId`, `status`, `targetDate`,
  `completedAt`, `canceledAt`, `archivedAt`.
- **Linear webhook handler** (`apps/api/src/routes/v1/integrations/linear/index.ts`)
  acts on three events: Issue create (`issue_created`), Issue update into a
  completed state (`issue_completed`), and `OAuthApp` `revoked`. Every other
  verified payload is acked and ignored. Issue payloads carry `projectId` and
  `project { id, name, url }`, but the handler's narrowed type never reads
  them.
- **Connector triggers** are unique per (connection, event), so one Linear
  event can post to one channel. A per-project feed cannot use the trigger
  table as it stands.
- **No identity mapping** exists between Linear users and Lor users.

## Linear app webhook configuration

The webhook is app-level, set in the Lor OAuth application's settings in
Linear, with one signing secret (`LINEAR_WEBHOOK_SECRET`). As of 2026-10-07:

| Group | Subscribed |
|---|---|
| Data change events | Issues, Comments |
| Other events | none |
| App events | none |
| Authorization events | none |

Consequences:

- **The revoke handler probably never fires.** It waits for an `OAuthApp`
  `revoked` event, and "OAuth authorization events" is unchecked. If a
  customer revokes Lor in Linear, the connection row stays active and token
  refresh fails quietly. Checking that box is a dashboard change, not a code
  change. This is a bug today, independent of projects.
- **Comments are delivered but unused.** Harmless, just traffic.
- **Linking and a per-project issue feed need no webhook change.** Issue
  events already carry `projectId`.
- **Syncing project status, dates, or members** would need the Projects data
  change events, and Project updates if updates are ingested.

## Candidate v1 scope

The link is an id plus a snapshot, and Lor is scoped by it.

- `project.linearProjectId text`, `project.linearProjectName text`,
  `project.linearProjectUrl text` (nullable; partial unique index on
  `(workspace_id, linear_project_id)`).
- `GET /workspaces/{key}/integrations/linear/projects` lists the org's
  projects for pickers.
- Create and PATCH project accept `linearProjectId`, validated with
  `client.project(id)` under the workspace's Linear connection. Description
  and target date autofill from Linear when the Lor fields are empty.
- Web create-project dialog gains a Linear project picker. The onboarding
  Linear card gains "Create projects from Linear": a multi-select of started
  projects, each becoming a Lor project with one `#general` child.
- Lor scoping: in a linked project's channels the run context names the
  linked project and id; `list_linear_issues` guidance says to filter by it;
  `create_linear_issue` gains `projectId`, defaulting to the linked project.
- Optional per-project issue feed, off by default (a `linearFeed` boolean on
  `project`). Issue events whose `data.projectId` matches a linked project
  post to that project's first text channel, outside the trigger table.
  Off by default for the same reason connector routing is off in onboarding:
  feeds are noisy and teams opt in.

## Deferred, with reasons

- **Member and lead sync.** Needs a Linear-user to Lor-user mapping. Email is
  the likely key; unverified whether an `actor=app` token can read member
  emails or private-team projects.
- **Status sync.** Lor has three statuses, Linear has six plus archive and
  trash. Lor has no unarchive, so a reopened Linear project cannot be
  mirrored.
- **Project updates ingestion.** Needs the Project updates subscription and a
  memory design.

## Open questions

1. One Lor project per Linear project, or can several share one?
2. Should completing or canceling a Linear project archive the Lor project,
   prompt the creator, or do nothing?
3. Should Linear members seed Lor project membership once at link time, sync
   continuously, or never? What happens to Linear members who are not in the
   Lor workspace?
4. Should a linked project's description and target date mirror Linear
   read-only, or stay editable in Lor?
5. Audience for projects created from Linear during setup: workspace (open,
   better for day-one memory) or members (today's create-dialog default)?

## Steps (draft)

1. Schema columns, Linear projects list endpoint, create and PATCH
   validation, picker in the create-project dialog. **db:push owed.**
2. Lor scoping in run context and `create_linear_issue` `projectId`;
   "Create projects from Linear" under the onboarding Linear card.
3. Optional per-project issue feed in the Linear webhook handler.
