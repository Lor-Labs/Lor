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

[x] built 2026-10-13 · [ ] committed

- `lib/queries/channel-files.ts` moves off `db.execute` casts to the Drizzle
  query builder. The Files list runs its artifact and upload queries in
  parallel and merges them in JS; the cursor format is unchanged.

#### Step 2: file icon and chip primitives (~300)

[ ] built · [ ] committed

- `packages/ui`: `FileTypeIcon` (custom SVG, extension → tone map) and the
  `Attachment` chip family, on Townhall tokens and Hugeicons.

#### Step 3: right-rail file panel on the session page (~400)

[ ] built · [ ] committed

- New `RightSidebarView` `{ type: "file", artifactId, back }`, its own size
  class, opened from `?artifactId` on the session route.
- `FilePanel`: back, name, rows × columns or version · size, version select,
  Copy, Download, Open session, close. Body reuses `CsvGrid` and
  `ArtifactBody`.
- Remove the overlay and the CSV card `layoutId` from the session route.

#### Step 4: file panel everywhere, overlay deleted (~350)

[ ] built · [ ] committed

- Channel route: `?artifactId` opens the file panel in the rail; the Files
  list and loop panel open files there.
- Delete `ArtifactOverlay`, `use-artifact-conversation.ts` and the channel
  route's `artifactFrom` / `fileSearch` params.

#### Step 5: chips everywhere (~350)

[ ] built · [ ] committed

- `ArtifactFileCard`, the CSV preview card, `WorkFileList` / `SourceRow`,
  the Files list rows and upload tiles render the shared chip.

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

