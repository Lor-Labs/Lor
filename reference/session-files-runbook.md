# Session files runbook: right-rail file panel, no Lor threads in the thread panel

> Status: in flight on `dev`, started 2026-10-13. Follows
> `workspace-model-runbook.md` (sessions) and closes its open items on the
> artifact viewer and `?threadId` deep links. File:line references are as of
> that date; re-check them before each step.

Execute step by step. Each step is about 300–400 changed lines, leaves
`pnpm run check` and `pnpm run check-types` green, and is reviewed and
committed by Jacob before the next one starts. No tests (see `CLAUDE.md`).
Tick each step's boxes as it lands and record departures in "Deviations".

## Locked decisions (Jacob, 2026-10-13)

1. **A Lor session never opens in the right-panel thread view.** Sessions open
   on `/$workspaceSlug/session/$sessionId`. The right-panel thread is for
   human threads and call chats only.
2. **Files open in the right rail, on any page.** The file panel replaces the
   rail's current view (Details on a session page, the Files list on a
   channel page) and never covers the main area. No full-page overlay, no
   shared-layout morph. Its "Open session" button shows only when the file
   came from a session other than the one on screen. Files from before
   sessions (no session) still open; they just have no session button.
3. **`ThreadPanel` is split.** The session conversation moves to
   `components/session/`; the right-panel thread keeps no Lor code.
4. **One file chip.** A custom file-type icon (page with folded corner,
   extension label, tone per type) and one chip component replace the seven
   current file presentations. Modeled on careCycle's import assistant
   (`packages/ui/src/components/attachment.tsx`, `file-type-icon.tsx`).
5. **Only sandbox work flattens in the tool trail.** Normal tool calls keep
   today's two levels. Sandbox sub-steps become flat rows with a file chip,
   diff counts and one expansion.

## Steps

#### Step 1: sessions never open in the thread panel (~250)

[x] built 2026-10-13 · [x] committed

- API: `sessionId` on the thread replies response, on artifact
  `conversation` (`lib/queries/channel-files.ts` `artifactConversations`) and
  on upload rows in the channel Files list.
- `useMessageSearchNavigation` opens sessions on their page. A thread target
  with no known session is looked up first (`locationQuery`, cached).
- `ThreadPanel` without `sessionView` redirects to the session page when the
  thread is a session (covers `?threadId` deep links, refresh, Back).
- In-thread citation jumps, loop panel plan rows, the Files list's "View
  conversation" and `useArtifactConversation` pass or resolve the session.
- The overlay's "Open conversation" goes to the session page and hides on
  that session's own page.

#### Step 1b: typed channel file queries (~150)

[x] built 2026-10-13 · [x] committed

- `lib/queries/channel-files.ts` moves off `db.execute` casts to the Drizzle
  query builder. The Files list runs its artifact and upload queries in
  parallel and merges them in JS; the cursor format is unchanged.

#### Step 2: file icon and chip primitives (~300)

[x] built 2026-10-13 · [x] committed

- `packages/ui`: `FileTypeIcon` (custom SVG, extension → tone map) and the
  `FileChip` family, on Townhall tokens and Base UI `render`.

#### Step 3: right-rail file panel, overlay deleted (+350 / −680)

[x] built 2026-10-13 · [x] committed

- `?artifactId` on any page opens `FilePanel` in the right panel, over the
  current view (`RightSidebarPanel` reads `fileId` from the rail context).
  It has its own remembered width (`file` size class) and expands a
  collapsed panel. Mobile shows it as a full-width sheet.
- `FilePanel`: back (or close when nothing is underneath), type icon, name,
  rows × columns or version · size, version select, Open session (only for
  another session's file), Copy, Download. Body reuses `CsvGrid` and
  `ArtifactBody`.
- `useOpenFile` / `useCloseFile` are the only way files open and close.
- Deleted `ArtifactOverlay`, `use-artifact-conversation.ts`, the CSV
  preview card (and with it the `layoutId` morph), and the channel route's
  `artifactFrom` / `fileSearch` params.

#### Step 4: folded into Step 3

[x] see Step 3

#### Step 4a: sessions own artifacts (~200)

[x] built 2026-10-13 · [ ] committed · [ ] db:push (dev) · [ ] backfill (dev) · [ ] db:push (prod) · [ ] backfill (prod)

- `artifact.threadRootId`, unique `(threadRootId, path)`; the plan's unique
  index becomes a plain `planId` index, so `planId` is provenance only.
- `writeArtifactVersion` takes `threadRootId`: within a session a path names
  one artifact, plan or not. `create_artifacts` reseeds `/workspace/out`
  from the session's artifacts on every run, and both artifact tools pass
  the run's thread.
- `packages/db/src/scripts/backfill-artifact-sessions.ts` scopes existing
  artifacts from their plan or run.
- Order: `db:push`, then the backfill, then deploy the worker. Code before
  the column fails every write; a deploy before the backfill makes planned
  sessions start a second copy of files they already have.

#### Step 4b: session files API and rail (~250)

[ ] built · [ ] committed

- `GET /sessions/{id}/artifacts`; the session rail's Files list reads it
  instead of plan artifacts plus files found in loaded messages.

#### Step 5: chips everywhere (~350)

[ ] built · [ ] committed

- `ArtifactFileCard`, `WorkFileList` / `SourceRow`, the Files list rows and
  upload tiles render the shared chip.

#### Step 6: split `ThreadPanel` (~400, may split)

[ ] built · [ ] committed

- Session conversation into `components/session/`; shared message-list
  pieces stay shared.

#### Step 7: strip Lor from the right-panel thread (~300)

[ ] built · [ ] committed

- Plan header, `ThreadWorkHeader`, run queue / stop / steer, plan Markdown
  export, dead `PlanCard` and proposal thread paths.

#### Step 8: flatten sandbox work in the tool trail (~350)

[ ] built · [ ] committed

## Deviations

- Step 2: the chip is `FileChip`, not careCycle's `Attachment`, because
  Nexus already exports an `Attachment` from `@repo/ui`. It drops careCycle's
  upload states, vertical layout and horizontal group until something needs
  them. `FileTypeIcon` adds presentation, image and media tones; generic
  files use `text-muted-foreground`.
- Step 3 absorbed Step 4: once the panel read `?artifactId` from the URL on
  every page, the overlay, its conversation hook and the channel-only params
  had no callers left. It also pulled the CSV preview card's removal forward
  from Step 5, since that card was the morph source. The file is URL state
  over the current view, not a `RightSidebarView` with a back pointer:
  closing a file needs no stored history, and deep links work unchanged.
  Escape no longer closes a file.
- Steps 4a and 4b were added 2026-10-13 (Jacob): artifacts keyed on the plan
  made sessions without one duplicate files on every rewrite and start every
  workbench run with an empty `/workspace/out` (the persistent sandbox
  resets it and only plans reseeded it). Editing another session's file by
  id is recorded in `artifacts.md` as a requirement for live editing, not
  built here.

