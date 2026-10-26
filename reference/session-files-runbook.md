# Session files runbook: right-rail file panel, no Lor threads in the thread panel

> Status: all web and mobile steps built 2026-10-13 on `dev`; Step 4a's
> backfill is still owed on dev, and its `db:push` and backfill on prod. Follows
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
- `FilePanel`: close (X; the panel underneath comes back), type icon, name,
  rows × columns or version · size, version select, Open session (only for
  another session's file), Copy, Download. Body reuses `CsvGrid` and
  `ArtifactBody`.
- Web/desktop image previews share `ImagePreview` with repository tabs;
  SVG offers Preview/Source and renders through an image element. Shared
  MIME/language mappings include Rust and JS/TS module extensions, with
  filename inference for older artifacts stored as generic binary files.
- `useOpenFile` / `useCloseFile` are the only way files open and close.
- Deleted `ArtifactOverlay`, `use-artifact-conversation.ts`, the CSV
  preview card (and with it the `layoutId` morph), and the channel route's
  `artifactFrom` / `fileSearch` params.

#### Step 4: folded into Step 3

[x] see Step 3

#### Step 4a: sessions own artifacts (~200)

[x] built 2026-10-13 · [x] committed · [x] db:push (dev) · [ ] backfill (dev) · [ ] db:push (prod) · [ ] backfill (prod)

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

#### Step 4b: session files API and rail (~170)

[x] built 2026-10-13 · [x] committed

- `GET /sessions/{id}/files`: every artifact the session owns (newest
  first) and every upload in its thread. Same access check and 404 as
  `GET /sessions/{id}` (shared `findAccessibleSession`).
- The rail's Files list reads it instead of plan artifacts. Files in loaded
  messages are still merged in, so files that land mid-run show without a
  refetch.

#### Step 5: chips everywhere (~350)

[x] built 2026-10-13 · [x] committed

- `ArtifactFileCard` (Lor's files, opens the panel) and the new
  `UploadFileCard` (shared files, open in a new tab) are `FileChip`s; the
  transcript, the session rail, plan cards, loop runs and message uploads
  all use them. The channel Files list rows are surface-less chips that keep
  their author · version · date line, with "View conversation" as a chip
  action.
- `getFileKind` and its Hugeicons glyph set are deleted; the composer's
  pending uploads stay on the Nexus tile.

#### Step 6a: extract the shared conversation pieces (~350, moves)

[x] built 2026-10-13 · [x] committed

No behavior change; `ThreadPanel` uses the extracted pieces.

- `hooks/use-lor-run-controls.ts`: Lor's pending turn, Stop (including
  before the real turn arrives), the run queue with steer, and replay.
- `hooks/use-conversation-scroll.ts`: scroller refs, opening anchors,
  scroll-on-send, jump to a message, and the reader pointer signal.
- `components/chat/conversation-messages.tsx`: skeleton, grouped replies
  and events, and the load-older sentinel, in `chat` or `document` layout.

#### Step 6b: `SessionDocument` (~550 new, −370)

[x] built 2026-10-13 · [x] committed

- `components/session/session-document.tsx` renders the session
  document from the 6a pieces plus the existing hooks; `SessionView` uses it.
  (Named `SessionDocument` because `session-view.tsx` already has an
  internal `SessionConversation`.)
- `ThreadPanel` loses `sessionView` / `SessionPresentation` and every
  session branch: inline composer, toolbar target, heading, archived bar,
  forward, turn rail, document typing, subscriber faces, optimistic Lor
  turns and sidebar patches.

#### Step 7: strip Lor from the right-panel thread (+100 / −520)

[x] built 2026-10-13 · [x] committed

- `ThreadPanel` loses the plan header and status, `ThreadWorkHeader`, Lor's
  run controls (pending turn, Stop, queue, steer, replay) and the plan
  sections of Copy as Markdown. Lor never runs in human threads or call
  chats (`routeLor` skips voice; `@Lor` in a thread starts a session).
- `thread-work-header.tsx` is deleted; the session rail keeps its own file
  list and reads the plan directly, so it no longer fetches plan artifacts.
- `PlanCard` loses its open-thread paths and `MessageItem` the proposal
  card's thread footer: Lor's cards only render in sessions, where no
  thread opener is passed.
- `GET /plans/{planId}/artifacts` stays: `PlanCard` in sessions still lists
  the plan's files from it.

#### Step 8: flatten sandbox work in the tool trail (+130 / −50)

[x] built 2026-10-13 · [x] committed

- A sandbox step (one with sub-steps) opens by default and stays open when
  it completes, so its sub-steps read as flat rows under "Worked".
- `SubStepRow`: verb, mono target, diff counts, a "Failed" badge; a chip
  that opens the file when the sub-step wrote one the run delivered; one
  expansion with the diff and any output, without the repeated label or
  "Success" line. Normal tool calls are unchanged.
- `edit` and `create_artifacts` get the write glyph instead of the wrench.

#### Step 9: uploads open in the file panel (~250, bug fix)

[x] built 2026-10-13 · [x] committed

Found in QA: an uploaded CSV in the session rail opened as a link, and the
browser downloaded it.

- `?upload=<messageId>.<index>` opens an upload in the same `FilePanel` as
  `?artifactId`. The panel resolves it through the message-location API,
  which now also returns the message's attachments, so the existing access
  check applies; a raw URL in the query string would let a link point the
  panel at any site.
- The rail context's open file is `OpenFile` (artifact or upload);
  `useOpenUpload` joins `useOpenFile`, and closing clears both params.
- `UploadFileCard` opens the panel (it takes `messageId` + `index`); the
  session files API sources and the channel Files list rows
  (`attachmentIndex`) carry the position. Images keep the lightbox.

### Mobile (added 2026-10-13, Jacob: ship web and mobile together)

The server half (Steps 1, 1b, 4a, 4b, 9) already applies to the phone. These
bring `apps/mobile` in line; all JS-only, so they ship via `eas update`.

#### Step M1: native file chip (~250)

[x] built 2026-10-13 · [x] committed

- `@repo/ui/lib/file-types.ts` holds the extension → type map, shared by
  web's `FileTypeIcon` and a `react-native-svg` one in `apps/mobile`.
- Mobile `FileChip` (type icon, name, "CSV · 12 KB") replaces `PlanFileRow`
  and the message attachment rows. Taps still open the browser sheet.

#### Step M2: native file viewer (~400)

[x] built 2026-10-13 · [x] committed

- `app/file.tsx`, a modal route, for one of Lor's files or an upload
  (`artifactId`, or `messageId` + `index` through message location, which
  now returns attachments on mobile too): close, type icon, name, rows ×
  columns or version · size, Open session (hidden over that session),
  Share (the file, not its link) and Open in browser. CSVs are a
  virtualized table with a sticky header and row numbers (`CsvTable`);
  markdown and text render through `MessageContent`; images fit the
  screen; anything else, or too large, offers Share and the browser.
- `openFile` is the only way in; Lor's replies, plan cards, message uploads
  and the session sheet use it. Images in messages keep the image viewer.
- `@repo/utils/file-preview` holds the preview rules both clients follow:
  the 2 MB cap, which types preview as text, the CSV parser and the
  text-as-markdown wrapper. Web's `lib/csv.ts`, `ArtifactBody` and
  `useArtifactContent` use it.
- `lib/remote-file.ts` holds the download-to-cache and share code the
  image viewer had.

#### Step M3: session files and thread cleanup (+80 / −340)

[x] built 2026-10-13 · [x] committed

- The session sheet reads `GET /sessions/{id}/files` (same cache key as
  web, fetched when the sheet opens) merged with loaded messages, not plan
  artifacts. Uploads keep their message and position, so they open in the
  viewer.
- Deleted mobile's `ThreadWorkHeader`: it only showed on human threads,
  where Lor never works (web Step 7). With it went the thread screen's
  "Plan" title, `usePlan`, the `["plan", id]` invalidations, the
  `PlanDetail` / `PlanApproval` types, `ApprovalCardData.planId` and the
  tool trail's `embedded` prop.

#### Step M4: flatten sandbox steps in the mobile tool trail (+170 / −20)

[x] built 2026-10-13 · [x] committed

- Sandbox sub-steps are `SubStepRow`s, as on web: verb, mono target, a chip
  that opens the file in the viewer when the sub-step wrote one the run
  delivered, +N −N counts and a "Failed" badge. Tapping the row opens its
  diff and output in a capped, scrollable box.
- `write`, `edit`, `create_artifacts`, `mkdir`, `move` and `link` get the
  write glyph instead of the wrench. The sandbox step's narration still
  opens in the tool drawer.

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
- Step 5 added `FileChipLink` to `@repo/ui`: a link-backed trigger with a
  screen-reader label, because Biome rejects an empty `<a>` passed as a
  Base UI `render` element.
- Step M2 leaves `ThreadWorkHeader`'s file popover on the browser: M3
  deletes it.
- Step M2 follow-up (Jacob, QA): large CSVs lagged on the phone. `CsvTable`
  moved from `FlatList` (a wide render window, every column in every row,
  selectable cells) to LegendList with recycled fixed-height rows, and each
  row draws only the columns in view plus two either side. The header sits
  above the list. Long-press copies a cell. The file screen parses the CSV
  after the spinner shows, not during render.
