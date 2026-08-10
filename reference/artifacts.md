# Artifacts & the workbench (task file deliverables)

As-built reference for the artifact system shipped 2026-08-08 as part of **Tasks** (the multiplayer delegated-work feature). Artifacts are the file deliverables Merlin produces: real files, made by a real coding agent in a real ephemeral sandbox, stored durably, rendered in the app. The task layer they usually belong to is documented in [`agent-harness.md`](./agent-harness.md) (Tasks section).

## The one principle

**Postgres/R2 is where work lives; the sandbox is stateless power tooling.** Every deliverable is an `artifact` row (identity) plus append-only `artifact_version` snapshots (content). The sandbox exists only for the minutes a session runs; anything worth keeping is harvested out before destroy. Losing any sandbox or checkpoint costs warmth, never work.

## Data model (`packages/db/src/schemas/artifacts.ts`)

- `artifact` — identity: `workspaceId`, `channelId`, `taskId` (nullable — plain answers produce standalone artifacts), `path` (logical filename), `mime`, `currentVersion` (0 = no committed version), `createdById`. Unique `(taskId, path)` where taskId not null: within a task, a path names one artifact and repeated writes version it.
- `artifact_version` — full snapshots, append-only: `version` (unique per artifact), `baseVersion` (lineage — what the author derived from), `blobKey` (R2), `size`, `contentType`, `authorType` (`agent | user`), `authorId`.

Deliberate choices:
- **Full snapshots, not deltas.** Storage is cents (R2, no egress fees); deltas would fight the CRDT future, where Yjs updates become the delta layer and snapshots stay as keyframes.
- **Identity separate from content** so the collaborative-editing future changes how current content is produced without moving identity, permissions, history, or attribution.

## The single write path

`writeArtifactVersion` (`packages/merlin/src/artifacts/service.ts`) is the only way artifact content is committed — sandbox harvest today; human edits and CRDT session flushes later. Mechanics:

- Blob uploads to R2 **before** the version transaction: an orphaned blob is harmless, a version row pointing at missing bytes is not.
- Version numbers allocate atomically (`UPDATE current_version = current_version + 1 RETURNING`).
- Blob keys are version-independent (`artifacts/{workspaceId}/{artifactId}/{uuid}/{filename}`) so upload and commit can't race over naming.
- Reads are public-URL-by-obscurity (`S3_PUBLIC_URL/key`), same model as message attachments. ACLs/presigned GETs are a recorded punt.
- S3 client lives in `packages/merlin/src/artifacts/storage.ts`; the worker validates all `S3_*` env at boot, no presign hop for machine writes.

**Concurrent-edit policy (decided 2026-08-08):** when a human edit surface ships (pre-CRDT), `writeArtifactVersion` gets a version guard — reject when `baseVersion ≠ currentVersion`; the human keeps the pointer, the agent's tool call gets the conflict plus the human's version back and Merlin redoes/merges ("human wins, machine reconciles"). CRDT sessions later dissolve the race entirely. Nothing is ever lost meanwhile — versions are append-only and any state is recoverable from history.

## The workbench (`packages/merlin/src/sandbox/workbench.ts`)

`runWorkbenchSession` is the seam: seed → run Pi with write tools → harvest → (task) checkpoint. It is deliberately narrow (create/exec/files/snapshot/destroy) so a sandbox-provider swap is an adapter, not a rewrite.

- **Image = provisioned checkpoint, NOT a Railway template.** Templates build on bare Debian that can't run Pi (no node 22+; `.run()` npm installs don't survive). Instead: boot the base image (ships Pi/git/node via mise), apt-install `python3-pandas python3-matplotlib python3-openpyxl` + pip `pdfplumber`, save checkpoint `workbench-base-v2` (~90s once); sessions boot from it in ~4s. Bump the version suffix to change the package set (pptx/docx later = add packages here).
- **PATH gotcha:** checkpoint boots restore the disk but lose the base image's PATH; Pi/node live behind mise shims, so every exec prefixes `PATH=/root/.local/bin:/root/.local/share/mise/shims:$PATH`.
- **Pi write mode:** `--tools read,grep,find,ls,write,edit,bash` (verified live). Brief contract: inputs in `/workspace/in`, deliverables to `/workspace/out` — everything there is delivered, nothing else is.
- **Task continuity:** task sessions boot from the task's last checkpoint (`task.sandboxCheckpoint`), run Pi with `--session-dir /workspace/.pi-sessions --session-id <taskId>` (verified: resuming does NOT re-emit prior events — no double billing), and re-checkpoint at the end (superseded checkpoint deleted). `/workspace/out` is reseeded from current artifact versions at boot so a human edit beats the checkpoint's stale copy; seed digests stop unchanged files from churning identical versions.
- **Failure never vaporizes work:** on timeout/crash the session still harvests `/workspace/out` and saves the task checkpoint; the tool result carries a `warning` telling the model to call again ("say what remains") and continue warm. Only a user stop skips harvest.
- **Caps (env, defaulted):** `MERLIN_WORKBENCH_TIMEOUT_SEC` 1200 (also clamped to the run's remaining wall clock minus a finish margin — the harness's tools-off margin doesn't account for tool runtime), `MERLIN_WORKBENCH_MAX_FILE_BYTES` 100 MB, `MERLIN_WORKBENCH_MAX_TOTAL_BYTES` 500 MB, `MERLIN_WORKBENCH_MAX_FILES` 20.
- **Abort:** the tool honors ai@7's `options.abortSignal` (user stop / lease loss / deadline) — kills Pi instead of orphaning the sandbox.

## The `create_artifacts` tool (`packages/merlin/src/artifacts/tool.ts`)

- Bound when `RAILWAY_API_TOKEN` set + channel has the `artifacts` capability + not a DM. Registered in `SIDE_EFFECT_TOOLS` with `billingKey = toolExecutionKey(name, input)` — crash recovery replays the stored manifest, never re-runs or re-bills the sandbox. Usage flows through the same `onUsage` → `noteNestedUsage` + ledger path as `investigate_code`; nested Pi steps stream as `parentToolCallId` sub-tools.
- Inputs: complete instructions + optional `inputFileUrls` (max 20) — **only URLs on our own bucket** (message attachments, prior artifacts); the model can't point the worker at arbitrary URLs.
- Returns a manifest (`path`, `contentType`, `size`, `version`, `artifactId`, `url`) + Pi's summary — never file bodies (the 256 KB tool-output cap drops oversized results wholesale).
- **File visibility convention:** non-image attachments surface to the model as `[file: name — type, size — url]` lines — in the initial context (`buildInitialUserMessage`), steer injections, and the ambient tier alike (attachment-only messages have null content and were invisible before 2026-08-08; three query sites now include them).

## Web UI (apps/web)

- **Renderer registry** (`components/artifacts/artifact-body.tsx`): per-MIME → markdown (Streamdown), code (shiki via fenced block), images, download fallback. CSV/TSV is handled by the viewer shell directly (full-bleed grid, below). New artifact types register here without touching the shell.
- **CSV stack** (2026-08-09 redesign, spec from Jacob's prior app): `lib/csv.ts` (character-level RFC-4180 parser + serializer, round-trip verified; stable `col_N` keys separate from display names, stable `__rowId` per row), `csv-grid.tsx` (**react-data-grid, pinned exact `7.0.0-beta.61`** — beta line renamed the default export to named `DataGrid`, expect API drift on bumps; virtualized, frozen row-number column, themed via `--rdg-*` vars mapped to our tokens, `rdg-dark`/`rdg-light` from next-themes `resolvedTheme`), `csv-preview.tsx` (in-chat compact table card — cheap line-parse of first rows only; the deliverable presentation for CSV artifacts in Merlin messages, other types keep the file chip). **Read-only by decision (2026-08-09): no human editing until demand proves it — edits go through Merlin or Download.** The editing layer's landing spot is designed (editor context + undo/redo from the spec; persistence = version-guarded `writeArtifactVersion`, `authorType: "user"`); grid is a leaf swap (Univer et al.) if xlsx/formulas ever arrive.
- **Takeover viewer** (`artifact-overlay.tsx`): covers the channel panel only (NOT fullscreen — workspace sidebar + right thread panel stay, so a task's CSV reads file-wide-center with the conversation beside it; Jacob rejected the fullscreen overlay), addressed by `?artifactId=` on the channel route — URL-addressable on purpose: the URL is the share link today and the multiplayer room key later. **Morphs out of the in-chat CSV preview card** via framer-motion shared `layoutId` (`artifact:{id}`; preview suppresses its layoutId while open so the pair never double-mounts; route wraps the overlay in `AnimatePresence`). Toolbar: Copy (raw contents) + Download. `min-h-0`/`min-w-0` on the grid's flex parent are load-bearing. **Only artifacts open here** (deliberate: the viewer marks "editable"); plain attachments stay links.
- **Deliverables presented in the message**: `create_artifacts` results carry a typed `files` array on the persisted `MerlinToolCall` (db type + API zod schema + `merlin:tool` event all mirror it); `MerlinMessageBody` renders them at the end of Merlin's message — CSV/TSV as the live preview card, everything else as `ArtifactFileCard` rows.
- Task surfaces: task card (`task-card.tsx`, coss `Frame` idiom — title/status in muted chrome, plan in the inset `FramePanel`, file chips in the chrome footer; full message-width, stretched-overlay click target so file chips stay interactive), task panel (thread panel re-skinned when the root is a `task_card`: header says **Task** + status badge; docked strip (`task-thread-header.tsx`) with `Plan · x/y` / `Files · n` popover chips — Files splits **Outputs** (artifacts → viewer) from **Sources** (thread uploads → plain links) — and the always-visible approval card). Live via the `task:updated` channel-room event; task list per channel via `use-channel-tasks.ts`. No global header chip (removed 2026-08-09).

## Future contract (build against this, don't reinvent)

1. **The sync-doc primitive.** When live editing lands, Lor runs one workspace-scoped service: given a stable key, authorized members get a shared CRDT document (Yjs) + an ephemeral awareness channel (cursors/presence). It lives in `apps/realtime` (auth, rooms, Redis adapter already there). Keys: `artifact:{artifactId}` for document editing; `app:{artifactId}:{key}` for generated-app runtime state.
2. **Sessions flush through the single write path.** The doc session persists by calling `writeArtifactVersion` on idle/interval — snapshots stay the keyframes; identity/history/attribution never move.
3. **AI edits apply INTO live sessions** as CRDT transactions server-side (the Notion-AI pattern), not by racing the pointer.
4. **Both multiplayer problems are one primitive:** editing a doc and a generated app's realtime state are both "shared doc + presence under a key." A multiplayer game artifact is just an app doc.
5. **HTML artifacts run in sandboxed iframes** served as static bundles (R2), with a small Lor SDK bridging postMessage → the host page's socket (the iframe never holds credentials). Dynamic behavior comes from Lor platform APIs, not from a live server per artifact. Railway sandboxes expose **no ports/preview URLs** — authoring previews and app hosting need a different provider when this lands (see below).
6. **Sandbox provider migration** (decided 2026-08-09, deferred): Railway sandboxes are beta (template system unusable for us, checkpoint PATH loss, one mid-session connection failure observed). Trigger to migrate to a dedicated provider (evaluate Daytona vs E2B head-to-head; Blaxel too young): another mid-session sandbox failure in normal use, OR HTML-artifact previews reaching the roadmap. The port is ~200 lines behind `runWorkbenchSession`/`withSandbox`; fold provider calls behind a `SandboxSession`-shaped interface (ai@7's `Experimental_SandboxSession`) as part of the port.

## Punts (recorded; don't re-litigate)

Artifact ACLs (public-by-obscurity stands), pptx/docx (workbench package additions), diff/HTML previews, version-history UI (data is there; viewer shows current), artifact FTS/brain integration, mobile task surfaces (see `mobile-parity-todo.md`), hard per-tool approval gating (approval is prompt-policy in v1).
