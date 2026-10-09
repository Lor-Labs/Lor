# Rich text editor and live collaboration

> Status: decision record and capability map, written 2026-10-09 from four
> research passes (TipTap, Plate, mobile editors, TipTap multiplayer pieces).
> Nothing here is built. Versions and licenses change often: re-check them
> before building. Related: `code-channels.md` §6 (Yjs for code files) and
> `artifacts.md` (the document sync primitive).

## Decision

The editor stays **TipTap** (ProseMirror). Plate was evaluated on mobile, Yjs
and features and rejected for now. Jacob's condition: stay on TipTap only if
it covers live multiplayer. It does, with MIT pieces only (see the capability
map).

| | TipTap | Plate |
|---|---|---|
| Mobile web | ProseMirror ships steady iOS/Android IME fixes | Slate: about 58 open Android issues; FAQ says Android "may have more bugs" |
| React Native | TenTap (stalled since 2025-11) or Expo DOM components | None; v54 explicitly defers mobile |
| Yjs | MIT `extension-collaboration` (y-tiptap) + MIT Hocuspocus 4 | MIT `@platejs/yjs` on slate-yjs (last release 2023), open selection bug |
| Free features | Core, mentions, markdown (beta), collaboration, drag handle, tables | Also comments, suggestions, AI menu (ai@7), DOCX |
| Paid | Comments, Tracked Changes, AI Toolkit, DOCX, Snapshots (cloud-bound, from $49/mo) | Plate Plus templates and collab sidebar UI (one-time €299/dev) |
| Stability | Weekly releases, about 21M weekly downloads | v54 replaces Slate with "Plite", hard cut: adopting v53 means migrating twice; about 2 maintainers |
| Our UI kit | No conflict | Plate UI is Radix; we use Base UI (coss) |
| Switch cost | n/a | About 3,600 lines in 11 web files |

**Revisit Plate only when** Plite (v54) is stable, ships Base UI components and
shows real mobile proof.

## Live multiplayer capability map (all MIT)

Checked against Hocuspocus 4.7.0, TipTap 3.31.4, `@tiptap/y-tiptap` 3.0.9 and
yjs 13.6.33 (package source and docs).

| Need | How | Effort |
|---|---|---|
| Co-editing | `@tiptap/extension-collaboration` + self-hosted Hocuspocus 4 | small |
| Presence | `CollaborationCaret`; extra awareness fields ("Lor is writing here") | small |
| Persistence | `@hocuspocus/extension-database` `fetch`/`store` (Yjs state as bytea in Postgres) | small |
| Auth | `onAuthenticate` (throw to reject), `connection.readOnly`, `onTokenSync` re-checks mid-session | small |
| Scale | One instance, shard by document; `extension-redis` only for HA | small |
| Offline | `y-indexeddb`; provider backoff, `maxAttempts: 0` retries forever | small |
| Per-user undo | Built in (`yUndoPlugin`); drop `UndoRedo` from StarterKit | small |
| Server conversion | y-tiptap `yXmlFragmentToProsemirrorJSON` → `@tiptap/static-renderer` (markdown/HTML), no DOM | small |
| Lor as a live participant | `hocuspocus.openDirectConnection(name).transact()`; caret via `conn.document.awareness`; stream into `Y.XmlText` or `updateYFragment` per block | medium–large, custom |
| Comments | `commentId` mark (or Yjs relative positions via `createMappablePosition`) + threads in Postgres | medium, custom UI |
| Version history | Debounced ProseMirror JSON versions + diff, or Yjs snapshots (needs `gc: false`) | medium, custom UI |
| Suggest mode (Lor proposes, people accept) | No proven Yjs-safe free package. Plan: server-written insert/delete marks, our own accept/reject | large, the one gap |
| Mobile | TipTap + provider inside an Expo DOM component | medium, unproven: spike first |

## Rules for when we build it

- **One shared extension list.** If a client's schema doesn't know a node or
  mark, y-tiptap deletes it from the shared doc for everyone. The worker, web
  and every mobile build must import the same extensions from one package,
  and new node types need a plan for old mobile builds.
- **Keep a direct connection open for a whole Lor stream.** The default
  `disconnect()` stores and unloads the document.
- **Validate server edits without a headless editor:** `getSchema(extensions)`
  and `Node.fromJSON(...).check()`.
- **Run Hocuspocus on its own port.** Sharing the Socket.IO HTTP server works
  only with engine.io `destroyUpgrade: false`. Hocuspocus 4 needs Node 22+;
  hook headers are web `Headers`.
- **Yjs is the live layer, not the durable store** (as in `code-channels.md`).
  Postgres keeps versions; restore writes old content as a new edit.
- **Comments on chat messages stay messages.** Comment marks are for documents.
- Lor's edits are not undoable with Cmd-Z (undo tracks local edits only); use
  version restore.

## Mobile

- The chat composer stays native (`react-native-enriched-markdown`; upgrade
  0.7 → 1.1, breaking config). Chat messages don't need a CRDT.
- Collaborative documents on mobile: the same TipTap build inside an Expo DOM
  component (`@expo/dom-webview`), with the Y.Doc and provider in the WebView
  and a native toolbar outside it. If Yjs ever runs in Hermes instead, lib0
  needs `isomorphic-webcrypto` installed.

## Reference implementation

Docmost runs Hocuspocus 4.5 + TipTap 3.31 with comments and version history.
It is AGPL-3.0: study the design, don't copy code. BlockNote's
`RESTYjsThreadStore` (MPL-2.0) is another thread-store design.

## Known TipTap risks

- `@tiptap/markdown` is still beta (round-trip bugs, e.g. #8432 mention labels
  with quotes, #8458 quadratic table parsing). We store messages as markdown.
- Web was on 3.20 at the time of writing; 3.31.1 had an iOS/Android Enter
  regression (#8348). Test on phones when upgrading.
- New TipTap features launch paid and cloud-bound; core and collaboration stay
  MIT per the 2026 roadmap.

## Sources

- https://tiptap.dev/docs/editor/extensions/overview
- https://tiptap.dev/blog/release-notes/were-open-sourcing-more-of-tiptap
- https://tiptap.dev/pricing
- https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release
- https://tiptap.dev/docs/hocuspocus/server/hooks
- https://github.com/ueberdosis/y-tiptap
- https://platejs.org/docs/yjs, https://pro.platejs.org/pricing
- https://github.com/udecode/plate/releases/tag/v54.0.0-beta.0
- https://github.com/ianstormtaylor/slate/blob/main/docs/general/faq.md
- https://docs.expo.dev/guides/dom-components/
- https://github.com/10play/10tap-editor
- https://github.com/software-mansion/enriched-markdown
