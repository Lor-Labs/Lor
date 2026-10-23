# Artifacts and the session sandbox (file deliverables)

As-built reference for files Lor makes and shares. Rewritten 2026-10-22 for
the Pi path: Lor works in its session's sandbox and publishes a file with
`share_file`. The old workbench (`create_artifacts`, `sandbox/workbench.ts`,
per-thread `wbs-*` sandboxes, the `/workspace/out` harvest and reseed) and
the coding child agent are deleted
([pi-harness-runbook.md](planned/pi-harness-runbook.md) 1.3d, 1.4).

## The one principle

**Postgres/R2 is where work lives; the sandbox is disposable power tooling.**
Every deliverable is an `artifact` row (identity) plus append-only
`artifact_version` snapshots (content). Sandbox files are private until
shared. Until phase 2 Git checkpoints, a lost sandbox loses its unshared
files; the conversation and shared files survive.

## Data model (`packages/db/src/schemas/artifacts.ts`)

- `artifact` — identity: `workspaceId`, `channelId`, `threadRootId` (the
  owning session's thread; null only for channel-level artifacts from before
  sessions), `planId` (provenance only), `originRunId`, `path` (logical
  filename), `mime`, `currentVersion` (0 = no committed version),
  `createdById`. Unique `(threadRootId, path)` where `threadRootId` is not
  null: within a session a path names one artifact, and sharing it again
  versions it.
- `artifact_version` — full snapshots, append-only: `version`,
  `baseVersion` (lineage), `blobKey` (R2), `size`, `contentType`,
  `authorType` (`agent | user`), `authorId`.

Deliberate choices:

- **Full snapshots, not deltas.** Storage is cheap (R2, no egress fees);
  deltas would fight the CRDT future, where Yjs updates become the delta
  layer and snapshots stay as keyframes.
- **Identity separate from content**, so collaborative editing later changes
  how content is produced without moving identity, permissions, history or
  attribution.

## The single write path

`writeArtifactVersion` (`packages/lor/src/artifacts/service.ts`) is the only
way artifact content is committed: `share_file` and `export_tool_result`
today, human edits and CRDT flushes later.

- Blobs upload to R2 **before** the version transaction: an orphaned blob is
  harmless, a version row pointing at missing bytes is not.
- Version numbers allocate atomically
  (`UPDATE current_version = current_version + 1 RETURNING`).
- Blob keys are version-independent
  (`artifacts/{workspaceId}/{artifactId}/{uuid}/{filename}`).
- Reads are public-URL-by-obscurity (`S3_PUBLIC_URL/key`), the same model as
  message attachments. ACLs and presigned GETs are a recorded punt.

**Concurrent-edit policy (decided 2026-08-08):** when a human edit surface
ships (pre-CRDT), `writeArtifactVersion` gets a version guard — reject when
`baseVersion ≠ currentVersion`; the human keeps the pointer and Lor redoes or
merges ("human wins, machine reconciles").

## The session sandbox (`packages/lor/src/sandbox/session-sandbox.ts`)

- **One per conversation:** `ses-<sessionId>` for a session, `call-<id>` for
  a voice call. It is created on the conversation's first Lor run, reused on
  every later run, and in standby between turns (the run closes its
  connection). Loops share one per Loop session; Act gets one per event.
- **Disk and lifetime:** a 2 GB `/workspace` volume (`LOR_SESSION_DISK_MB`),
  deleted by Blaxel after 7 days idle (`LOR_SESSION_SANDBOX_TTL`) or by the
  `delete-session-sandbox` job 10 minutes after the session is archived
  (Loop sessions excepted).
- **Work folder:** `/workspace/pi-<conversationId>`. Pi's built-in tools
  (`bash`, `read`, `write`, `edit`, `grep`, `glob`, `ls`) run there through
  the adapter; Pi itself runs in the worker, so the sandbox holds no Gateway
  key and no credentials for the team's services.
- **Egress limits** (`SESSION_NETWORK`, proxy firewall set at creation,
  marked with the `lor-egress` label): reads (`GET`/`HEAD`/`OPTIONS`) to any
  host, plus git fetch from GitHub, GitLab and Bitbucket and `npm audit`.
  Other requests get HTTP 403 with `Proxy-Error: firewall_blocked`. A
  sandbox without the current limits is replaced. See
  [sandbox-safety-research.md](planned/sandbox-safety-research.md) §7.
- **Health and loss:** an existing sandbox is probed; one that answers
  unhealthy is replaced, and a probe error fails the run instead of deleting
  files. A run that gets a new sandbox while earlier turns exist tells the
  model and the session that earlier files are gone.
- **Process fencing:** before a run uses an existing sandbox, commands still
  running from an earlier attempt (`run-*`/`spawn-*`) are stopped. Only one
  run works in a conversation at a time.
- **Image:** `packages/lor/sandbox-image/` (Python with pandas, matplotlib,
  openpyxl and pdfplumber, Node, git, Blaxel's `sandbox-api`), pushed with
  `bl push` as `LOR_WORKBENCH_IMAGE`, memory `LOR_WORKBENCH_MEMORY_MB`. The
  image still contains the Pi CLI, which nothing uses since 1.4.
- **Gotchas:** `fs.writeBinary` reads a string argument as a local file path,
  so content is encoded to bytes first. Blaxel's push log stream drops lines
  under load, so output is polled from the process record. Debian's git
  ignores `SSL_CERT_FILE`, so commands export `GIT_SSL_CAINFO` for the proxy
  CA.

## `share_file` (`packages/lor/src/artifacts/share-file.ts`)

- Bound in sessions when the sandbox tools are on. Takes a path relative to
  the work folder, or absolute.
- The path is resolved inside the sandbox (`realpath`), so a symlink cannot
  reach outside `/workspace`; files over `LOR_WORKBENCH_MAX_FILE_BYTES`
  (100 MB) are refused.
- Commits through `writeArtifactVersion` with the session's `threadRootId`;
  sharing the same path again publishes a new version. Returns the file's
  link, which Lor puts in its answer.
- **Files people share** reach the model as `[file: name — type, size —
  url]` lines (initial context, deltas, steering and ambient messages); Lor
  downloads one into the sandbox when the work needs it.
- **Repositories:** `clone_repo` copies a connected repository into the work
  folder; see [github-connector.md](github-connector.md).

## Web UI (apps/web)

- **Renderer registry** (`components/artifacts/artifact-body.tsx`): per-MIME
  → markdown, code, images, download fallback. CSV/TSV is handled by the
  viewer shell (full-bleed grid).
- **CSV stack:** `lib/csv.ts` (RFC-4180 parser and serializer),
  `csv-grid.tsx` (react-data-grid, pinned exact `7.0.0-beta.61`),
  `csv-preview.tsx` (in-chat compact table card). Read-only by decision
  (2026-08-09).
- **Deliverables in the message:** `share_file` results carry a typed
  `files` array on the persisted `LorToolCall`; `LorMessageBody` renders them
  at the end of Lor's message as file cards that open the right panel
  (`?artifactId`, `FilePanel`). A sandbox row that wrote a shared file shows
  its chip.

## Future contract (build against this, don't reinvent)

1. **The sync-doc primitive.** When live editing lands, Lor runs one
   workspace-scoped service: given a stable key, authorized members get a
   shared CRDT document (Yjs) plus an awareness channel. It lives in
   `apps/realtime`. Keys: `artifact:{artifactId}` for documents,
   `app:{artifactId}:{key}` for generated-app state.
2. **Sessions flush through the single write path** on idle or interval;
   identity, history and attribution never move.
3. **AI edits apply into live sessions** as CRDT transactions server-side,
   not by racing the pointer.
4. **Editing an existing file is by id, not by path.** Before live editing,
   Lor's file tools must accept an existing `artifactId` and seed it into the
   sandbox, so "update the Q3 doc" from another session edits that artifact
   instead of creating a copy.
5. **Editing a doc and a generated app's realtime state are one primitive:**
   a shared doc plus presence under a key.
6. **HTML artifacts run in sandboxed iframes** served as static bundles (R2),
   with a small Lor SDK bridging postMessage to the host page's socket.
   Blaxel sandboxes expose ports and preview URLs for authoring previews.
7. **Sandbox provider:** Blaxel, everywhere, no fallback (decided
   2026-08-09/10). Known caveat: standby persistence beyond starter quotas is
   tier-gated.

## Punts (recorded; don't re-litigate)

Artifact ACLs (public-by-obscurity stands), pptx/docx (image package
additions), diff/HTML previews, version-history UI (data is there; viewer
shows current), artifact FTS/brain integration, mobile file surfaces (see
`mobile-parity-todo.md`).
