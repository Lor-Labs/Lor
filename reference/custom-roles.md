# Custom roles & permissions (LOR-57 / LOR-82) — execution runbook

Status legend: `[ ]` todo · `[x]` done. Update checkboxes as steps land, and
append to the **Decisions & deviations log** at the bottom when reality forces
a change — this document is the source of truth across agent runs.

Product context: pillar 1 of `reference/self-configuration.md`. Custom roles
are the authority vocabulary that approval policies (LOR-81) and workspace
change proposals will be written in.

## Current state (verified 2026-08-31)

- better-auth `1.4.18` organization plugin already runs with
  `dynamicAccessControl: { enabled: true }`; the `workspace_role` table
  (better-auth `organizationRole`) exists in `packages/db` — **but nothing
  reads or writes it**. Better-auth's role CRUD endpoints are live and unused.
- All enforcement is local and static: `workspaceStatements`
  (`packages/auth/src/lib/workspace-statements.ts`) + three hardcoded roles
  (`owner`/`admin`/`member`) checked via `assertWorkspacePermission` /
  `hasWorkspacePermission` (`apps/api/src/lib/permissions.ts`) at ~40 call
  sites. `checkPermission` (the `auth.api.hasPermission` path) is dead code.
- `channel: ["update"]` is borrowed as the de-facto admin check by
  mcp-servers, webhooks, agent-profiles, and custom-tools handlers. The
  integrations route group bypasses statements entirely with inline
  `ownerId === user.id || role === "admin"` (3 sites).
- Two owner truths: schema says `workspace.ownerId` is authoritative, but
  `normalizeWorkspaceAuthority` (`packages/auth/src/lib/permissions.ts:73`)
  derives `isOwner` from `role === "owner"` and owner short-circuits every
  check. Latent today (nothing writes `"owner"` into `workspace_member.role`).

### Verified better-auth 1.4.18 dynamic-AC behavior (from dist source)

- `workspace_role.permission` stores `JSON.stringify(permission)` — a
  `Record<resource, action[]>` validated with zod on read.
- `hasPermission` loads **all** org roles per check; statically-defined role
  names shadow same-named dynamic roles; `createOrgRole` also rejects reserved
  names (`checkIfRoleNameIsTakenByPreDefinedRole`) and duplicate DB names, and
  normalizes the role name.
- Role CRUD is gated on the built-in `ac` statement: create/update/delete
  require `ac: ["create"|"update"|"delete"]`. Our `owner`/`admin` inherit full
  `ac` grants from `ownerAc`/`adminAc`; `member` gets `ac: ["read"]`.
- A creator cannot grant permissions they don't hold themselves
  (`checkIfMemberHasPermission`), and can only reference resources that exist
  in the `ac` statement set.
- `maximumRolesPerOrganization` defaults to **Infinity** — we must set it.
- better-auth internally supports comma-separated multi-role strings in
  `member.role`; we do NOT use that (see locked decisions).

## Locked decisions (do not relitigate without logging a deviation)

| Topic | Decision |
|---|---|
| Enforcement engine | The local helper surface (`assertWorkspacePermission` & co.) stays the single enforcement path and learns custom roles. `auth.api.hasPermission` stays unused → delete dead `checkPermission`. |
| Custom-role resolution | Resolved once per request in `workspace-auth` middleware: if `member.role` is not a static role, one indexed `workspace_role` lookup parses the permission JSON onto the context authority. Handlers/helpers stay sync. Static roles: zero extra queries. Redis caching deferred until measured. |
| Owner truth | `workspace.ownerId` ONLY. `normalizeWorkspaceAuthority` stops deriving `isOwner` from `role === "owner"`; `isOwner` becomes an explicit required input. Mobile's `actorRole === "owner"` comparison gets the same fix. |
| Unknown/deleted role fallback | A `member.role` string that resolves to nothing (deleted custom role, bad data) degrades to **member-tier base access with no custom grants** — never a 403 lockout, never a crash. `toWorkspaceAuthority` stops throwing. |
| Statement taxonomy | Split now. New resources: `connector`, `webhook`, `agentProfile`, `customTool`, `billing` — each a single `["manage"]` action (their routes only ever gate admin-tier writes today; no fake granularity). `connector` = third-party integrations, named to match the UI. `customTool` covers BOTH custom API tools and MCP servers — both are user-added tools (Jacob 2026-08-31). `webhook`/`agentProfile` grants are workspace-wide and cover the full lifecycle including per-channel attachment (webhooks on any channel; assigning channels to profiles) — per-channel permission scoping is explicitly out of scope for v1. `approval: ["resolve"]` is added to the statement set but NOT enforced yet (reserved for LOR-81). `channel`/`message`/`workspaceMember`/`instructions` unchanged. |
| Static roles | `owner`/`admin`/`member` stay hardcoded in `packages/auth` and keep all grants (owner/admin get every new statement, member none). Not editable in the roles UI, shown read-only. |
| Role CRUD | better-auth's endpoints via `authClient.organization` for **create / update / list / get** (they give ac-gating + grant-subset checks + name collision handling for free). **Delete is ours**: a Lor API endpoint that transactionally reassigns affected members to `member`, then deletes the `workspace_role` row — better-auth's delete leaves dangling member.role strings. |
| Role cap | `dynamicAccessControl.maximumRolesPerOrganization: 32`. |
| Hierarchy position | All custom roles share one fixed position **15** (below admin 10, above member 20). No per-role ordering in v1. Anti-escalation and `canManageWorkspaceAuthority` work unchanged off positions. |
| Message rate limit | Custom roles get the member tier (30/min). |
| Multi-role | One role string per member. We never write comma-separated role lists. |
| Assignment | `PATCH …/members/:id/role` widens from `z.enum(assignableWorkspaceRoles)` to also accept a custom role name that exists in this workspace's `workspace_role`. Owner stays unassignable. |
| Where checks live | ONE surface: in the handler, always. The permission check is the FIRST statement of every gated handler: `assertWorkspaceAuthority(c.var.authority, { … })` (or `hasWorkspaceAuthority` for response shaping). No route-level permission middleware — Jacob rejected the hybrid (2026-08-31): one predictable place to look beats declarative gates. `workspace-auth` middleware still RESOLVES `c.var.authority` (incl. custom grants); it never checks. No `anyOf` OR-paths in v1; no capability-ID indirection. |
| Invites | Still hardcode `role: "member"` on accept. Invite-with-role is out of scope. |
| UI surface | Workspace settings dialog gains **Members** and **Roles** tabs (Discord pattern). No new route. |
| Web permission mirror | Web fetches the workspace's custom roles once (React Query over better-auth `listOrgRoles`) and resolves grants locally with the same `@repo/auth/permissions` helpers the API uses. |
| DB hygiene riding along | Delete dead `WORKSPACE_MEMBER_ROLES` const; add unique index on `workspace_member (workspaceId, userId)`. Both in S1 (db:push owed — Jacob runs it). |
| Out of scope | `approval:resolve` enforcement (LOR-81), ownership transfer, per-channel permission overrides, invite-with-role, multi-role members, Merlin proposing roles (change-proposal phase). |

## Steps

Each step is independently committable, targets ~300–500 LOC, and leaves the
tree green (`pnpm run validate`). Don't start a step until its predecessor is
checked.

---

### [x] S1 — `packages/auth` + `packages/db` foundation (~350 LOC) — built 2026-08-31, db:push owed

`packages/auth/src/lib/workspace-statements.ts`
- Add `connector/webhook/agentProfile/customTool/billing: ["manage"]` and
  `approval: ["resolve"]` to `workspaceStatements` (comment: approval
  enforcement lands with LOR-81).

`packages/auth/src/lib/permissions.ts`
- Owner-truth fix: `WorkspaceAuthority.isOwner` becomes required;
  `normalizeWorkspaceAuthority` no longer infers it from the role string
  (keep a single explicit derivation helper `deriveIsOwner(workspace, userId)`).
- Custom-role support: `CUSTOM_ROLE_POSITION = 15`; authority type gains
  optional `customGrants?: Record<string, string[]>`;
  `workspaceAuthorityHasPermissions` checks `customGrants` when the role isn't
  static; position/rate-limit/format helpers gain non-static fallbacks
  (position 15, member rate limit, raw name as label).
- `parseRolePermission(json: string)` — zod `record(string, string[])`,
  returns `null` on garbage (mirror better-auth's stored shape).
- Export a `MemberRoleName = WorkspaceRole | (string & {})` type for surfaces
  that carry possibly-custom role strings.

`packages/auth/src/lib/auth.ts`
- `dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 32 }`.

`packages/db`
- `workspace-members.ts`: delete dead `WORKSPACE_MEMBER_ROLES`; add unique
  index on `(workspaceId, userId)`.

Tests: extend `permissions.test.ts` — custom-grant resolution, owner no longer
inferred from role string, unknown-role fallbacks, parse failures.

**db:push owed after this step** (unique index only — `workspace_role` already
exists). Flag if the dev DB has duplicate membership rows before pushing.

---

### [x] S2 — `apps/api` enforcement core (~350 LOC) — built 2026-08-31

- `middleware/workspace-auth.ts`: after membership lookup, if `member.role`
  isn't static, fetch the `workspace_role` row for `(workspaceId, role)`,
  parse grants, and attach a resolved `authority` to context (fallback rule
  from locked decisions). Static roles skip the query.
- `lib/permissions.ts`: rework `toWorkspaceAuthority` (no throw; explicit
  `isOwner` from `ownerId`; carries `customGrants`), keep
  `assertWorkspacePermission` / `hasWorkspacePermission` /
  `assertCanManageWorkspaceMember` signatures compatible for existing call
  sites; delete dead `checkPermission`.
- `apps/realtime/src/services/rate-limit.ts`: custom role strings fall back to
  member rate limit (must not crash on non-static roles).
- Existing handlers must compile unchanged; behavior identical for the three
  static roles. API tests for the middleware resolution + fallback.

---

### [x] S3 — `apps/api` call-site migration (~400 LOC, mechanical) — built 2026-08-31

- Every gated handler moves to `assertWorkspaceAuthority(c.var.authority, …)`
  as its FIRST statement (custom-grant aware); response shaping uses
  `hasWorkspaceAuthority`. Then delete the static-only
  `assertWorkspacePermission`/`hasWorkspacePermission` wrappers.
- mcp-servers (8 sites) AND custom-tools (3) → `customTool: ["manage"]`;
  webhooks (4) → `webhook: ["manage"]`; agent-profiles (3) →
  `agentProfile: ["manage"]`; billing (5) → `billing: ["manage"]`.
- integrations handlers: replace the 3 inline `ownerId || role === "admin"`
  checks with `assertWorkspacePermission(… { connector: ["manage"] })`;
  instructions handler's inline `canManage` (L86) → `hasWorkspacePermission`.
- projects/uploads: re-point to the statement that matches what they actually
  gate (channel-container work stays `channel`; workspace icon →
  `organization: ["update"]`).
- No behavior change for static roles (owner/admin hold every new statement).
  Update/extend route tests where they assert 403 messages.

---

### [x] S4 — role assignment + custom-role delete API (~300 LOC) — built 2026-08-31

- `routes/v1/workspaces` role update: schema widens to
  `z.enum(assignableWorkspaceRoles).or(z.string())`; handler validates a
  non-static value against this workspace's `workspace_role`; anti-escalation
  math uses position 15; keep `owner` unreachable.
- New endpoint `DELETE …/roles/:roleName` (our transactional delete per locked
  decisions: reassign members → `member`, delete row, emit member-updated
  events). Better-auth's create/update/list stay untouched.
- Kick/role-change realtime events already exist — reuse; sync seats untouched.
- Tests: assign custom role, anti-escalation vs position 15, delete-reassign
  transaction, dangling-role degrade path end-to-end.

---

### [x] S5 — web: permission mirror + Members tab (~450 LOC) — built 2026-08-31

- React Query hook fetching custom roles via better-auth `listOrgRoles`
  (`authClient.organization`), keyed per workspace.
- `apps/web/src/lib/permissions.ts`: resolve grants for possibly-custom roles
  with the shared helpers; `formatWorkspaceRole` falls back to the custom
  role's name.
- Workspace settings dialog: add **Members** tab; move/reuse
  `workspace-members-panel.tsx` logic (list, change role incl. custom roles in
  the radio group, kick, invite entry point). Right-panel members list stays.

---

### [x] S6 — web: Roles tab (~500 LOC) — built 2026-08-31

- Roles list: static three shown read-only with their grants; custom roles
  with member counts.
- Create/edit: name + permission matrix grouped by resource with friendly
  labels/descriptions per statement (source the resource/action metadata from
  one exported map in `packages/auth` so API, web, and future LOR-81 UI share
  labels). Create/update via `authClient.organization`; delete via the S4
  endpoint with a "members will become Member" confirm.
- Gate the tab on `ac` grants (owner/admin only today).
- HugeIcons, coss ui primitives, color tokens.

---

### [x] S7 — mobile parity + sweep (~200 LOC) — code built 2026-08-31; live manual QA owed (checklist below)

- `use-member-moderation.ts`: derive owner from `workspace.ownerId`, not
  `actorRole === "owner"`; custom-role fallbacks in `use-channel-permissions`
  and member sheets (display name, member-tier assumptions).
- Update `reference/mobile-parity-todo.md` (roles UI itself can lag web).
- Final `pnpm run validate` + manual QA checklist: create role → assign →
  verify gated route 403/allow → delete role → member degrades.

Manual QA checklist (live, after db:push):
1. `db:push` — check dev DB for duplicate `(workspace_id, user_id)` rows
   first; the new unique index fails on dupes.
2. Settings → Roles: create role `support` with webhook:manage +
   channel:update. Verify it appears with grant count.
3. Settings → Members: assign `support` to a test member. Verify label.
4. As that member: webhook settings should allow create/edit (webhook:manage);
   billing endpoints should 403; channel edit allowed (channel:update).
5. Edit role: remove channel:update → member loses channel edit within one
   request (no caching layer to invalidate).
6. Delete role → confirm dialog shows member count → member degrades to
   Member in the list; re-fetch shows role gone.
7. Admin promotes another member to admin (relaxed rule) — works; the new
   admin cannot demote the first admin (hierarchy unchanged).
8. Mobile: owner sees correct moderation options; member sheet renders the
   custom role name; custom-role holder sees member-tier UI (known gap).

## Decisions & deviations log

- 2026-08-31 — Runbook created. Enforcement stays local (Jacob), taxonomy
  split now (Jacob), settings-dialog tabs for UI (Jacob), new vision doc
  `reference/self-configuration.md` precedes playbooks (Jacob).
- 2026-08-31 — Taxonomy review with Jacob: `mcpServer` + `customTool` merged
  into one `tool` statement (both add tools to the workspace). Confirmed:
  `webhook`/`agentProfile` grants are workspace-wide and include per-channel
  attachment; single role per member; flat custom-role hierarchy (position 15,
  no day-1 ordering); owner model as proposed; Merlin's own authority is NOT
  modeled through roles (LOR-81 approval policies handle it).
- 2026-08-31 — Post-S6 (Jacob): Members and Roles consolidated into ONE
  settings section, "Members & Roles", with an underline tab bar
  (members-roles-section.tsx). Roles tab hidden for non-admins; `?tab=roles`
  URLs map to the combined section.
- 2026-08-31 — S6 decisions: no role RENAME in the UI — better-auth's
  updateOrgRole can rename but leaves members' role strings dangling; edit is
  permissions-only, rename = delete + recreate. `approval: resolve` excluded
  from the permission matrix until LOR-81 enforces it (no dead switches).
  Roles tab gated admin-or-owner (same check as billing). Statement labels
  live in `workspaceStatementMeta` (packages/auth/src/lib/workspace-statements.ts).
- 2026-08-31 — Assignment rule relaxed (Jacob, after seeing the admin UI):
  non-owners may assign roles at their own position **or below** (`<` not
  `<=` in the handler guard) — admins can promote to admin; custom-role
  holders with `role:update` can hand out their own tier. Demoting an admin
  stays owner-only via the moderation hierarchy (strictly-lower rule,
  unchanged). Mirrored in web (members panel + Members section) and mobile
  (`use-member-moderation.ts`).
- 2026-08-31 — S5: the better-auth CLIENT plugin needs its own
  `dynamicAccessControl: { enabled: true }` in `organizationClient(...)`
  (packages/auth/src/lib/auth-client.ts) or the role endpoints
  (`authClient.organization.listRoles` etc.) don't exist on the typed client.
  Also fixed latent web-panel bug en route: the role menu previously offered
  admins the "admin" option the server always rejects — options now mirror the
  server's strictly-below-own-position rule.
- 2026-08-31 — S4 reality check: role updates never emitted realtime events
  (clients invalidate react-query) — delete-role follows the same pattern; the
  response carries `reassignedMemberIds` instead of emitting `member:updated`.
  DB-backed integration tests aren't feasible (api vitest runs env-stubbed, no
  live DB) — assign/delete/degrade paths are covered by unit + schema tests;
  live e2e is manual QA in S7.
- 2026-08-31 — Jacob rejected the middleware/handler hybrid after S2 built it:
  checks live in ONE place — the top of the handler. The
  `requireWorkspacePermission` route-middleware factory was built and then
  deleted the same day; do not reintroduce it. `workspace-auth` still resolves
  `c.var.authority` (resolution ≠ checking).
- 2026-08-31 — Statement renames (Jacob): `integration` → `connector` (match
  UI naming), `tool` → `customTool` (it's specifically user-added tools).
- 2026-08-31 — better-auth's creator flow DOES write `role: "owner"` into the
  creator's `workspace_member` row (creatorRole default) — the two-truths bug
  is live for creators, not latent. The S1 fix (explicit `isOwner` only)
  stands; role string `"owner"` keeps full grants as a bundle but no longer
  short-circuits authority.
