# TipTap composer editing behavior audit (Lor web/desktop composer, TipTap 3.32.2)

Method: static read of our composer code, traced into the installed TipTap/ProseMirror sources. Nothing was run (repo policy: no tests, no dev servers). Confidence tags: **confirmed** = code path traced end to end; **likely** = code traced, but the result depends on browser/WebKit runtime behavior; **unverified** = could not confirm from code.

Path conventions used in the citations below:
- `MI` = `apps/web/src/components/chat/composer/message-input.tsx`; `EDIT` = `apps/web/src/components/chat/message-edit-input.tsx`.
- `node_modules/@tiptap/<pkg>/src/...` resolves to `node_modules/.pnpm/@tiptap+<pkg>@3.32.2_*/node_modules/@tiptap/<pkg>/src/...`.
- `node_modules/<prosemirror-pkg>/src/...` resolves to `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/src/...` (prosemirror-view 1.42.8, prosemirror-model 1.25.12, prosemirror-commands 1.7.2, prosemirror-history 1.5.1).
- Severity: Critical / High / Medium / Low. Finding IDs (K, M, R, P, E, S, L, U, C) are cross-referenced between sections.

## Keyboard model: what each key does in each context, and where the handlers conflict

### Takeaway
Key events pass through four layers in a fixed order: the composer's `editorProps.handleKeyDown` (a direct view prop, so it runs before **every** plugin), then plugin `handleKeyDown`s (suggestion plugins and TipTap keymaps by extension priority), then the browser default. Because Enter is consumed in layer 1 everywhere and Shift+Enter falls to HardBreak's `exitCode`, there is **no keyboard way to type a second line inside a code block**. Other conflicts: Enter turns into a newline when a suggestion popup shows "No matches"; stale popups (no blur dismissal) block Enter in every composer through a document-wide DOM query; Tab moves focus out of the editor on a first list item and in code blocks; and the edit box uses capture-phase DOM listeners that bypass both ProseMirror's suggestion handling (Escape discards the edit) and its Safari IME guard.

### Cited Findings

**Handler order (basis for everything below)**
- ProseMirror `someProp` checks direct props first, then direct plugins, then state plugins — [someProp](node_modules/prosemirror-view/src/index.ts) lines 304-315. TipTap passes `editorProps` as direct view props — [Editor.ts:297-299](node_modules/@tiptap/core/src/Editor.ts). So `MI` `handleKeyDown` at lines 876-897 pre-empts the Suggestion, ListItem, ListKeymap, CodeBlock, HardBreak and core Keymap handlers — [MI:876-897](apps/web/src/components/chat/composer/message-input.tsx).
- ProseMirror's keydown handler returns before calling any `handleKeyDown` while composing, or within 500 ms of `compositionend` on Safari — [input.ts:107-110, 495-512](node_modules/prosemirror-view/src/input.ts). Capture-phase DOM listeners on `view.dom` (EDIT, and the composer's Cmd+B) run **before** that guard.

**Key matrix (composer unless noted)**

| Key | Paragraph | List item | Code block | Suggestion menu open | Edit box |
|---|---|---|---|---|---|
| Enter | send ([MI:888-896](apps/web/src/components/chat/composer/message-input.tsx)) | send | **send** (no code check) | with items: select; **with no items: newline** (K2) | save (capture, [EDIT:138-144](apps/web/src/components/chat/message-edit-input.tsx)) |
| Shift+Enter | hard break ([hard-break.ts:118](node_modules/@tiptap/extension-hard-break/src/hard-break.ts)) | split item / lift when empty ([list-shift-enter.ts:11-14](apps/web/src/components/chat/composer/list-shift-enter.ts)) | **exitCode: caret jumps to a new paragraph after the block** (K1) | **selects the highlighted item** (K5) | same as composer |
| Cmd/Ctrl+Enter | send, stay ([MI:895](apps/web/src/components/chat/composer/message-input.tsx)) | send | send | selects item | save |
| Tab | browser focus move | sink; **first item: focus leaves** (K4) | **focus leaves** (K4) | focus leaves, popup stays (K3) | same |
| Shift+Tab | Claude Code mode cycle if `onShiftTab`, else focus back ([MI:878-887](apps/web/src/components/chat/composer/message-input.tsx)) | lift (correct) | mode cycle | mode cycle | focus back |
| Backspace | joins/undoes input rule ([keymap.ts:14-51](node_modules/@tiptap/core/src/extensions/keymap.ts)); after a mention → `@` + menu (S2) | at item start: lift/join ([handleBackspace.ts](node_modules/@tiptap/extension-list/src/keymap/listHelpers/handleBackspace.ts)) | empty block → paragraph ([code-block.ts:215-228](node_modules/@tiptap/extension-code-block/src/code-block.ts)) | — | same |
| Escape | nothing (K9) | nothing | nothing | dismiss (TipTap + ours) | **always cancels the edit, even with the menu open** (K6) |

**K1 — No keyboard newline inside a code block (High, confirmed).**
- Experience: in a code block, Enter sends the half-written snippet. Shift+Enter throws the caret into a new empty paragraph **below the whole block**, even from the middle of it. Cmd+Enter sends. The only ways to get multi-line code are pasting or typing everything first.
- Cause: the composer's Enter handler has no code-block check — [MI:888-896](apps/web/src/components/chat/composer/message-input.tsx). `ListShiftEnter` handles lists only — [list-shift-enter.ts:11-14](apps/web/src/components/chat/composer/list-shift-enter.ts). HardBreak's `setHardBreak` runs `commands.exitCode()` **first** — [hard-break.ts:80-81, 117-118](node_modules/@tiptap/extension-hard-break/src/hard-break.ts). ProseMirror `exitCode` inserts a default block at `$head.after()`, i.e. after the code node regardless of caret position — [commands.ts:308-319](node_modules/prosemirror-commands/src/commands.ts). CodeBlock's own Enter (triple-Enter exit) and core `newlineInCode` are never reached, because Enter never gets to the keymaps — [code-block.ts:340-369](node_modules/@tiptap/extension-code-block/src/code-block.ts); [keymap.ts:61-67](node_modules/@tiptap/core/src/extensions/keymap.ts).
- The edit box has the same problem: capture Enter save, plus StarterKit's plain CodeBlock — [EDIT:49-54, 138-144](apps/web/src/components/chat/message-edit-input.tsx).
- Fix: in `ListShiftEnter` (or a renamed `ComposerKeymap` extension, priority > 100), bind `Shift-Enter`: if `$from.parent.type.spec.code` → `commands.newlineInCode()`. Optionally exit when Shift+Enter is pressed on an empty last line (mirroring `exitOnTripleEnter`). Optionally make plain Enter insert a newline inside code while Cmd+Enter sends (a common chat convention — unverified for Slack specifically).

**K2 — Enter inserts a newline instead of sending when the popup has no matches (High, confirmed).**
- Experience: "check /tmp" + Enter, "ask @nobody" + Enter, or "$5" + Enter in a Codex session adds a new line. A second Enter sends.
- Cause: the popup is created even when `items` is empty — [MI:307-331](apps/web/src/components/chat/composer/message-input.tsx). It renders "No matches" / "No commands" — [mention-suggestion-list.tsx:97-103](apps/web/src/components/chat/composer/mention-suggestion-list.tsx); [slash-command-list.tsx:114-120](apps/web/src/components/chat/composer/slash-command-list.tsx). It still carries `data-suggestion-open` ([MI:313-314](apps/web/src/components/chat/composer/message-input.tsx)), so the composer bails on Enter ([MI:890](apps/web/src/components/chat/composer/message-input.tsx)). The list's `onKeyDown` returns false when empty (mention list line 67, slash list line 87), so Enter falls to core `splitBlock` — [keymap.ts:61-67](node_modules/@tiptap/core/src/extensions/keymap.ts).
- Fix: don't render (or call `exitSuggestion`) when `props.items.length === 0`. Gate the composer's send-bail on "menu open **and** has items", read from the plugin state (`pluginKey.getState(view.state).active`) instead of a global `document.querySelector`.

**K3 — Stale suggestion popups survive blur and block Enter in other composers (Medium, confirmed).**
- Experience: type "@" in the channel composer, then click into the thread-panel composer (or the edit box). The @ menu stays floating, and Enter in the other editor inserts a newline instead of sending or saving.
- Cause: the Suggestion plugin state has no focus/blur logic — [state.ts:102-108](node_modules/@tiptap/suggestion/src/plugin/state.ts). Outside-click dismissal exists only in TipTap's `mount()` helper (`dismissOnOutsideClick`) — [floating-ui.ts:69-72, 111, 174-196](node_modules/@tiptap/suggestion/src/plugin/floating-ui.ts). Our custom popup manager doesn't use it — [MI:252-352](apps/web/src/components/chat/composer/message-input.tsx). The "menu open?" check is document-wide — [MI:116-117, 890](apps/web/src/components/chat/composer/message-input.tsx); [EDIT:121-122](apps/web/src/components/chat/message-edit-input.tsx).
- Fix: use `props.mount(...)` (handles placement, flip, outside-click), or call `exitSuggestion(view, pluginKey)` on editor `blur`. Scope the check to the editor's own plugin state.

**K4 — Tab escapes the editor (Medium, confirmed).**
- Experience: Tab on the first bullet (which can't indent) moves focus to the "+" button. Tab in a code block moves focus. Tab with the mention menu open moves focus and leaves the popup up.
- Cause: ListItem `Tab` → `sinkListItem`, which returns false on a first item — [list-item.ts:219-224](node_modules/@tiptap/extension-list/src/item/list-item.ts). ListKeymap explicitly defers inside list items ("Tab inside a list item belongs to sinkListItem") — [handleTab.ts](node_modules/@tiptap/extension-list/src/keymap/listHelpers/handleTab.ts), [list-keymap.ts:104](node_modules/@tiptap/extension-list/src/keymap/list-keymap.ts). CodeBlock Tab requires `enableTabIndentation` (default false) — [code-block.ts:94, 231-233](node_modules/@tiptap/extension-code-block/src/code-block.ts) — and it is not set — [MI:840-842](apps/web/src/components/chat/composer/message-input.tsx). The suggestion lists only handle ArrowUp, ArrowDown and Enter.
- Fix: inside a list, return `sinkListItem() || true` (and the same for Shift-Tab when there is no `onShiftTab`). Set `CodeBlockShiki.configure({ enableTabIndentation: true, tabSize: 2 })`. Make Tab accept the highlighted suggestion.

**K5 — Shift+Enter / Cmd+Enter with a populated menu pick the highlighted item (Medium, confirmed).** The list `onKeyDown` tests only `event.key === "Enter"` — [mention-suggestion-list.tsx:86-89](apps/web/src/components/chat/composer/mention-suggestion-list.tsx); [slash-command-list.tsx:103-106](apps/web/src/components/chat/composer/slash-command-list.tsx). A trailing "@" plus Shift+Enter inserts the first candidate (see S1: usually @channel). Fix: select only on a bare Enter or Tab.

**K6 — Edit box: Escape discards the whole edit, even when it was meant to close the @ menu (High for edits, confirmed).** The capture keydown listener on `view.dom` runs before ProseMirror/Suggestion and calls `onCancel()` unconditionally — [EDIT:124-136, 147-155](apps/web/src/components/chat/message-edit-input.tsx). Fix: move handling into `editorProps.handleKeyDown` and return false when a suggestion is active.

**K7 — Edit box IME: Enter that confirms a Japanese/Chinese candidate can save early in the desktop app (WebKit) (Medium, likely).**
- Cause: the capture listener checks only `event.isComposing` — [EDIT:138-140](apps/web/src/components/chat/message-edit-input.tsx). ProseMirror documents that on Safari, `compositionend` fires **before** the confirming Enter keydown, and guards it with a 500 ms window — [input.ts:495-512](node_modules/prosemirror-view/src/input.ts). The capture listener bypasses that guard.
- The main composer is protected, because it handles Enter in `editorProps.handleKeyDown`, which ProseMirror only calls after the guard ([input.ts:107-110](node_modules/prosemirror-view/src/input.ts)).
- Fix: same as K6, plus check `event.keyCode === 229`.

**K8 — Cmd+Shift+S in the thread panel or session view toggles strikethrough AND opens the subscribers picker (Low-Medium, confirmed).** Strike binds `Mod-Shift-s` — [strike.ts:113](node_modules/@tiptap/extension-strike/src/strike.ts). ThreadSubscribers' window keydown ignores `defaultPrevented` and editable targets — [thread-subscribers.tsx:134-145](apps/web/src/components/chat/thread-subscribers.tsx). It is mounted beside composers at [thread-panel.tsx:620](apps/web/src/components/sidebar/right-panel/thread-panel.tsx) and [session-view.tsx:549](apps/web/src/components/session/session-view.tsx). Fix: skip when `event.defaultPrevented` or the target is contenteditable.

**K9 — Escape in the composer does nothing (Low, confirmed).** There is no Escape branch ([MI:876-897](apps/web/src/components/chat/composer/message-input.tsx)); a reply can only be cancelled with the × button ([MI:1422-1433](apps/web/src/components/chat/composer/message-input.tsx)). Fix: with no menu open, Escape cancels the reply.

**K10 — Arrow keys around code blocks change the document (Low, confirmed).** ArrowUp at offset 0 of a code block that is the first node inserts an empty paragraph above it (`exitOnArrowUp`). ArrowDown at the end of the last block runs `exitCode` — [code-block.ts:91-92, 372-434](node_modules/@tiptap/extension-code-block/src/code-block.ts). Both add undo steps. TrailingNode already guarantees a paragraph after the block ([starter-kit.ts:268](node_modules/@tiptap/starter-kit/src/starter-kit.ts)). Fix: `exitOnArrowUp: false`.

**Cmd+B is correct (confirmed).** The composer's capture listener toggles bold and calls `preventDefault`, so ProseMirror's handler skips the event and the sidebar's window-level ⌘B listener doesn't fire — [MI:1209-1232](apps/web/src/components/chat/composer/message-input.tsx); [sidebar.tsx:125-138](packages/ui/src/components/sidebar.tsx). Cmd+K always opens the workspace palette from a document listener ([workspace-command.tsx](apps/web/src/components/sidebar/channel-panel/workspace-command.tsx) around line 104), so no link shortcut exists (see L1).

**Verification of the recent changes the owner listed**
- `ListShiftEnter` is correct. Priority 101 beats HardBreak's `Shift-Enter`. It tries `splitListItem` then `liftListItem` — [list-shift-enter.ts:5-17](apps/web/src/components/chat/composer/list-shift-enter.ts). On an empty nested item, TipTap's `splitListItem` splits the parent item (outdent); on an empty top-level item it fails and `liftListItem` makes a paragraph.
- One edge: a code block **inside** a list item (reachable by typing ``` + Space inside an item). `isActive("listItem")` is true there, so Shift+Enter splits the list item through the code block instead of adding a newline. Check `spec.code` first (this folds into the K1 fix).
- "Enter always sends" is implemented at [MI:888-896](apps/web/src/components/chat/composer/message-input.tsx) (see K1/K2 for its gaps). The placeholder hides when the first child is not a paragraph ([MI:932-942](apps/web/src/components/chat/composer/message-input.tsx)). Shift+Tab outdents in lists ([MI:878-887](apps/web/src/components/chat/composer/message-input.tsx)). List CSS is present in both editors ([MI:874](apps/web/src/components/chat/composer/message-input.tsx), [EDIT:83](apps/web/src/components/chat/message-edit-input.tsx)).

### Inferences
- The structural cause is three key-handling mechanisms (editorProps in the composer, capture DOM listeners in the edit box, TipTap keymaps) plus a global DOM query standing in for suggestion state. One shared high-priority `ComposerKeymap` extension plus one `editorProps.handleKeyDown` used by both editors would remove K1, K2, K3, K5, K6 and K7 together.
- K1 and K2 are high-frequency for a team-chat-plus-coding-agent product: users paste paths (`/src/...`) and write code to Lor.

### Gaps
- No runtime check. K7 depends on WebKit IME event order, inferred from ProseMirror's own comment.
- Slack's exact key conventions (Enter in code blocks and lists, Escape on a reply) were not checked against a source.

## Markdown shortcuts (input rules) and WYSIWYG mismatches between composer and sent message

### Takeaway
Shortcuts work only at the **start of a textblock**. Since Enter sends and Shift+Enter inserts hard breaks, every multi-line message is one paragraph. So `- `, `1. `, ```` ``` ````, `**`, `*` and `~~` silently fail on every line after the first, while inline `` `code` `` still works. Meanwhile the serializer escapes only inline characters (`` \ ` * _ [ ] ~ ``, plus `& < >`). Block syntax typed or pasted literally (`# `, `> `, `- `, `1. `, `---`, `|` tables) is sent unescaped and **renders formatted** in the message, though the composer showed plain text. Underline can be applied but vanishes when rendered.

### Cited Findings

**M1 — Line-start shortcuts are dead after Shift+Enter (High, confirmed).**
- Experience: "Plan:" ⇧↵ "- do x" ⇧↵ "- do y" stays plain dashed text in the composer, but renders as a real bulleted list once sent, because a CommonMark list can interrupt a paragraph. "**bold**" at the start of line 2 doesn't convert. "```" + Space on line 2 doesn't make a code block.
- Cause: input rules match against the text from the start of the textblock, and a hardBreak contributes the string `'%leaf%'` — [getTextContentFromNodes.ts](node_modules/@tiptap/core/src/helpers/getTextContentFromNodes.ts); [InputRule.ts:237](node_modules/@tiptap/core/src/InputRule.ts). The rules are anchored: bullet `^\s*([-+*])\s$` ([bullet-list.ts:50](node_modules/@tiptap/extension-list/src/bullet-list/bullet-list.ts)); ordered `^(\d+)\.\s$` ([ordered-list.ts:57](node_modules/@tiptap/extension-list/src/ordered-list/ordered-list.ts)); fence `^```([a-z]+)?[\s\n]$` ([code-block.ts:73](node_modules/@tiptap/extension-code-block/src/code-block.ts)); strike `(?:^|\s)(~~…` ([strike.ts:37](node_modules/@tiptap/extension-strike/src/strike.ts)); italic `(?:^|\s)(\*…` ([italic.ts:37, 47](node_modules/@tiptap/extension-italic/src/italic.ts)); bold is the same shape. The code rule `(^|[^`])` accepts the `f` of `%leaf%`, so only inline code works after a break ([code.ts:37](node_modules/@tiptap/extension-code/src/code.ts)).
- Fix options: (a) make Shift+Enter in a plain paragraph `splitBlock`, so each line is its own textblock and every rule works per line. This changes serialization to `"\n\n"` between lines ([document.ts:12-18](node_modules/@tiptap/extension-document/src/document.ts)), so either tighten rendered `p` spacing for user messages or post-join sibling paragraphs with hard breaks. (b) Keep hard breaks but register duplicate input rules whose `find` accepts `(?:^|%leaf%)` before the marker (works, but relies on an internal sentinel). (c) Remap Enter-in-list/Shift+Enter-after-break heuristics. (a) is the most robust.

**M2 — Literal block markdown renders formatted after send (High, confirmed).**
- Experience: typing "# Title", "> quote", "---", "1) step" or a `| a | b |` table shows plain text in the composer (heading, blockquote and horizontalRule are disabled — [MI:833-835](apps/web/src/components/chat/composer/message-input.tsx)), but the sent message shows a heading, quote, rule, list or table.
- Cause: TipTap escapes only `/([\\`*_[\]~])/` in text — [MarkdownManager.ts:1187-1213](node_modules/@tiptap/markdown/src/MarkdownManager.ts) — plus `&<>` → entities ([htmlEntities.ts:72-74](node_modules/@tiptap/core/src/utilities/htmlEntities.ts)). The renderer styles h1–h6, hr and tables, and prose styles blockquotes — [globals.css:362-381](packages/ui/src/styles/globals.css); [message.tsx table components](packages/ui/src/components/nexus-ui/message.tsx).
- Fix: decide per construct. Enable Blockquote in the editor (most chat apps support quotes), keep headings off but escape line-leading `#`, `>` (if quotes stay off), `+`/`-`/`*` + space, `\d+[.)]` + space, `|`, and setext `===`/`---` lines in `storedText`, outside code fences. Alternatively, render user messages with headings mapped to bold.

**M3 — Blank lines collapse (Medium, confirmed).**
- Experience: two Shift+Enters show a full empty line (20 px) in the composer. The sent message shows a ~6 px paragraph gap, and three or more Shift+Enters collapse into one gap.
- Cause: hardBreak serializes as `"  \n"` ([hard-break.ts:67](node_modules/@tiptap/extension-hard-break/src/hard-break.ts)), so an empty line becomes a whitespace-only line, which CommonMark treats as a paragraph break; runs of blank lines collapse. Rendered paragraph margin is `my-1.5` ([globals.css:343](packages/ui/src/styles/globals.css)) versus the composer's `[&_p]:m-0` ([MI:874](apps/web/src/components/chat/composer/message-input.tsx)).
- Fix: mirror TipTap Paragraph's own trick, which emits `&nbsp;` for 2nd+ consecutive empty paragraphs ([paragraph.ts:29, 108-119](node_modules/@tiptap/extension-paragraph/src/paragraph.ts)), for consecutive hard breaks. Note that `storedText` currently rewrites ` ` → space ([editor-utils.ts:43](apps/web/src/lib/editor-utils.ts)).

**M4 — Underline (Cmd+U) is editable but invisible after send (Medium, confirmed).**
- StarterKit 3 bundles Underline ([starter-kit.ts:264](node_modules/@tiptap/starter-kit/src/starter-kit.ts)), and it serializes as `<u>…</u>` ([underline.ts:68-70](node_modules/@tiptap/extension-underline/src/underline.ts)). The hast-util-sanitize default schema, which Streamdown extends, has no `u` tag (it has `ins`) — [schema.js](node_modules/.pnpm/hast-util-sanitize@5.0.2/node_modules/hast-util-sanitize/lib/schema.js) line 177 area. So the tag is stripped (unverified at runtime that Streamdown keeps the children). Lor also receives raw `<u>`.
- Fix: `StarterKit.configure({ underline: false })` in both editors ([MI:832](apps/web/src/components/chat/composer/message-input.tsx), [EDIT:49](apps/web/src/components/chat/message-edit-input.tsx)).

**M5 — Styling mismatches between composer and message (Low-Medium, confirmed).**
- Composer inline code is violet `bg-primary/10` + border ([MI:874](apps/web/src/components/chat/composer/message-input.tsx)). Rendered inline code is neutral `bg-accent`, and the globals comment says the violet bordered pill "read like an @mention" ([globals.css:412-434](packages/ui/src/styles/globals.css)).
- Composer paragraphs have `m-0`; rendered ones have `my-1.5`.
- In code blocks, the root's `[&_pre]:px-2 [&_pre]:py-1.5` (selector `.x pre`, higher specificity) overrides code-block-view's `px-3 py-2`, and both the wrapper and the `pre` paint `bg-muted/50` — [code-block-view.tsx:51, 73](apps/web/src/components/chat/composer/code-block-view.tsx); [MI:874](apps/web/src/components/chat/composer/message-input.tsx).
- Fix: move the composer typography into a `.composer-prose` block in globals.css that mirrors `.message-markdown` tokens.

**M6 — Typing ``` + Enter sends a literal "```" (Low-Medium, confirmed).** The fence rule needs a whitespace character typed after the backticks ([code-block.ts:73](node_modules/@tiptap/extension-code-block/src/code-block.ts)). TipTap's InputRule Enter path never runs because the composer's `editorProps` consumes Enter first ([MI:888-896](apps/web/src/components/chat/composer/message-input.tsx)). Fix: in the keymap, Enter on a paragraph whose text is exactly ```` ```lang? ```` converts to a code block instead of sending.

### Inferences
- M1 plus M2 explain much of the "janky" feeling. What you see while typing (plain dashes) differs from what lands (a list), and the shortcuts work only on the first line.

### Gaps
- Whether the product wants headings in user messages at all is a product decision, not answerable from code.

## Markdown round-trip: getMarkdown → toStoredMarkdown → stored → rendered; edit-box reload; drafts

### Takeaway
Sending is mostly faithful but has a **destructive post-processing regex** (anything between two `++` is deleted, including in code), entity-encodes `& < >`, and escapes command names. Editing a sent message is **broken**: stored markdown is loaded as HTML, so formatting, newlines, mentions and links are flattened, then re-escaped on save, even when nothing was changed. Drafts round-trip losslessly as JSON. But channel and DM composers share one editor instance, and its undo history spans conversations.

### Cited Findings

**R1 — Editing a message destroys its formatting, line breaks, mentions and links (Critical, confirmed).**
- Experience: open Edit on a message such as `**Ship it** <@uuid>⏎- a⏎- b`. The box shows `**Ship it** <@uuid> - a - b` on **one line**. Save, even with no change, stores `\*\*Ship it\*\* &lt;@uuid&gt; - a - b`. The message now shows literal asterisks and a raw `<@uuid>`, the list has collapsed into one item, and it is marked "(edited)". Code fences flatten to one line with escaped backticks. Links become escaped `\[label\](url)` text.
- Cause:
  - `useEditor({ content: withLinearIssueNodes(initialContent) })` passes no `contentType: "markdown"` — [EDIT:79](apps/web/src/components/chat/message-edit-input.tsx); [linear-issue-node.tsx:31-45](apps/web/src/components/chat/composer/linear-issue-node.tsx) (the comment there admits "an editor that loads stored text as HTML").
  - The Markdown extension parses markdown **only** when `contentType` is set — [Extension.ts:106-120, 189-191](node_modules/@tiptap/markdown/src/Extension.ts). Otherwise the string goes to the HTML path — [elementFromString.ts:17-29](node_modules/@tiptap/core/src/utilities/elementFromString.ts); [createNodeFromContent.ts](node_modules/@tiptap/core/src/helpers/createNodeFromContent.ts).
  - ProseMirror's DOMParser collapses `[ \t\r\n]+` to one space — [from_dom.ts:448](node_modules/prosemirror-model/src/from_dom.ts). `<@` is not a valid tag start in HTML, so it stays as literal text.
  - On save, text is entity-encoded and backslash-escaped — [MarkdownManager.ts:1199](node_modules/@tiptap/markdown/src/MarkdownManager.ts) — so the mention regex no longer matches.
  - The "unchanged" check compares the re-serialized string with the original — [EDIT:109-113](apps/web/src/components/chat/message-edit-input.tsx).
- Fix: load with `contentType: "markdown"` after converting stored `<@uuid>` back to TipTap mention syntax `[@ id="…" label="…"]` (labels from `message.mentions` or candidates) and Linear blocks to nodes. Share the composer's extension list (CodeBlockShiki, ConnectorChip, RepoFileChip, slash commands, Underline off) through one `composerExtensions()` factory. Compare normalized output. `instructions-section.tsx` already does markdown load and save correctly — [instructions-section.tsx:114-137, 176, 190](apps/web/src/components/workspace/instructions-section.tsx).
- Related: the edit box lacks `DesktopCaret` (the WKWebView stale-caret workaround) — whether that bug shows there is unverified. It also re-focuses to the end 200 ms after mount, which can move a caret the user already placed — [EDIT:86, 91-98](apps/web/src/components/chat/message-edit-input.tsx).

**R2 — `storedText` deletes text between any two `++` (High, data loss, confirmed).**
- Experience: "C++ is fine, but C++ templates…" is stored as "C is fine, but C templates…". A code block `for (i=0;i<n;i++) { j++ }` becomes `for (i=0;i<n;i) { j }`. The regex is lazy but `[\s\S]` spans lines, so two `++` far apart in different blocks also eat everything between them.
- Cause: `.replace(/\+\+([\s\S]+?)\+\+/g, "$1")` (plus a `++[..](..)++` variant) — [editor-utils.ts:44-47](apps/web/src/lib/editor-utils.ts). It was written for an older TipTap that wrapped unknown marks in `++`. In 3.32.2 Link serializes `[text](href)` ([link.ts:371-377](node_modules/@tiptap/extension-link/src/link.ts)) and Underline `<u>` ([underline.ts:68-70](node_modules/@tiptap/extension-underline/src/underline.ts)). Nothing in the editor emits `++`, and `+` is not in the escape set.
- Fix: delete both `++` regexes.

**R3 — The other `storedText` regexes also run inside code (Low-Medium, confirmed).** `[x](x)` → `x` ([editor-utils.ts:49](apps/web/src/lib/editor-utils.ts)) rewrites markdown examples inside code blocks and inline code. NBSP → space applies everywhere ([editor-utils.ts:43](apps/web/src/lib/editor-utils.ts)). Fix: do these transformations at node level. A custom Mention `renderMarkdown` can emit `<@id>` (and `@channel`) directly. Link `renderMarkdown` can emit a bare URL when text === href. Then drop the regex post-processing.

**R4 — Stored content is entity-encoded (Medium, confirmed).** "a & b", "x > 5" and "<div>" are stored as `a &amp; b`, `x &gt; 5`, `&lt;div&gt;` — [htmlEntities.ts:72-74](node_modules/@tiptap/core/src/utilities/htmlEntities.ts) via [MarkdownManager.ts:1199](node_modules/@tiptap/markdown/src/MarkdownManager.ts). The markdown renderer decodes them, but Lor's prompt and any plain-text surface see the entities. Which previews or notifications show raw content is unverified.

**R5 — Harness slash commands receive escaped text (Medium, confirmed).** `/pr_comments` (any command or skill name with `_`) is stored as `/pr\_comments`. The worker passes the raw stored content as the command — [lor-respond.ts:891-905](apps/worker/src/jobs/lor-respond.ts). `parseHarnessCommand` matches names exactly, so the command is not recognized and becomes a normal prompt — [harness-commands.ts:292-297](packages/lor/src/harness-commands.ts). Arguments containing `* _ & < >` also arrive escaped or encoded. Fix: insert harness commands as text that serializes raw (an atom node, or code-marked text), or unescape command text before matching.

**R6 — A mention label containing `]` leaves residue (Low, confirmed).** Mention serializes as `[@ id="…" label="…"]` ([mention.ts:279-283](node_modules/@tiptap/extension-mention/src/mention.ts)). Our regex `\[@[^\]]*?\bid="([^"]+)"[^\]]*]` stops at the first `]` — [editor-utils.ts:27](apps/web/src/lib/editor-utils.ts) — so "Bob [Eng]" leaves `"]` in the message. The R3 fix (custom `renderMarkdown`) removes this.

**R7 — `plaintext` is written into every fence (Low, confirmed).** `defaultLanguage: "plaintext"` ([MI:840-842](apps/web/src/components/chat/composer/message-input.tsx)) is serialized as a ```` ```plaintext ```` fence ([code-block.ts:181-193](node_modules/@tiptap/extension-code-block/src/code-block.ts)).

**R8 — Drafts are exact, but undo history spans channels (Medium, confirmed).**
- Drafts are stored as TipTap JSON in localStorage and restored with `setContent` — [composer-drafts.ts:14-41](apps/web/src/lib/composer-drafts.ts); [MI:989-1009](apps/web/src/components/chat/composer/message-input.tsx). That is lossless for text, marks, mentions, chips and code language. Attachments are not kept ([composer-drafts.ts:3-5](apps/web/src/lib/composer-drafts.ts)). The draft is written synchronously on every update.
- The channel and DM composers have **no `key`**, while their MessageLists do — [$channelId.tsx:633-634 vs 576](apps/web/src/routes/_authenticated/$workspaceSlug/$channelId.tsx); [$dmId.tsx:280-281 vs 257](apps/web/src/routes/_authenticated/dms/$dmId.tsx). Thread and session composers are keyed. So one editor and one undo stack serve every channel.
- `setContent` and `clearContent` are ordinary history steps (`tr.replaceWith`, no `addToHistory:false`) — [setContent.ts:51-69](node_modules/@tiptap/core/src/commands/setContent.ts); [clearContent.ts:21-25](node_modules/@tiptap/core/src/commands/clearContent.ts). Cmd+Z right after switching channels brings the previous channel's draft back into this one, and the update listener saves it as this channel's draft.
- Fix: `key={channelId}` / `key={dmId}` on MessageInput, or restore inside a transaction with `addToHistory: false` and reset history.

**R9 — Linear-issue paste drops blank lines in the surrounding text (Low, confirmed).** `paragraphs()` filters empty lines — [linear-issue-node.tsx:48-56](apps/web/src/components/chat/composer/linear-issue-node.tsx).

**Other serializer facts (confirmed).** Lists are tight (`"\n"` between items) and blocks are joined with `"\n\n"` — [bullet-list.ts:97-103](node_modules/@tiptap/extension-list/src/bullet-list/bullet-list.ts); [document.ts:12-18](node_modules/@tiptap/extension-document/src/document.ts). Nested items under ordered lists align to the marker (`alignNestedToPrefix`) — [list-item.ts:181-208](node_modules/@tiptap/extension-list/src/item/list-item.ts). The trailing empty paragraph from TrailingNode serializes to `""` and is trimmed — [paragraph.ts:100-122](node_modules/@tiptap/extension-paragraph/src/paragraph.ts).

### Inferences
- The `toStoredMarkdown` regex layer exists to patch serializer output after the fact. Moving those concerns into node `renderMarkdown`s (mention, link, chip) makes send and edit symmetrical and removes R2, R3 and R6.

### Gaps
- Which non-markdown surfaces (push notifications, sidebar previews, search snippets) display `message.content` raw, and so show `&amp;` or `\_`, was not audited.

## Paste behavior (plain markdown, rich HTML, IDE code, URLs, large text, files)

### Takeaway
A plain-text paste becomes one paragraph per line, blank lines dropped. Inline markdown is converted by paste rules but block markdown is not, and on send the fence backticks get escaped, so pasted fenced code renders as double-spaced paragraphs. IDE code becomes paragraphs (indentation kept) rather than a code block, unless VS Code's custom MIME is readable. Rich HTML loses headings and quotes. Large pastes silently become a `.txt` attachment. Connector URLs become chips even inside code blocks.

### Cited Findings

**P1 — Pasted markdown is half-converted (High, confirmed).**
- ProseMirror treats a no-HTML paste as text: it splits on `/(?:\r\n?|\n)+/` into `<p>`s (blank lines lost) — [clipboard.ts:48, 63, 86](node_modules/prosemirror-view/src/clipboard.ts).
- Mark paste rules convert `**b**`, `*i*`, `` `c` `` and `~~s~~` — [bold.tsx:151-157](node_modules/@tiptap/extension-bold/src/bold.tsx); [italic.ts:42, 52](node_modules/@tiptap/extension-italic/src/italic.ts); [code.ts:44](node_modules/@tiptap/extension-code/src/code.ts); [strike.ts:42](node_modules/@tiptap/extension-strike/src/strike.ts).
- The Markdown extension adds no paste handling — [Extension.ts](node_modules/@tiptap/markdown/src/Extension.ts), which defines only commands and storage.
- Result on send: `- ` and `# ` lines render as a list or heading (M2). Fence lines are escaped to `` \`\`\` ``, so the code shows as one paragraph per line with `my-1.5` gaps. Lines indented four or more spaces become accidental indented code blocks.
- Fix: a `handlePaste` / `clipboardTextParser` that detects markdown (fences, list or heading markers on several lines) in `text/plain` and inserts `editor.markdown.parse(text)` (or `insertContent(text, { contentType: "markdown" })`), with headings mapped to bold paragraphs.

**P2 — Code pasted from an IDE becomes paragraphs (Medium, confirmed / likely).**
- VS Code HTML uses `white-space: pre`, which ProseMirror honors ([from_dom.ts:483](node_modules/prosemirror-model/src/from_dom.ts)). Each line becomes a paragraph with its indentation, and is double-spaced when rendered.
- TipTap's VS Code handler makes a code block only if `vscode-editor-data` is readable — [code-block.ts:457-511](node_modules/@tiptap/extension-code-block/src/code-block.ts) (line 475). In the Tauri WKWebView, a Chromium-private clipboard format is probably not exposed (likely, unverified).
- JetBrains and terminal pastes take the plain-text path.
- Fix: treat a multi-line paste with consistent leading indentation, or code-like syntax, as a code block. Offer "Paste as code" (e.g. Cmd+Shift+V in a code context) or convert after paste with an undoable toast.

**P3 — Rich HTML (web, Google Docs, Notion, Slack) (Medium, confirmed).** With heading, blockquote and hr disabled ([MI:833-835](apps/web/src/components/chat/composer/message-input.tsx)), `<h1>`–`<h6>` and `<blockquote>` become plain paragraphs, `<hr>` and images are dropped, and tables flatten. Underline survives in the editor, then disappears on send (M4). `<pre>` becomes a code block with its `language-*` class ([code-block.ts:113-145](node_modules/@tiptap/extension-code-block/src/code-block.ts)). Bold parsing ignores Google Docs' `font-weight:normal` wrapper ([bold.tsx:72](node_modules/@tiptap/extension-bold/src/bold.tsx)). Fix: a `transformPastedHTML` that maps headings to `<p><strong>`, and enable blockquote.

**P4 — Large paste silently becomes `pasted-text.txt` (Low-Medium, confirmed).** Any `text/plain` over 4,000 characters, including into a code block, and including rich HTML whose plain text is long, becomes an attachment with no notice — [MI:108-112, 898-917](apps/web/src/components/chat/composer/message-input.tsx). Fix: a toast with "Paste as text instead".

**P5 — A connector URL pasted into a code block becomes a chip (Low-Medium, confirmed).** ConnectorChip's `handlePaste` has no code-context check — [connector-chip.tsx:137-149](apps/web/src/components/chat/composer/connector-chip.tsx). Contrast LinearIssue ([linear-issue-node.tsx:118](apps/web/src/components/chat/composer/linear-issue-node.tsx)) and RepoFileChip ([repo-file-chip.tsx:120-129](apps/web/src/components/chat/composer/repo-file-chip.tsx)). `replaceSelectionWith` an inline atom inside a `text*`, no-marks node forces ProseMirror to split or fit around the code block (exact result unverified). Fix: `if (view.state.selection.$from.parent.type.spec.code) return false`.

**P6 — Mixed file + text clipboards insert both (Low, likely).** `editorProps.handlePaste` returns false whenever files exist ([MI:899-900](apps/web/src/components/chat/composer/message-input.tsx)). ProseMirror then still inserts the HTML or text part, and the wrapper's React `onPaste` adds the files ([MI:1372-1381, 1456](apps/web/src/components/chat/composer/message-input.tsx)). For pure-image clipboards (screenshots) nothing extra is inserted. Whether Finder file copies expose the filename as `text/plain` is unverified. Fix: when files are present, `preventDefault`, call `addFiles`, return true.

**P7 — URLs (confirmed).** Pasting a URL over a selection makes a link (`linkOnPaste`, [MI:844-854](apps/web/src/components/chat/composer/message-input.tsx)); this is the only way to create a titled link (L1). A bare connector URL on its own becomes a chip ([connector-chip.tsx:135-149](apps/web/src/components/chat/composer/connector-chip.tsx)). A Linear "Copy as prompt" block becomes a card, even above the 4,000-character threshold ([MI:904-910](apps/web/src/components/chat/composer/message-input.tsx)).

### Inferences
- Users paste AI-generated markdown and code into an AI-team product constantly. P1 and P2 are likely among the most visible "janky" moments.

### Gaps
- Clipboard MIME exposure in WKWebView (the VS Code format, Finder files) needs a manual check in the desktop app.

## Placeholder, empty state, `isEmpty`, and send-button logic

### Takeaway
Placeholder and send gating are mostly coherent. The gaps are silent no-ops: Enter during an upload or while sending is blocked, no client-side length guard, and a ghost typing indicator emitted by the post-send clear.

### Cited Findings
- **E1 (correct, confirmed).** `isEmpty` uses `isNodeEmpty(doc)`, which treats an empty list as empty. The placeholder also requires the first child to be a paragraph — [MI:926-942](apps/web/src/components/chat/composer/message-input.tsx); [isNodeEmpty.ts:6-62](node_modules/@tiptap/core/src/helpers/isNodeEmpty.ts); [Editor.ts:844-846](node_modules/@tiptap/core/src/Editor.ts).
- **E2 (Low, confirmed).** A whitespace-only or hard-break-only draft hides the placeholder (`isEmpty` false), but send stays disabled (`plainText.trim()`) — [MI:1234-1239](apps/web/src/components/chat/composer/message-input.tsx). Option: `isNodeEmpty(doc, { ignoreWhitespace: true })` treats hard breaks and whitespace as empty — [isNodeEmpty.ts:22-30](node_modules/@tiptap/core/src/helpers/isNodeEmpty.ts).
- **E3 (Medium, confirmed).** Enter while attachments are uploading does nothing (`if (!editor || isUploading) return`), with no queued send and no message — [MI:1085](apps/web/src/components/chat/composer/message-input.tsx). Same for `sendBlocked` and `isSending` ([MI:1094](apps/web/src/components/chat/composer/message-input.tsx)). Fix: queue the send until the upload finishes, or show why it is blocked.
- **E4 (Low-Medium, confirmed / unverified impact).** No client-side check against `MESSAGE_CONTENT_MAX_LENGTH = 20000` ([events.ts:155](packages/realtime-types/src/events.ts)). Escaping and entities inflate the length. The editor is cleared right after `onSend`, before any server ack ([MI:1120-1139](apps/web/src/components/chat/composer/message-input.tsx)). Whether rejected content is recoverable is unverified.
- **E5 (Low-Medium, confirmed).** Ghost "is typing" after send. `clearContent(true)` emits `update` → `onTyping` ([MI:919-921, 1135](apps/web/src/components/chat/composer/message-input.tsx)) → `typing:start` (throttled 3 s, [use-typing-indicator.ts:34-40](apps/web/src/hooks/use-typing-indicator.ts)), relayed as `typing:update` ([realtime index.ts:1329-1346](apps/realtime/src/index.ts)). Receivers keep a typer for 5 s (`TYPING_EXPIRE_MS`) and never clear it when that person's message arrives. Fix: `clearContent(false)` plus an explicit draft clear, and/or clear a typer on message arrival.
- **E6 (Low, confirmed).** The inline (session document) variant still caps the editor at 200 px with its own scroller (`max-h-[200px] overflow-y-auto overscroll-contain`) — [MI:1625-1628](apps/web/src/components/chat/composer/message-input.tsx). Long replies scroll inside a box inside a scrolling page.

### Inferences
- E3 and E5 are small but read as "the app ignored me" or "phantom activity". Both are cheap fixes.

### Gaps
- Server behavior for over-length messages was not traced.

## Mentions, slash commands, skill mentions, connector and repo-file chips

### Takeaway
The biggest hazard is ranking. Broadcasts are listed first and preselected, with substring matching, so "@" + Enter or "@l" + Enter inserts **@channel**. Backspacing a mention reopens the menu, which makes this easy to trigger by accident. Popups never flip below the caret, never scroll the active row into view, and don't close on blur. Chips are reasonably built (atoms with a trailing space).

### Cited Findings

**S1 — "@" + Enter (or "@l" / "@e" + Enter) inserts @channel (High, confirmed).**
- Channel composers prepend @channel, @here and (in workspace-audience channels) @everyone — [use-mention-candidates.ts:57-64](apps/web/src/hooks/use-mention-candidates.ts); [broadcast-mentions.ts:9-34](apps/web/src/lib/broadcast-mentions.ts).
- The list forces broadcasts above people and starts at index 0 — [mention-suggestion-list.tsx:33-44](apps/web/src/components/chat/composer/mention-suggestion-list.tsx).
- Filtering is a substring test on label **or** search text — [MI:359-368](apps/web/src/components/chat/composer/message-input.tsx). "channel" contains l, e, a, n, h, c, and the search strings "here online…" and "everyone all…" contain "l".
- So typing "@l" to reach Lor highlights @channel, which notifies everyone.
- Fix: rank by prefix match on the name (then word-start, then substring); put broadcasts last, or show them only when the query prefixes their name; boost Lor and recent people.

**S2 — Backspace on a mention turns it into "@" and reopens the menu (Medium, confirmed).** The Mention Backspace handler replaces the node with its trigger char, because `deleteTriggerWithBackspace` defaults to false — [mention.ts:168, 325-357](node_modules/@tiptap/extension-mention/src/mention.ts). Deleting a mention takes two keystrokes, and an Enter in between re-inserts the top candidate (S1). Fix: `Mention.configure({ deleteTriggerWithBackspace: true })` in both editors.

**S3 — Active row is not scrolled into view; hover and keyboard highlights disagree (Medium, confirmed).** Mention list `max-h-64` with up to 8 rows (two-line broadcast rows); slash list `max-h-60` with two-line rows — [mention-suggestion-list.tsx:106](apps/web/src/components/chat/composer/mention-suggestion-list.tsx); [slash-command-list.tsx:123](apps/web/src/components/chat/composer/slash-command-list.tsx). Neither calls `scrollIntoView` on `selectedIndex`. That the rows overflow the max height is inferred from their sizes. Hover adds a second highlight (`hover:bg-accent/70`) without moving `selectedIndex`.

**S4 — Popup always opens above the caret and never flips (Medium, confirmed).** `top = max(8, rect.top − height − 6)` — [MI:271-292](apps/web/src/components/chat/composer/message-input.tsx). When the composer sits near the top (new session view, a short session document), the popup clamps to the viewport top and covers the line being typed. TipTap 3.32's Suggestion supplies `placement`, `flip` and `mount` (floating-ui) in its props — [view.ts:130-157](node_modules/@tiptap/suggestion/src/plugin/view.ts). Fix: use `props.mount`, which also gives outside-click dismissal (K3).

**S5 — Trigger rules (Low-Medium, confirmed).** `allowedPrefixes` defaults to `[' ']` — [suggestion.ts:49](node_modules/@tiptap/suggestion/src/suggestion.ts). Matching looks only at the text node directly before the caret — [findSuggestionMatch.ts](node_modules/@tiptap/suggestion/src/findSuggestionMatch.ts). So "(@bob" or "\"@bob" never trigger. But "/" or "@" typed right after bold, italic or inline code (a text-node boundary) does trigger, and any `/word` at a word start opens "No commands" (feeds K2). Fix: `allowedPrefixes: [' ', '(', '"', "'", ' ']` for "@". For "/", limit the menu to message start or a known command prefix.

**S6 — Tab doesn't accept; Escape works (confirmed).** The lists handle ArrowUp, ArrowDown and Enter only (S6). Escape is handled by TipTap 3.32 (`dispatchExit`) plus our cleanup — [props.ts:40-64](node_modules/@tiptap/suggestion/src/plugin/props.ts); [MI:340-345](apps/web/src/components/chat/composer/message-input.tsx). The plugin's `destroy` calls `onExit`, so no orphan popup is left on unmount — [view.ts:226-235](node_modules/@tiptap/suggestion/src/plugin/view.ts).

**S7 — Empty-state flash (Low, unverified).** `onStart` and the first `onUpdate` run with `items: initialItems ?? []` before the fetch — [view.ts:130-141, 164-185](node_modules/@tiptap/suggestion/src/plugin/view.ts). With `debounce: 0` ([async.ts:51-83](node_modules/@tiptap/suggestion/src/plugin/async.ts)) the real items arrive in microtasks within the same task, so a visible "No matches" flash is unlikely. Before candidates load, the menu shows "No matches", and Enter then hits K2.

**S8 — Chips and the caret (confirmed / unverified).** Connector, repo-file and mention insertions add a trailing space after the atom — [MI:1311-1321](apps/web/src/components/chat/composer/message-input.tsx); [repo-file-chip.tsx:116-119](apps/web/src/components/chat/composer/repo-file-chip.tsx); [connector-chip.tsx:144-146](apps/web/src/components/chat/composer/connector-chip.tsx). This sidesteps WebKit's "no caret after a trailing non-editable inline" problem. Selected chips show a ring. `DesktopCaret` hides on NodeSelection ([desktop-caret.tsx:41-57](apps/web/src/components/chat/composer/desktop-caret.tsx)). Caret geometry next to inline atoms in WKWebView is unverified (it falls back to `coordsAtPos` when the range has no rects, [desktop-caret.tsx:67-72](apps/web/src/components/chat/composer/desktop-caret.tsx)).

**S9 — "@" inside inline code (Low, unverified render).** Mention's default `allow` checks only that the schema allows the node, so "@" inside a code mark opens the menu and can insert a mention into code. The renderer's mention regexes run over the raw markdown, including code — [message-markdown.tsx:115-141](apps/web/src/components/chat/message-markdown.tsx).

### Inferences
- S1 plus S2 is a real notification-spam risk. Fixing ranking and `deleteTriggerWithBackspace` is a few lines.

### Gaps
- Real row heights and overflow were not measured. The WebKit inline-atom caret behavior was not observed.

## Links and the bubble menu

### Takeaway
There is effectively no link editing. You can paste a URL over a selection, but you cannot edit or remove a link, clicking one does nothing, and there is no shortcut (Cmd+K belongs to the palette). The bubble menu has four marks only, anchors to one end of the selection, and drifts when the editor's own scroller scrolls. Link marks are inclusive, so typing after a link silently extends it while keeping the old href.

### Cited Findings
- **L1 — No link UI (Medium, confirmed).** `openOnClick: false`, no link button, no `setLink`/`unsetLink` call anywhere in the composer — [MI:844-854, 1503-1623](apps/web/src/components/chat/composer/message-input.tsx). Cmd+K opens the workspace palette from a document listener ([workspace-command.tsx](apps/web/src/components/sidebar/channel-panel/workspace-command.tsx) around line 104). Fix: a link button and popover in the bubble menu, a Cmd+K capture inside the editor (the same pattern as Cmd+B at [MI:1209-1232](apps/web/src/components/chat/composer/message-input.tsx)) or Cmd+Shift+U, and a hover card with edit/unlink.
- **L2 — Typing after a link extends it with the old href (Low-Medium, confirmed).** Link `inclusive()` returns `autolink` (true) — [link.ts:250-252](node_modules/@tiptap/extension-link/src/link.ts). Autolink never re-validates an existing link mark (it returns early if any link mark is in range) — [autolink.ts:182-198](node_modules/@tiptap/extension-link/src/helpers/autolink.ts). So editing the end of `https://x.com` to `https://x.com/path` sends `[https://x.com/path](https://x.com)`. Autolink fires only on whitespace after the URL, so a URL typed last before Enter isn't linked in the composer (it still autolinks when rendered). Fix: `Link.extend({ inclusive: () => false })` (it is already `exitable`, [link.ts:226](node_modules/@tiptap/extension-link/src/link.ts)), and re-sync the href when the link text is itself a URL.
- **L3 — Bubble menu gaps (Medium, confirmed).** Only Bold, Italic, Inline code and Strike — [MI:1539-1622](apps/web/src/components/chat/composer/message-input.tsx). Missing: link, bullet and numbered list, quote, code block. The custom virtual element uses `coordsAtPos(selection.head)`, so the menu sits at whichever end you finished dragging — [MI:1512-1529](apps/web/src/components/chat/composer/message-input.tsx). It repositions only on `window` scroll (default `scrollTarget`) — [bubble-menu-plugin.ts:390, 410](node_modules/@tiptap/extension-bubble-menu/src/bubble-menu-plugin.ts) — so scrolling inside the 200 px editor detaches it. It appears 250 ms after selection (`updateDelay`, line 376) and also on Cmd+A. It does hide on blur ([bubble-menu-plugin.ts:448](node_modules/@tiptap/extension-bubble-menu/src/bubble-menu-plugin.ts)).
- **L4 — Dead code computed on every transaction (Low, confirmed).** A six-language `CODE_BLOCK_LANGUAGE_OPTIONS` (code-block-view has 12), `getCodeBlockLanguageValue`, `_getActiveCodeBlockRect`, `_handleCodeBlockLanguageChange` and the `markState` code-block fields — [MI:121-128, 535-608, 1250-1277, 1289-1305](apps/web/src/components/chat/composer/message-input.tsx).

### Inferences
- Any best-in-class chat composer offers selection → link. Its absence, plus the inclusive-link quirk, makes links feel broken.

### Gaps
- None material.

## Undo/redo, clear after send, type-to-focus, IME

### Takeaway
Undo groups typing over 500 ms (standard). But the post-send clear and the draft swaps are undoable steps: Cmd+Z after send restores the sent text (one Enter re-sends it), and Cmd+Z after switching channels pulls in the other channel's draft. Type-to-focus drops Option-composed characters and may break IME on WebKit.

### Cited Findings
- **U1 — Cmd+Z after send restores the sent message (Medium, confirmed).** `clearContent` → `setContent` → `tr.replaceWith` with no `addToHistory:false` — [clearContent.ts:21-25](node_modules/@tiptap/core/src/commands/clearContent.ts); [setContent.ts:51-69](node_modules/@tiptap/core/src/commands/setContent.ts); call at [MI:1135](apps/web/src/components/chat/composer/message-input.tsx). The draft listener then re-saves it. Fix: pick one behavior on purpose. Either clear with `addToHistory:false` and reset history (Slack-like), or keep it as an explicit "undo send".
- **U2 — Undo across channels and DMs (Medium, confirmed).** See R8.
- **U3 — Type-to-focus gaps (Low, confirmed / likely).** The document keydown handler calls `preventDefault` and inserts `event.key` via `insertContent` — [MI:1178-1201](apps/web/src/components/chat/composer/message-input.tsx).
  - It skips any key with `altKey`, so Option-typed characters (é via the dead key, ñ, ™) typed from outside the editor are dropped.
  - Dead keys and IME "Process" keys (`key.length > 1`) are ignored, and the key is lost.
  - Input rules don't run for that first character.
  - The caret always jumps to the end.
  - Whether WebKit reports a single-character `key` on the first IME keydown (keyCode 229) is unverified. If it does, the raw Latin letter is inserted and composition never starts.
  - Fix: on the first printable or IME key, focus the editor at the end **without** `preventDefault` and let the browser deliver the key or composition into it. Whether focus moved during keydown reliably receives the keypress in WebKit is unverified.
- **U4 — Granularity (confirmed).** TipTap UndoRedo defaults to `depth: 100, newGroupDelay: 500` — [undo-redo.ts:51-52](node_modules/@tiptap/extensions/src/undo-redo/undo-redo.ts). Backspace right after an input rule reverts it — [keymap.ts:16](node_modules/@tiptap/core/src/extensions/keymap.ts).
- **U5 — IME in the main composer is protected (confirmed).** See K7 for the edit box, which is not.

### Inferences
- Fix U1 and U2 together: key the composer by conversation and make programmatic content swaps non-undoable.

### Gaps
- WebKit IME keydown details (U3) need a manual check in the desktop app.

## Code blocks (CodeBlockShiki + code-block-view)

### Takeaway
Code blocks look good but are hard to use. You can't add a line from the keyboard (K1). Tab leaves the editor (K4). Shift+Enter exits even from mid-block. "```" + Enter sends. The language picker is limited, misses fence aliases, and probably leaves focus on its trigger. The edit box has a different, plain code block.

### Cited Findings
- **C1 — Keys.** No newline (K1). Tab and Shift-Tab disabled (K4). Ways out: ArrowDown at the end, Shift+Enter (anywhere), Backspace in an empty block, or clicking the TrailingNode paragraph — [code-block.ts:215-228, 399-434](node_modules/@tiptap/extension-code-block/src/code-block.ts); [starter-kit.ts:268](node_modules/@tiptap/starter-kit/src/starter-kit.ts). Creating one needs ``` + **Space** (M6) or `/` → Code Block ([MI:449-456](apps/web/src/components/chat/composer/message-input.tsx)). Mod-Alt-C also toggles one ([code-block.ts:212](node_modules/@tiptap/extension-code-block/src/code-block.ts)).
- **C2 — Language picker (Low-Medium, confirmed / unverified).** 12 fixed languages — [code-block-view.tsx:11-24, 56-71](apps/web/src/components/chat/composer/code-block-view.tsx). Fence aliases (```` ```ts ````) store `language: "ts"`, which is not an item, so the Select label may be blank or odd (unverified rendering), although Shiki resolves the alias ([code-block-shiki.ts:56-63](apps/web/src/components/chat/composer/code-block-shiki.ts)). "yaml" is unreachable. After a pick, Base UI most likely returns focus to the Select trigger (unverified), not into the code. In the session document, type-to-focus ignores button targets ([MI:1188-1194](apps/web/src/components/chat/composer/message-input.tsx)), so keys typed then are lost. Fix: `onValueChange` → `updateAttributes` + `editor.commands.focus()` inside the block; normalize aliases into the stored language.
- **C3 — Shiki latency (Low, confirmed / unverified impact).** The first use of a language lazy-loads shiki, the JS regex engine and the grammar, so the block shows plain and then colored — [code-block-shiki.ts:31-54](apps/web/src/components/chat/composer/code-block-shiki.ts). After that, every keystroke re-tokenizes the whole edited block synchronously (the cache is keyed by node identity) — [code-block-shiki.ts:26-28, 74-99, 136-141](apps/web/src/components/chat/composer/code-block-shiki.ts). Fine for snippets; possible lag near the 4,000-character paste ceiling (unverified).
- **C4 — Styling conflicts.** See M5.
- **C5 — Edit box divergence (confirmed).** The edit box uses StarterKit's plain CodeBlock: no Shiki, no picker, no Tab handling — [EDIT:49-54](apps/web/src/components/chat/message-edit-input.tsx). With R1, fences never even load as code blocks there.

### Inferences
- K1, K4, M6 and C2 together make code blocks feel like a trap. The fix is a handful of keymap lines plus `enableTabIndentation`.

### Gaps
- No runtime timing for Shiki tokenization. Base UI Select focus restore is not confirmed.

## Which issues matter most (severity ranking and fix themes)

### Takeaway
Fix order by user harm × frequency:
1. R1 — edit box destroys messages.
2. K1 — no newline in code blocks.
3. R2 — `++` regex deletes text.
4. S1 + S2 — @channel by accident.
5. M1 + M2 — line-start shortcuts dead / block markdown renders unexpectedly.
6. K2 + K3 — Enter turns into a newline because of popups.
7. P1 + P2 — pasted markdown and code mangled.
8. Then R8/U1 (undo across channels and after send), K6/K7 (edit box Escape and IME), K4 (Tab), L1/L2 (links), R5 (harness commands), M4 (underline), E3/E5 (silent no-ops, ghost typing), and the polish items (S3, S4, M5, L3, C2, L4).

### Cited Findings
- R1 — [EDIT:79](apps/web/src/components/chat/message-edit-input.tsx), [Extension.ts:106-120](node_modules/@tiptap/markdown/src/Extension.ts).
- K1 — [MI:888-896](apps/web/src/components/chat/composer/message-input.tsx), [hard-break.ts:80-81](node_modules/@tiptap/extension-hard-break/src/hard-break.ts).
- R2 — [editor-utils.ts:46-47](apps/web/src/lib/editor-utils.ts).
- S1 — [mention-suggestion-list.tsx:37-44](apps/web/src/components/chat/composer/mention-suggestion-list.tsx), [MI:359-368](apps/web/src/components/chat/composer/message-input.tsx).
- S2 — [mention.ts:325-357](node_modules/@tiptap/extension-mention/src/mention.ts).
- M1 — [getTextContentFromNodes.ts](node_modules/@tiptap/core/src/helpers/getTextContentFromNodes.ts), [bullet-list.ts:50](node_modules/@tiptap/extension-list/src/bullet-list/bullet-list.ts).
- M2 — [MarkdownManager.ts:1211-1213](node_modules/@tiptap/markdown/src/MarkdownManager.ts).
- K2 — [MI:890](apps/web/src/components/chat/composer/message-input.tsx), [mention-suggestion-list.tsx:67](apps/web/src/components/chat/composer/mention-suggestion-list.tsx).
- K3 — [state.ts:102-108](node_modules/@tiptap/suggestion/src/plugin/state.ts).
- P1 — [clipboard.ts:63](node_modules/prosemirror-view/src/clipboard.ts).

### Inferences
Five fix themes cover nearly everything, all within TipTap:
1. **One `composerExtensions()` factory plus one `ComposerKeymap` extension** shared by the composer and the edit box. Send and save go through `editorProps.handleKeyDown` (IME-safe). Shift-Enter: code → `newlineInCode`, list → split/lift, paragraph → split block or hard break. Tab: list → sink-or-swallow, code → indent. Escape: menu → close, reply → cancel. This covers K1, K2, K4, K5, K6, K7, K9, M6 and C5.
2. **Markdown in and out as one source of truth.** Use `contentType: "markdown"` when loading the edit box. Use node-level `renderMarkdown` for mentions, links and chips instead of regex post-processing. Escape leading block markers that the editor can't display. Turn off Underline. Optionally enable Blockquote. This covers R1–R7, M2, M3 and M4.
3. **Suggestion infrastructure.** Use TipTap's floating-ui `mount` (flip, outside-click dismissal), hide when empty, read the editor's own plugin state instead of a DOM query, prefix-ranked results with broadcasts last, `scrollIntoView`, Tab to accept, `deleteTriggerWithBackspace`. This covers K2, K3, S1–S5.
4. **Paste pipeline.** Markdown-aware plain-text paste, code detection for IDE pastes, heading/quote mapping in `transformPastedHTML`, code-context guards on chip paste, and notice/undo for the large-paste attachment. This covers P1–P6.
5. **State hygiene.** Key the composer per conversation, make draft swaps and the send-clear non-undoable (or deliberate), and stop emitting typing on clear. This covers R8, U1, U2 and E5.

### Gaps
- All rankings are code-derived. No usage data or user reports were consulted, and nothing was reproduced in a running app.
- apps/mobile is out of scope.
