# Onboarding for small tech startups

> Status: in flight. Written 2026-10-07 from a full code audit; Step 1 built
> 2026-10-07. Execute step by step: tick each step's checkboxes as it lands,
> and record any departure from this plan in "Deviations" at the bottom.
> Decisions marked **Locked** were agreed with Jacob on 2026-10-07; the rest
> are recommendations. Linear-linked projects were split out to
> `reference/planned/linear-projects.md`.

## Why

The current first run was built for a Discord-style community app. The audit
(14 read-only research passes over web, api, realtime, worker, mobile, db,
auth, connectors, lor) found:

- Sign-up lands on `/dms` with an undismissable modal on top
  (`apps/web/src/routes/_authenticated.tsx:169-192`,
  `apps/web/src/components/onboarding/onboarding-dialog.tsx`). Copy says
  "Start your own community". The create step asks for a slug behind a fake
  `lor.chat/` prefix that is not a real URL.
- Seeded channels are `#general`, `#introductions`, `#rules`, and a
  `Community` category with `#help` and `#off-topic`
  (`packages/auth/src/lib/auth.ts:26-88`). No topics, no voice channel, no
  message. The first screen is the empty "Welcome to #general!" state.
- Lor is never introduced. Nothing prompts the user to connect GitHub or
  Linear, so the first `@Lor` question hits an empty brain and answers "I
  don't have it in memory yet". Lor's prompt has no workspace name, no
  description, and no channel topic (`packages/lor/src/index.ts:1855-1917`).
- Invite accept lands on the workspace root, which shows "Select a channel to
  start chatting" (`apps/web/src/routes/invite/$code.tsx:86-89`).
  `user.onboardingCompleted` is never set for joiners, and is written with
  Drizzle, which bypasses better-auth's Redis session cache.
- Teammates who sign up without an invite link have no way to find their
  company's workspace, so each one creates their own.
- No hint, coachmark, or dismissal state exists anywhere (web or mobile). No
  analytics SDK exists either.
- The unique slug is user-typed and collides across companies. It is
  load-bearing in 82 API paths, 37 web route templates, OAuth state, GitHub
  install state, billing URLs, and a push payload.
- Permissions are inconsistent: plain members cannot create channels, but any
  member can connect or disconnect GitHub and Linear (only Notion checks
  `connector:manage`, `apps/api/src/routes/v1/integrations/handlers.ts:770`).
- With billing on, a solo workspace starts at zero credits and Lor refuses to
  answer. The 2,000 promo credits arrive only when the first invite is
  accepted (`packages/billing/src/promo.ts`), while www promises them at
  creation. Billing is off in prod today on purpose (Autumn not connected
  while testing).

## Who onboards, and what "successful" means

Three people arrive differently:

- **Creator** (founder or CTO). Signs up cold, names the workspace, is the
  only member for the first hour. Owner role.
- **Invited joiner** (engineer, designer). Arrives through an invite link into
  a workspace that already has channels and probably connectors. Member role.
- **Domain joiner.** Signs up with a company email without an invite, and the
  company's workspace already exists. Member role.

The product promise is grounded answers and actions over the team's own code,
issues, and conversations. For a brand-new workspace the conversation corpus
is empty, so the only way Lor can be impressive in the first session is
through connectors and company context. Order of leverage for a small tech
startup:

1. **GitHub.** Universal for the target segment. Pays off instantly with no
   history: `search_github`, `fetch_github`, `investigate_code`,
   `propose_code_change` all work live against the installation.
2. **Linear.** The issue tracker for most startups in this segment.
   `search_linear`, `list_linear_issues`, `create_linear_issue` work live.
3. **Notion** later. Read-only, page-picker scoped, lower day-one value.
4. **Invite the team.** Lor's memory grows from conversation, and the first
   teammate is what turns a trial into a workspace.

So the creator's first session is: create workspace, connect GitHub, connect
Linear, invite the team, ask Lor one question that it can answer well. A
joiner's first session is: land in `#general`, read Lor's intro, learn the
three things that differ from Slack (mention Lor, voice is transcribed, Lor
shows its work).

## The flow

### Creator

1. `/signup` and email verification stay as they are.
2. `/onboarding` is a full page (no sidebar), not a modal over `/dms`. If
   workspaces exist for the user's verified email domain, "Your team is
   already on Lor" join cards come first (see "Join by email domain"). Below
   them: **Create a workspace** and **Join with an invite link**.
3. Create asks for **Website**, **Name**, and an optional one-line **What are
   you building?** (`workspace.description`). No slug field. When the
   verified email is on a company domain, Website is prefilled with it, and
   Name and description are prefilled from the site (see "Company prefill").
   The site's icon shows inside the Website field as soon as it resolves,
   and again as the user types a different site. Every field stays editable.
4. The server creates the workspace with a generated key, seeds the startup
   template, adds Lor, posts Lor's intro in `#general`, sets the site icon as
   the workspace icon when it is large enough, and returns the first channel
   id. The client sets the active organization and goes to `/{key}/setup`.
5. `/{key}/setup` renders in the main pane with the sidebar visible, so the
   creator sees the seeded channels while finishing setup. It is a checklist
   whose state is derived from data, not stored step indexes:
   - **Connect GitHub.** One sentence on what Lor can do once connected.
     Connect button opens the GitHub App install. Done state shows the
     account and repo count.
   - **Connect Linear.** Same shape. Done state shows the Linear org.
   - **Invite your team.** Inline invite link with Copy, and the "Anyone with
     an @acme.com email can join" toggle when the domain qualifies. Done
     state when a human member exists.
   - **Ask Lor.** Two or three suggested questions that depend on what is
     connected. Clicking one opens `#engineering` with the question prefilled
     in the composer; the user presses send.
   - **Finish** sets `workspace.setupCompletedAt` and opens `#general`.
     **Do this later** does the same. Setup stays reachable from the
     workspace menu until finished.
6. Setup is visible to anyone who holds `connector:manage`: the owner,
   admins, and custom roles with that grant. A cofounder who joins as admin
   before setup is finished can connect GitHub themselves.
7. The OAuth and App-install callbacks keep navigating to the workspace root.
   The root route sends a `connector:manage` holder with unfinished setup to
   `/setup`, carrying the `connector` search param so the matching card shows
   its done state. On desktop the callback runs in the system browser, and
   the setup page refetches integrations when the app window regains focus
   (the existing `subscribeAppFocus` pattern).

### Joiners

1. Invite: `/invite/{code}` → sign up or sign in with `redirect` preserved
   (already works) → Accept.
2. Domain: sign up → `/onboarding` shows the join card → Join.
3. Both land in the workspace's first channel (`#general`), not the root.
   Lor's intro message is the first thing in the feed.
4. Orientation comes from the hints (below), not a wizard. Joiners without
   `connector:manage` never see `/setup`.

### Mobile

- `/onboarding` mirrors web: join cards, Website with icon, Name,
  description, no slug. Lands on the channel list as today.
- `connector:manage` holders with unfinished setup see one `StatePanel`:
  "Finish setup on the web: connect GitHub and Linear and invite your team."
  Connector OAuth stays web-only (`reference/mobile-parity-todo.md`).
- Hints `lor_intro` and `voice_intro` render on mobile through the same API.
- Pending invite code moves from module memory to SecureStore so a cold start
  after email verification still lands on the invite.

## Company prefill

**Locked.** Look up the company, never the person.

- **Source.** The verified email domain. Sign-up requires email verification
  before a session exists, so the domain on the session is trustworthy. Free
  email domains (Gmail, Outlook, iCloud, Proton, Yahoo and similar, from a
  vendored list) get no prefill.
- **Endpoint.** `GET /v1/onboarding/site?domain=` (session auth, rate
  limited, cached per domain in Redis for 24 hours) returns
  `{ domain, name, description, iconUrl }`. The page calls it on load with
  the email domain, and again, debounced, when the user types a different
  site.
- **Name and description.** Exa `getContents` on the homepage (the existing
  `fetchWebPage` in `packages/lor/src/providers/exa.ts`), then the small
  model writes a company name and one line of at most 120 characters. When
  `EXA_API_KEY` is unset, the endpoint returns only the icon.
- **Icon.** Google's public favicon service
  (`https://www.google.com/s2/favicons?domain=…&sz=…`), the same source as
  the unlumen favicon-search component Jacob pointed to. The client renders
  it straight into the Website field, debounced 300ms, swapping it in only
  after it loads. The desktop CSP already allows `img-src https:`. Tradeoff:
  the typed domain goes to Google, acceptable for a public company website.
- **Workspace icon.** On create, if the user kept the website, the server
  fetches the same Google URL at a larger size (a fixed host, so no
  user-controlled fetch), and only if the image is at least 64px stores it in
  R2 under `workspace-icons/{id}/` as `workspace.logo`. Smaller icons fall
  back to today's letter avatar.
- **Where it lands.** The form fields, then `workspace.website`,
  `workspace.description`, and `workspace.logo`, all editable in General.
  Never the memory brain: marketing copy is often aspirational and goes
  stale, and brain pages are permanent.
- **Lor context.** The initial message gains the website next to the name and
  description (see "Lor cold start").

**Person research: rejected.** No Exa people search, no profile scraping, for
creators or joiners. Lor answers about code, issues and team conversations,
so a person's history rarely changes an answer. Lor's memory is visible to
the whole workspace and kept forever, so teammates would read a profile
compiled about a colleague without their knowledge, which conflicts with the
no-surveillance principle. Name-based people search misidentifies often
enough to plant false facts that Lor would cite. Data collected about a
person from third-party sources also brings notice duties (GDPR Article 14).

## Join by email domain

**Locked to build.** A workspace can let anyone with a verified email on its
domain join without an invite.

- **Storage.** `workspace.joinDomain text`, nullable, indexed. Not unique: two
  teams at one company may each have a workspace.
- **Who can set it.** Admins, in General settings and in the setup invite
  card. The domain must equal the acting admin's own verified email domain,
  and must not be a free email domain. This stops anyone from claiming a
  domain they do not belong to.
- **Default. Locked.** The setup toggle starts on when the creator's domain
  qualifies, and the owner can turn it off. Small startups gain more
  from teammates finding the workspace than they risk from strangers on their
  own domain.
- **Discovery.** `GET /v1/workspaces/joinable` (session auth) returns
  workspaces whose `joinDomain` equals the caller's verified email domain and
  that the caller is not in: `{ key, name, logo, humanMemberCount }`.
- **Join.** `POST /v1/workspaces/{key}/join` (session auth; the caller is not
  a member yet, so not workspace auth) re-checks the domain, inserts a
  `member` through a helper extracted from `acceptInvite` (avatar color,
  `syncSeats`), and returns the first channel id. The client emits
  `workspace:member:joined`.
- **Surfaces.** The `/onboarding` join cards. The workspace switcher's
  "Create workspace" navigates to `/onboarding` instead of opening
  `CreateWorkspaceDialog`, so existing users can find team workspaces too,
  and the duplicated create logic goes away.
- **Offboarding.** A person who leaves the company keeps access until an
  admin removes them, the same as invite joiners. Domain join never removes
  anyone.

## Default workspace template

**Locked.** Replace the community set with a startup set. All top-level, no
category.

| Channel | Type | Topic |
|---|---|---|
| `#general` | text | Team-wide updates and discussion. |
| `#engineering` | text | Code, pull requests, and technical decisions. |
| `standup` | voice | Daily sync. Lor takes notes. |
| `#random` | text | Everything else. |

Why this set:

- Small teams start with one place for everyone and one place for building.
  Teams add `#product` or `#design` when they need them, and members can now
  create channels.
- One voice channel named for a concrete ritual beats a generic "Lounge". The
  standup is the first place voice memory earns its keep.
- `#random` is expected and cheap. `#introductions`, `#rules`, `#help`,
  `#off-topic` are community-forum concepts and go.
- Topics are seeded because Lor will read them (see "Lor cold start"). Today
  `channel.topic` is never read by Lor.

**No connector routing by default. Locked.** GitHub and Linear activity posts
nowhere until someone turns it on in the connector's Events settings, and
setup does not ask. Lor does not need these posts to know things: its GitHub
and Linear tools query live. On day one nobody trusts a new tool enough to
move their GitHub notifications into it, and a feed in `#engineering` would
put noise where people talk. A better later moment is a Lor change proposal
(the `set_trigger` operation already exists) when Lor notices the team
pasting PR links. That belongs to the self-configuration work, not
onboarding.

Lor's intro, posted once in `#general` as `LOR_USER_ID`, `type: default`,
`silent`, `excludedFromMemory: true`:

> Hi, I'm Lor. Mention me with @Lor in any channel to ask about your code,
> your issues, or anything this team has discussed. I show my work and cite
> what I used.

Nothing else is posted. No channel events are posted for seeded channels.

The template lives in `packages/auth/src/lib/workspace-template.ts` and is
called from the `afterCreateOrganization` hook. Each hook step runs
independently, so a channel-seed failure no longer skips Lor membership, the
brain seed, or the billing customer. Existing workspaces keep their channels.

## Workspace key

better-auth 1.4.18 owns workspace creation and requires a non-empty, unique
`slug` before any hook runs (`dist/plugins/organization/routes/crud-org.mjs:65`).
The column must stay. What changes is who chooses it and what it looks like.

**Locked: an opaque key stored in the existing `slug` column.** Ten lowercase
base36 characters (for example `f3e1g2cab7`), generated server-side, never
shown in a form. Collisions are not retried: the key space is about 3.6 ×
10^15, and better-auth rejects a duplicate before inserting. Every
`workspaceSlug` route param, the 82 API paths, OAuth state, and billing URLs
keep working unchanged.

Why opaque over a name prefix like `acme-7k3qd`:

- It never goes stale. The key cannot change after creation (MCP OAuth
  redirect URIs and bookmarks depend on it), so a name prefix would show the
  old name forever after a rename.
- No name edge cases. `sluggify` drops everything outside a–z and 0–9, so a
  name like "株式会社" gives an empty prefix.
- It matches chat apps, which put opaque ids in app URLs that nobody types.
- The cost is unreadable URLs in history and support chats. The tab title and
  sidebar still show the name.

Creation moves behind a first-party route so the key is minted on the server:

- `POST /v1/workspaces` `{ name, description?, website? }` calls
  `auth.api.createOrganization({ body: { name, slug: key, userId } })` with no
  headers, then writes `description` and the normalized `website` itself.
  better-auth treats a session-less call with `userId` as a system action
  (`crud-org.mjs:56-64`): hooks run, the creator member row is inserted with
  role `owner`, and `setActiveOrganization` is skipped (`crud-org.mjs:163`).
  The client calls `organization.setActive` afterwards, which web already
  does in the `$workspaceSlug` layout and mobile does in `reloadWorkspaces`.
- `organization({ allowUserToCreateOrganization: false })` blocks direct
  client calls to `/api/auth/organization/create`. It lands in Step 3, when
  web and mobile switch to the new route.
- `organizationHooks.beforeUpdateOrganization` rejects any `slug` change so
  the still-mounted `/api/auth/organization/update` cannot rename keys.

**Existing workspaces are rekeyed. Locked.** There are no real users yet, so
a one-off script rewrites every `workspace.slug` in dev and prod to a new
key. Known effects, all accepted:

- Bookmarks and old links break. Users land on `/dms` once, because the
  `lor:last-workspace-slug` localStorage key no longer matches.
- OAuth MCP servers must be reconnected: their registered redirect URI
  embeds the old key.
- In-flight OAuth or GitHub installs (10-minute window) fail.

Later cleanup, not part of this work: rename `workspaceSlug` identifiers to
`workspaceKey`. Cosmetic.

## Hints

Principles:

- A hint is one sentence anchored to the thing it explains. No backdrop, no
  focus trap, no step counter, no tour. It never blocks typing.
- One hint on screen at a time. A short priority list decides which shows.
- A hint goes away when the user does the thing, or presses Got it. Outside
  clicks do not dismiss it (a missed hint would be lost forever).
- Dismissal is per user, synced across devices. `thread_read_state` already
  replaced a client-local dismiss set for this reason, and the desktop app's
  `tauri://localhost` origin has its own localStorage.
- Workspace facts (GitHub connected, LOR.md written, teammates present) are
  derived from rows the client already loads. Only "this user has seen this"
  needs storage.

Storage: table `hint_dismissal` (`user_id` FK cascade, `key` pg enum
`hint_key`, `dismissed_at`), unique `(user_id, key)`. Scope is per user, not
per workspace: hints teach the product, and a user who learned `@Lor` in one
workspace knows it in the next.

API, following `channel-mutes`: `GET /v1/hints` returns dismissed keys;
`PUT /v1/hints/{key}` upserts and emits `hint:dismissed { key }` to
`userRoom`. Web `useHints()` wraps the query, an optimistic mutation, and the
socket invalidation. Mobile mirrors it.

Primitive: `HintPopover` in `apps/web/src/components/hints/`, built on the
Base UI `Popover` root in controlled mode with `anchor` and `modal={false}`
(no scroll lock, per the desktop click-lag episode). Compact body, one line of
text, a Got it button. Appears 600ms after its anchor mounts, 200ms in and
150ms out on `EASE_OUT`, no overshoot. Honors `MotionConfig reducedMotion`.

The set:

| key | Shows when | Anchor | Copy | Also dismissed by | Mobile |
|---|---|---|---|---|---|
| `channels_intro` | First visit to a workspace sidebar where the user can create channels | The sidebar `+` Create button | Your starting channels. Rename, reorder, or add channels and projects here. | Opening the `+` menu | no |
| `lor_intro` | First text channel visit, user has never mentioned Lor | Composer | Placeholder becomes "Message #general, or @Lor to ask a question". Popover: Mention @Lor to ask about code, issues, or past conversations. | Sending a message that mentions Lor | yes |
| `lor_reply` | First Lor reply to one of this user's messages finishes streaming | The reply's tool trail row | Lor shows its work. Open the trail to see what it checked. Reply in the thread to continue. | Expanding the trail | yes |
| `voice_intro` | First voice channel lobby visit | The Start call button in `CallHero` | Calls are transcribed for the people in them. Say "Lor" during a call to ask it something. Lor writes notes when the call ends. | Joining a call | yes |
| `connectors_intro` | Connectors tab opens with nothing connected, viewer holds `connector:manage` | The GitHub row | Connect GitHub first. Lor reads pull requests, issues, and code through it. | Connecting anything | no (no connectors screen) |

Not hints: the Approvals card already explains itself; settings tabs are
self-describing; invites are a setup card.

Why not channel events for hints: event rows are channel-wide, permanent, and
have no per-user state (`reference/channel-events.md`). Why not the empty
state: channels created through the API start with a `channel_created` event
row, so `EmptyState` never renders there.

## Lor cold start

Three additions so the first answer in an empty workspace is still good. All
are context (data), not prompt rules, and none put per-request values in the
cached system prompt:

- The initial user message gains the workspace name, website, and
  `description`, next to "Active conversation in #channel"
  (`packages/lor/src/initial-message.ts:81-150`).
- The initial message gains the channel topic. `buildRunContext` selects only
  `channel.name` today (`packages/lor/src/index.ts:1896-1904`).
- One static sentence in `SYSTEM_PROMPT_TAIL`: connectors that are not listed
  above are not connected, and a workspace admin can connect them in Settings
  → Connectors. Static text keeps the prompt cache stable and lets Lor answer
  "can you see our GitHub?" correctly before setup is done.

## Permissions

**Locked.** Two changes to the static roles and one new rule.

- **Members get `channel: ["create"]`.** Small teams expect everyone to make
  channels, and projects reuse the same permission. Admins can still remove it
  with a custom role.
- **Creators can edit their own channel.** New column `channel.createdById`
  (FK user, `set null`; null for seeded and existing channels, which stay
  admin-only). In `updateChannel`, a caller who created the channel may change
  `name` and `topic` without `channel:update`. Agent profile and slowmode
  changes still need their normal permissions. Delete stays with
  `channel:delete`, because a hard delete removes everyone's messages. This
  mirrors projects, where the creator or `channel:update` can manage.
- **Connectors are admin-only.** `connector: ["manage"]` becomes the first
  statement of every connect, disconnect, trigger, and repo-config handler.
  A connector is a workspace-wide credential: once GitHub is connected, every
  member can ask Lor about every repo in the installation. Any member can
  disconnect it for everyone today, and any member can set up Act triggers
  that spend credits.

## Decisions

| Topic | Decision | Status |
|---|---|---|
| Workspace key | Opaque 10-char lowercase base36 key in the `slug` column; no user input; routes unchanged | Locked |
| Existing workspaces | One-off script rekeys every workspace in dev and prod; breakage accepted (no real users) | Locked |
| Creation path | First-party `POST /v1/workspaces`; client creation disabled in better-auth; slug changes rejected | Recommended |
| Workspace fields | Add `description`, `website`, `joinDomain`, `setupCompletedAt`; description and website editable in General and injected into Lor's run context | Recommended |
| Company prefill | Website, name and one-line description from the verified email domain; user confirms; never written to memory | Locked |
| Person research | None, for creators or joiners | Locked |
| Site icon | Shown in the Website field; becomes the workspace icon when it declares at least 64px | Locked |
| Join by email domain | Build it; admins set the domain they belong to; free email domains excluded | Locked |
| Domain join default | Setup toggle starts on when the creator's domain qualifies | Locked |
| Default channels | `#general`, `#engineering`, `standup` (voice), `#random`, with topics | Locked |
| Connector routing | Off by default; setup does not ask; Lor change proposals can suggest it later | Locked |
| Lor intro message | One static Lor message in `#general`, excluded from memory | Recommended |
| Setup state | `workspace.setupCompletedAt`; card states derived from rows | Recommended |
| Setup visibility | Anyone with `connector:manage` | Locked |
| Hint storage | `hint_dismissal` per user, synced via `hint:dismissed` | Recommended |
| Hint scope | Per user globally | Recommended |
| `user.onboardingCompleted` | Stop reading it; gate on "zero workspaces"; drop the column in a later cleanup | Recommended |
| Member channel creation | Members get `channel:create`; creators edit name and topic of their own channels; delete stays admin | Locked |
| Connector permissions | `connector:manage` enforced on every connector handler | Locked |
| Promo credits | Grant at workspace creation when billing is on. Interim: launch pricing is a separate discussion, and billing is off in prod until then | Locked |
| Linear-linked projects | Separate design and thread: `reference/planned/linear-projects.md` | Locked |
| Analytics | None now; measure the funnel from `setupCompletedAt`, connections, and invites in the DB | Recommended |

## Steps

Each step is one reviewable chunk (about 300 to 400 lines), leaves `check`
and `check-types` green, and is committed by Jacob before the next starts.
Schema edits are listed; Jacob runs `db:push`.

### Step 1: workspace key, create route, new columns, rekey script

[x] built 2026-10-07 · [x] committed · [x] db:push dev · [x] rekey dev ·
[ ] db:push prod · [ ] rekey prod

- `packages/utils/src/short-code.ts` (new): `randomCode(length, alphabet)`
  with rejection sampling, `workspaceKey()` (10 chars base36). The invite
  code generator in `apps/api/src/routes/v1/invites/handlers.ts` moved onto
  it, which also removes its modulo bias.
- `packages/utils/src/domain.ts` (new): `normalizeDomain(input)` turns a
  typed website into a bare lowercase domain without `www.`, or null.
- `packages/db/src/schemas/workspaces.ts`: add `description text`,
  `website text`, `joinDomain text` (indexed), `setupCompletedAt timestamp`.
  Comment on `slug`: server-generated key. **db:push owed.**
- `packages/db/src/scripts/rekey-workspaces.ts` (new, one-off): rewrites
  every `workspace.slug` to `workspaceKey()` in one transaction, marks every
  existing workspace as set up, prints old and new keys, and lists OAuth MCP
  servers to reconnect. `--dry-run` prints without writing. Run after
  db:push, against dev, then prod. Old slugs keep working until then.
- `packages/auth/src/lib/auth.ts`: organization `additionalFields`
  `description`, `website`, `joinDomain`, `setupCompletedAt`, all
  `input: false, returned: true`, so `organization.list()` carries them to
  both clients and only our routes write them; `beforeUpdateOrganization`
  rejects slug changes.
- `apps/api/src/routes/v1/workspaces/{routes,schema,handlers,index}.ts`:
  `POST /workspaces` (session auth) mints the key, calls
  `auth.api.createOrganization` as a system action, writes description and
  website, returns `{ workspace, firstChannelId }`.
  `POST /workspaces/{key}/setup/complete` (first statement asserts
  `connector:manage`) sets `setupCompletedAt` once. PATCH accepts
  `description` and `website`.

### Step 2: startup template, Lor intro, Lor context

[x] built 2026-10-07 · [x] committed

- `packages/auth/src/lib/workspace-template.ts` (new): the four channels with
  topics and positions, and the Lor intro message row in `#general`, in one
  transaction. Exported `seedWorkspaceTemplate(workspaceId)`.
- `packages/auth/src/lib/auth.ts`: `afterCreateOrganization` calls the
  template; the early `return` is gone, so a seed failure no longer skips
  Lor membership, the brain seed, or the billing customer;
  `defaultWorkspaceChannels` and `seedDefaultWorkspaceChannels` deleted.
- `packages/db/src/schemas/agent-runs.ts`: `AgentRunContext` gains optional
  `channelTopic` and `workspace { name, website?, description? }`.
- `packages/lor/src/index.ts`: `buildRunContext` snapshots the channel topic
  and the workspace's name, website and description; `SYSTEM_PROMPT_TAIL`
  gains the static "not connected, ask an admin" bullet.
- `packages/lor/src/initial-message.ts`: renders a `Workspace:` line at the
  top of the run's first message and the topic after "Active conversation in
  #channel".
- `apps/api/scripts/seed-channels.ts`: deleted (seeded the old community
  set; nothing referenced it).

### Step 3: web `/onboarding` page and landing changes

[x] built 2026-10-07 · [x] committed

- `apps/web/src/routes/onboarding.tsx` (new, top-level like
  `invite/$code.tsx`): session guard, choose / create / join steps, Create
  asks for website, name and description, calls `POST /v1/workspaces`, and
  lands in the first channel (Step 5 switches this to `/{key}/setup`).
  Footer: "Back to Lor" for users who have a workspace, "Signed in as … Sign
  out" for users who don't.
- `apps/web/src/routes/_authenticated.tsx`: `OnboardingDialog` and its
  workspaces query removed. `_authenticated/index.tsx`: zero workspaces →
  `/onboarding`.
- `apps/web/src/routes/_authenticated/$workspaceSlug/index.tsx`: with no
  remembered channel, redirects to the first text channel instead of "Select
  a channel". Covers invite accept, "Already a member", and new devices.
- `apps/web/src/routes/_authenticated/$workspaceSlug.tsx`: a workspace URL
  this account isn't in sends a zero-workspace user to `/onboarding`;
  otherwise "Workspace not found" offers a link to their first workspace.
- `apps/web/src/components/sidebar/channel-panel/user-bar.tsx`: sign-out
  clears the query cache and goes to `/login` with no return path. Before,
  the next account to sign up in the tab inherited the previous account's
  channel URL through the login redirect, and could briefly see its cached
  queries. The old modal had hidden the resulting "Workspace not found".
- `apps/web/src/lib/workspace-channels-query.ts` (new):
  `workspaceChannelsQueryOptions` (shared with `ChannelList`) and
  `firstTextChannelId`.
- `packages/auth/src/lib/auth.ts`: `allowUserToCreateOrganization: false`.
- `apps/web/src/components/sidebar/workspace-sidebar.tsx`: "Create
  workspace" navigates to `/onboarding`. `create-workspace-dialog.tsx`
  deleted.
- Deleted `apps/web/src/components/onboarding/onboarding-dialog.tsx`,
  `apps/web/public/lor-onboarding.png`, `apps/web/public/lor-onboarding2.png`.
- `apps/mobile/src/app/onboarding.tsx`: website, name and description, no
  slug, `POST /v1/workspaces`. `apps/mobile/src/app/(tabs)/_layout.tsx`:
  zero workspaces → onboarding. `apps/mobile/src/lib/invites.ts`: pending
  invite code in SecureStore, expires after 24 hours.

### Step 4: company prefill and site icon

[x] part 1 built and committed 2026-10-07 (favicon field, email-domain
prefill, web and mobile onboarding redesign) · [x] part 2 built 2026-10-08
(site lookup, workspace icon) · [ ] part 2 committed

Part 1, built:

- `packages/utils/src/domain.ts`: `isFreeEmailDomain` and
  `companyEmailDomain` with a vendored list of personal mailbox providers.
  Kept in `domain.ts` because `@repo/utils` relative imports need `.js`
  extensions under node16 resolution, which Metro may not map to `.ts`.
- `apps/web/src/components/onboarding/website-input.tsx` (new): `InputGroup`
  with the favicon (or a globe) at the start, 180ms ease-out fade/scale/blur
  swap, no spring overshoot.
- `apps/mobile/src/components/website-input.tsx` (new): same field with
  `expo-image` `Image.prefetch` and Reanimated fades.
- `apps/web/src/routes/onboarding.tsx`, `apps/mobile/src/app/onboarding.tsx`:
  Website prefilled from a company email; focus starts on Name when it is.

Part 2, built:

- `packages/lor/src/company-site.ts` (new): `lookupCompanySite(domain)`:
  Exa page text (first 4,000 chars) plus a small-model call for name and one
  line. Returns null when Exa or the model failed.
- `apps/api/src/routes/v1/onboarding/*` (new): `GET /v1/onboarding/site`,
  session auth, `siteLookupRateLimit` (10/min per user), Redis cache per
  domain for 24h. Only real answers are cached; failures return empty fields.
- `apps/api/src/lib/site-icon.ts` (new): fetches the Google favicon at
  `sz=128`, reads PNG/JPEG dimensions by hand (no sharp in the API), keeps it
  when at least 64px, stores it in R2 under `workspace-icons/{id}/`.
  `createWorkspace` starts the fetch before `createOrganization`, so it
  overlaps the template seed.
- Web `components/onboarding/{use-company-site.ts,prefill-input.tsx}` and
  mobile `hooks/use-company-site.ts` + `components/prefill-input.tsx`: the
  lookup starts at mount when the website is known (600ms debounce when
  typed). Name and description derive from the lookup until the user types
  in them; a new lookup can replace untouched values. While it runs, the
  empty fields show a shimmering "Reading acme.com…"; filled text blurs in
  (web) or fades in (mobile); the description hint reads "Filled from …".

### Step 5: web setup page

[x] built 2026-10-08 · [ ] committed · [ ] dev GitHub App created

As built: the route is `setup.tsx`, the rows live in
`components/setup/setup-steps.tsx` (`ConnectStep`, `InviteStep`,
`AskLorSuggestions`), and access comes from `hooks/use-workspace-setup.ts`
(also used by the root redirect and the sidebar item). Web onboarding now
lands the creator on `/setup`.

- `apps/web/src/routes/_authenticated/$workspaceSlug/setup.tsx` (new) and
  `apps/web/src/components/setup/*`: `ConnectCard` (GitHub, Linear) over
  `["integrations", key]` with focus refetch, `InviteCard` reusing the
  invite-link mutation from `create-invite-dialog.tsx`, `AskLorCard`, Finish
  and Do this later → `POST /workspaces/{key}/setup/complete`. Users without
  `connector:manage` are sent to the first channel.
- `apps/web/src/routes/_authenticated/$workspaceSlug/index.tsx`: a
  `connector:manage` holder with null `setupCompletedAt` → `/setup`,
  forwarding `connector` (today it drops that param, so the OAuth return lands
  on the connectors list instead of the detail).
- `apps/web/src/routes/_authenticated/$workspaceSlug/$channelId.tsx` and
  `message-input.tsx`: a `draft` search param feeds `composerDraft` on the
  channel route (only the thread panel supports it today), so AskLor can
  prefill `@Lor ...` without sending.
- `apps/web/src/components/sidebar/workspace-sidebar.tsx`: "Finish setup"
  menu item while unfinished.

### Step 6: permissions and GitHub connect

[x] 6a built 2026-10-08 (member `channel:create`, `channel.creatorId`,
creator edit) · [x] 6a committed · [ ] db:push · [x] 6b built 2026-10-08
(connector `manage` gates, revoked-row guard, GitHub connect intent) ·
[ ] 6b committed

- `packages/auth/src/lib/permissions.ts`: `member` gains
  `channel: ["create"]`. Web `canCreateChannels` follows automatically.
- `packages/db/src/schemas/channels.ts`: `createdById` column.
  **db:push owed.**
- `apps/api/src/routes/v1/channels/handlers.ts`: `createChannel` sets
  `createdById` and `max(position)+1`; `updateChannel` allows the creator to
  change `name` and `topic`, and asserts `channel:update` for everything
  else.
- `apps/web/src/components/sidebar/channel-panel/channel-list.tsx` and
  `edit-channel-dialog.tsx`: Edit Channel shows for the creator, with the
  Overview tab only.
- `apps/api/src/routes/v1/integrations/handlers.ts`: `assertWorkspaceAuthority`
  `connector: ["manage"]` as the first statement of connect, disconnect,
  `updateIntegration`, and `updateGithubRepoConfig`; `canManage` in the list
  response reflects it. Web `connectBlocker` already renders "Admin only".
- The 409 cross-workspace guard ignores `revoked` rows (today a replaced or
  suspended row in an old test workspace blocks the external id forever).
- GitHub connect stops depending on GitHub returning `state`. Disconnecting
  in Lor does not uninstall the App on GitHub, so a reconnect opens the
  existing installation's configure page. With Redirect on update, GitHub
  then returns to the Setup URL with `installation_id`, and third-party
  reports say without `state`. Today `setup.tsx` bails with "Missing GitHub
  install details". Fix: the Connect button calls a POST that records a
  connect intent (Redis, user id → workspace id, 15 minutes) and returns the
  install URL with a signed state. `setup.tsx` posts `installationId` and
  any `state` to a session-scoped `POST /v1/integrations/github/setup`. The
  server picks the workspace from the signed state, else from the intent,
  checks membership and `connector:manage`, connects, and returns the
  workspace key for navigation. This also replaces today's raw, unsigned
  slug in `state`.

### Step 7: join by email domain

[x] built 2026-10-08 · [ ] committed

As built: the toggle is `components/workspace/domain-join-switch.tsx`, shown
in the setup checklist group and in General settings. `createWorkspace` sets
`joinDomain` to the creator's verified company domain, which is what "the
toggle starts on" means in data.

- `apps/api/src/lib/workspace-membership.ts` (new): `addWorkspaceMember`
  extracted from `acceptInvite` (avatar color, insert, `syncSeats`). Invite
  accept switches to it.
- `apps/api/src/routes/v1/workspaces/*`: `GET /workspaces/joinable`,
  `POST /workspaces/{key}/join`, PATCH accepts `joinDomain` (admins; must
  equal the caller's verified email domain; not a free email domain; null
  turns it off).
- `apps/web/src/routes/onboarding.tsx` and `apps/mobile/src/app/onboarding.tsx`:
  join cards above Create.
- `apps/web/src/components/setup/invite-card.tsx` and the General section of
  `workspace-settings-dialog.tsx`: the domain toggle.

### Step 8: hints, part 1

[x] built 2026-10-08 · [ ] committed · [ ] db:push

As built: `components/hints/hints-provider.tsx` (`HintsProvider` in the
`_authenticated` layout, `useHint(key, eligible)`, the priority list) and
`components/hints/hint-popover.tsx`. The enum already holds all five keys,
so Step 9 needs no second db:push.

- `packages/db/src/schemas/hint-dismissals.ts` (new): `hint_key` enum,
  `hint_dismissal` table. **db:push owed.**
- `apps/api/src/routes/v1/hints/*` (new): `GET /hints`, `PUT /hints/{key}`,
  emit `hint:dismissed` to `userRoom` through the redis emitter.
- `packages/realtime-types/src/events.ts`: `hint:dismissed`.
- `apps/web/src/hooks/use-hints.ts`, `apps/web/src/components/hints/hint-popover.tsx`,
  a small `useHintSlot` that enforces one visible hint.
- Mount `channels_intro` (`workspace-sidebar.tsx` `+` button) and `lor_intro`
  (`message-input.tsx` placeholder and popover; dismissed in the send path
  when the stored markdown contains `<@LOR_USER_ID>`).

### Step 9: hints, part 2 and mobile

[x] built 2026-10-08 · [ ] committed

As built: web `lor_reply` lives in `lor-activity.tsx`, `voice_intro` in
`call-hero.tsx`, `connectors_intro` in `ConnectorList`. Mobile has
`hooks/use-hints.ts`, an inline `components/hint-card.tsx`, and
`components/finish-setup-card.tsx` on the Channels tab.

- `lor_reply` in `apps/web/src/components/chat/message-item.tsx` (anchor: the
  trail summary row; condition: `authorId === LOR_USER_ID`, trigger message by
  the viewer, `streaming` false).
- `voice_intro` in `apps/web/src/components/voice/call-hero.tsx`.
- `connectors_intro` in `apps/web/src/components/workspace/connectors-section.tsx`
  (`ConnectorList`, GitHub row, only when `canManage`).
- Mobile: `apps/mobile/src/hooks/use-hints.ts`, `lor_intro` in
  `message-composer.tsx`, `voice_intro` in `components/voice/voice-lobby.tsx`,
  "Finish setup on the web" panel in `(tabs)/index.tsx`.

### Step 10: invite management, billing, desktop

[x] built 2026-10-08 · [ ] committed

As built: "Manage invites" sits beside Invite in the Members heading for
anyone with `workspaceMember:kick` (the list endpoint's gate).
`grantFirstInvitePromo` became `grantSignupPromo`, called after
`ensureCustomer` in `afterCreateOrganization`; `afterWorkspaceJoin` only
syncs seats now. `apps/web/src/lib/web-origin.ts` backs invite links and the
sign-up, sign-in (verification resend), check-email and forgot-password
callbacks; login was added because its 403 path resends the verification
email with a callback too.

- Mount `ManageInvitesDialog` in the Members tab (`members-section.tsx`); it
  exists but is imported nowhere.
- `packages/auth/src/lib/auth.ts`: remove the Drizzle `onboardingCompleted`
  write; mark the field `input: false`. Column drop is a later cleanup.
- `packages/billing/src/promo.ts` and `auth.ts`: grant the promo in
  `afterCreateOrganization` when billing is on; `acceptInvite` stops calling
  it. No effect in prod until Autumn is connected.
- Desktop minimal fix: in Tauri, `signup.tsx`, `check-email.tsx`,
  `forgot-password.tsx` build `callbackURL`/`redirectTo` from
  `NEXT_PUBLIC_WEB_URL` (the `invite-url.ts` pattern), and `check-email`
  says to sign in after verifying. A packaged desktop sign-up dead-ends today
  because the verification link redirects to `tauri://localhost`, which the
  browser cannot open. A real deep-link handoff is its own project.

### Docs

- `reference/README.md`: moved from `planned/` to root on 2026-10-07 when
  Step 1 started.
- `reference/mobile-parity-todo.md:120`: the "Onboarding dialog is web-side"
  line is stale; mobile has `onboarding.tsx`.
- `reference/github-connector.md:36,53`: the per-channel gating TODO and
  `SOURCE_INGEST_ENABLED` are stale against code (agent profiles gate per
  channel today).

## Hazards

- `afterCreateOrganization` returns early on a channel-seed failure and skips
  everything after it. Step 2 makes each step independent.
- `db.update(user)` bypasses better-auth's `refreshUserSessions`, so
  `session.user` stays stale in Redis. Never write user flags that way; Step
  10 removes the one existing case.
- `WorkspaceHome` forwards `settings`, `tab`, `mcpServerId` but not
  `connector`. Step 5 fixes it; the setup page depends on it.
- On desktop the OAuth callback runs in the system browser with its own
  session. The setup page must not rely on the callback reaching the app; it
  reads server state on focus. If the browser is signed in as a different Lor
  user, the Linear state check fails with a generic toast and the desktop app
  sees nothing. Known gap, not fixed here.
- The rekey script breaks OAuth MCP server registrations, because the
  redirect URI they registered embeds the old key. Reconnect them after the
  script runs.
- The site lookup never makes our server fetch a user-typed host: Exa
  fetches the page remotely, and the workspace icon comes from Google's
  favicon service, a fixed host. The endpoint is still rate limited, since
  each lookup spends Exa and model credits.
- `revoked` `integration_connection` rows still block the `(provider,
  external_id)` unique index across workspaces. Step 6 relaxes the 409 guard
  for revoked rows owned by another workspace.
- The default agent profile is `grantsAll`, so every connected connector is
  available in every channel. Fine for v1; scoping `code_actions` to
  `#engineering` is a later agent-profile template.
- `loadConversation` does not filter message types, so Lor's intro shows up as
  a Lor turn in `#general`'s first run. Accurate, intended.
- `AGENT_RUN_MAX_CREDITS` defaults to 2,000, equal to the promo, so one heavy
  first answer can spend the whole grant. Revisit with launch pricing.
- `connectGithub` never verifies that the acting user can access the
  installation id (GitHub advises a user-token check). Admin-only connectors
  narrow who can try. Pre-existing; out of scope.

## Open questions

Rework owed after `reference/planned/workspace-model.md` (2026-10-08):
channel chat is now people only, and Lor works in sessions. The Lor intro
message in `#general` (Step 2) goes away, and the `@Lor` hints (Steps 8 and 9)
must teach "@Lor starts a session" and ⌘N. Jacob wants to redo how onboarding
introduces Lor once the workspace model lands.

Before Step 5 is tested live, Jacob creates a dev GitHub App
(checklist in `reference/github-connector.md`). Today dev shares the prod
App, whose Setup URL points at `app.lor.chat`, so a GitHub connect started
from dev lands on the prod web app and fails.

Resolved 2026-10-07: the prod App is public, has OAuth during installation
off, Setup URL `https://app.lor.chat/integrations/github/setup`, and Redirect
on update on. Step 6 makes the connect flow independent of `state`, so
Redirect on update stays on. Creators cannot delete their own channels.

## Deviations

- 2026-10-07, Step 1: `allowUserToCreateOrganization: false` moved to Step 3,
  so workspace creation keeps working on web and mobile between commits.
- 2026-10-07, Step 1: no retry on key collision (see "Workspace key").
- 2026-10-07, Step 1: description and website are `input: false` in
  better-auth; `POST /v1/workspaces` writes them after creation, so every
  write goes through `normalizeDomain` and our length limits.
- 2026-10-07, Step 1: finishing setup is its own route,
  `POST /workspaces/{key}/setup/complete`, not a PATCH field, so its
  permission check (`connector:manage`) can be the handler's first
  statement.
- 2026-10-07, Step 1: the rekey script also marks existing workspaces as set
  up, so they skip the checklist.
- 2026-10-07, Step 2: the template lives in `packages/auth` next to the hook
  that calls it, not in `packages/db/src/seeds`, so `@repo/db` needs no new
  export.
- 2026-10-07, Step 2: the voice channel is `standup`, lowercase like every
  channel the create dialog makes.
- 2026-10-07, Step 2: Lor's intro writes "@Lor" as plain text, not a mention
  token, so it never notifies or links to itself.
- 2026-10-07, Step 3: no `workspace:member:joined` emit after create.
  `/onboarding` sits outside the app layout, so entering the workspace mounts
  a fresh socket, which joins every workspace room on connect.
- 2026-10-07, Step 3: invite accept still navigates to the workspace root;
  the root now redirects to the first text channel. One fix covers every
  entry path, with no API change.
- 2026-10-07, Step 3: only the landing route sends zero-workspace users to
  `/onboarding`. `/dms` stays reachable, so existing DMs are never locked
  behind onboarding.
- 2026-10-07, Step 3: `user.onboardingCompleted` is no longer read on web or
  mobile; Step 10 still removes the write.
- 2026-10-07, Step 4: favicons come from Google's public favicon service, not
  from parsing each site's `<link rel>` icons through the guarded fetch. It
  is what Jacob's reference component uses, it is instant, and the server's
  logo fetch hits one fixed host instead of user-typed ones.
- 2026-10-08, Step 4: the site lookup runs automatically, not behind a
  button (Jacob's call). It starts at page mount, so the wait hides behind
  the choose step; the shimmer and the "Filled from" hint make it visible.
  Google's favicon service never upscales and returns 404 for unknown sites,
  which is what makes the 64px rule work; it serves large icons as JPEG.
- 2026-10-08, Step 5: connector callbacks (GitHub, Linear, Notion, Attio)
  return to the root with only `?connector=<id>`. Sending `settings` too
  flashed the settings dialog on the root before the setup redirect. The
  root sends unfinished setup to `/setup` (done states come from the
  integrations query) and otherwise opens the connector's settings detail
  over the channel, which also fixes the dropped-`connector` hazard.
- 2026-10-08, Step 5: "Finish" and "Do this later" are one button whose
  label changes once anything is done; both set `setupCompletedAt`.
- 2026-10-08, Step 5: setup access reads the viewer's role from the
  slug-scoped members list, not `getActiveMember`, which can answer for the
  previous workspace while the active organization switches.
- 2026-10-08, Step 5: the invite row creates a 7-day, unlimited link on
  click and tries to copy it at once; Safari can refuse a clipboard write
  after the request's await, so a Copy button replaces Create.
- 2026-10-08, Step 6a: the column is `channel.creatorId` (`creator_id`), not
  `createdById`, to match `project.creatorId`, `plan.creatorId` and
  `loop.creatorId`. `createProject` sets it on the category and its
  channels. Lor-proposed channels and DMs leave it null; the DM response
  schema omits it.
- 2026-10-08, Step 6a: creator edit covers channels only. Category menus
  (Edit Category, project Members/Archive) stay `channel:update`. Mobile has
  no creator edit yet; its create button follows the role change.
- 2026-10-08, Step 6a: new channels take `max(position)+1` among siblings:
  categories among categories, channels within the same parent.
- 2026-10-08, Step 6b: GitHub connect is two routes.
  `POST /workspaces/{key}/integrations/github/connect-url` (connector:manage
  first) records the intent (`apps/api/src/lib/github-connect-intent.ts`)
  and returns the install URL with a fresh signed state.
  `POST /integrations/github/setup` (session) replaces the
  workspace-scoped `github/connect` route. GitHub now goes through
  `replaceActiveConnection` like every other connector. The setup page also
  handles `setup_action=request` (org member without install rights).
- 2026-10-08, Step 6b: a revoked row owned by another workspace is deleted
  (cascading its triggers, repo config and sources) when the external id is
  connected elsewhere. Retrieval already ignores sources of revoked rows.
- 2026-10-08, Step 6b: `connector:manage` also gates Datadog and CloudWatch
  connects. On web, event routing controls are disabled and the base-branch
  section is hidden without it.
- 2026-10-08, Step 7: the join route emits `workspace:member:joined` itself
  through `publishRealtime`, instead of the client emitting it. Web
  onboarding sits outside the socket provider, and mobile gets it for free.
- 2026-10-08, Step 7: `addWorkspaceMember` inserts with `onConflictDoNothing`
  and reports whether it joined; `afterWorkspaceJoin` runs `syncSeats` and
  the first-invite promo for both invite and domain joins. Join returns 404
  for both a missing key and a domain mismatch, so keys can't be probed.
- 2026-10-08, Step 8: one context provider replaces `use-hints.ts` +
  `useHintSlot`. Components report eligibility through `useHint(key,
  eligible)`; the provider shows the first eligible, undismissed key in
  `HINT_PRIORITY`. `lor_intro` outranks `channels_intro`, so a new member
  learns @Lor first. Dismissed state reads as "dismissed" until loaded, so
  nothing flashes.
- 2026-10-08, Step 8: `channels_intro` is eligible only while the sidebar is
  open (desktop collapse or the closed mobile sheet would hide its anchor).
  `lor_intro` is opted into with `MessageInput lorIntro` on the channel
  route; any composer's send that mentions Lor dismisses it.
- 2026-10-08, Step 9: `lor_reply` shows on a Lor reply the viewer watched
  finish (its activity row was live, now settled, with tool calls), not
  "a reply to the viewer's own message": messages carry
  `lorTriggerMessageId` but not the trigger's author. The provider now
  tracks eligible instances per key and shows only the first, since every
  live reply's activity row can be eligible at once.
- 2026-10-08, Step 9: mobile hints are inline cards (`HintCard`) above the
  composer and under the lobby's Start call button, not anchored popovers,
  so they never cover the keyboard. Mobile's placeholder is shorter:
  "Message #general or ask @Lor". The "Finish setup on the web" card shows
  for owners and admins (mobile has no custom-role grants), opens
  `{web}/{key}/setup` in the in-app browser, and its ✕ hides it on that
  device only. A native setup screen is in `reference/mobile-parity-todo.md`.
