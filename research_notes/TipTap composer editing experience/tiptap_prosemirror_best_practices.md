# TipTap v3 + ProseMirror best practices, pitfalls and extensions for a polished chat composer

Scope note: everything below targets TipTap 3.x (installed: 3.32.2; latest on 2026-11-07 is v3.33.0, released 2026-11-05) and prosemirror-view 1.42.x (installed: 1.42.8; latest 1.42.9). Claims marked "installed source" were read directly from `/Users/jacob/dev/townhall/node_modules/.pnpm/@tiptap+*@3.32.2*/` and `prosemirror-view@1.42.8`; the GitHub `main` URL is given as the public citation (main can drift slightly from 3.32.2). v2-only info is flagged.

## 1. React integration performance (useEditor, useEditorState, node views)

### Takeaway
In v3, `useEditor` no longer re-renders the host on every transaction (`shouldRerenderOnTransaction` is off unless set to `true`), so jank comes from (a) host re-renders that pass new `extensions`/`editorProps` objects, which makes `useEditor` call `editor.setOptions()` → `view.setProps()` + `view.updateState()` on every render, (b) broad `useEditorState` selectors, and (c) React node views (synchronous, `flushSync`-style rendering) used for hot nodes such as a highlighted code block. Isolate the editor component, keep options referentially stable, use narrow selectors, and prefer plain DOM node views or decorations for anything that updates on each keystroke.

### Cited Findings
- v3 upgrade guide: `shouldRerenderOnTransaction` is now "disabled by default". Track state with `onTransaction` or `useEditorState` instead. — [Tiptap v2→v3 upgrade guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2)
- The installed source confirms this. The `useEditorState` selector inside `useEditor` returns `null` (no re-render) when `options.shouldRerenderOnTransaction === false || === undefined`. The code comment says per-transaction re-render "is legacy behavior that will be removed in future versions". — [useEditor.ts (installed source)](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/useEditor.ts)
- The official performance guide is partly stale. It still says `shouldRerenderOnTransaction` "defaults to enabled, should typically be set to `false`", which is v2.5 wording. That contradicts the v3 upgrade guide and the source above. — [Tiptap React performance guide](https://tiptap.dev/docs/guides/performance); contradicted by [upgrade guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2)
- Performance guide recommendations: "the most common performance issue is that the editor is re-rendered too often", so isolate the editor in its own component. Use `useEditorState({ editor, selector })` so the component "only re-render[s] if it has changed". Node views "are expected to be rendered synchronously... This can be expensive, especially if you have many instances", so consider plain HTML elements. To avoid `flushSync` warnings when you set React state from Tiptap callbacks, "wrap it inside `queueMicrotask`". — [Tiptap React performance guide](https://tiptap.dev/docs/guides/performance)
- `immediatelyRender` defaults to `true` (`explicit ?? true`). Tiptap auto-sets it to `false` only when SSR or Next.js is detected. In a client-only Vite SPA, leave it `true` (the default). Then `useEditor` returns a non-null editor on the first render and there is no empty first paint. — [useEditor.ts (installed source)](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/useEditor.ts); [react CHANGELOG 3.23.5: "`immediatelyRender` now defaults to `false` in SSR environments"](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/react/CHANGELOG.md)
- Option-change pitfall (installed source). When `deps` is `[]` and the editor exists, `useEditor` runs `EditorInstanceManager.compareOptions(current, editor.options)` on every render. Callbacks (`onUpdate`, `onTransaction`, etc.) are excluded from the comparison. `extensions` are compared element by element by reference. Every other key, including `editorProps`, is compared with `!==`. On any difference it calls `editor.setOptions({...})`. That runs `this.view.setProps({...editorProps, attributes})` and then `this.view.updateState(this.state)`. — [useEditor.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/useEditor.ts); [Editor.ts `setOptions`](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/Editor.ts)
- `editorProps` are spread directly into `new EditorView(element, {...editorProps, attributes, dispatchTransaction, transformPastedHTML, state, markViews, nodeViews})`. The extension plugins are added afterwards via `state.reconfigure`. — [Editor.ts (installed source)](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/Editor.ts)
- `useEditorState` is built on `useSyncExternalStoreWithSelector`. Its default equality is a circular-safe deep equal (`circularDeepEqual`), and you can override it with `equalityFn`. 3.32.0 fixed "`useEditorState` overflowing the stack when a selector returns a value with circular references". 3.29.0: `useEditorState` now re-renders on `editor.setEditable()`. — [useEditorState.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/useEditorState.ts); [Tiptap releases](https://github.com/ueberdosis/tiptap/releases); [react CHANGELOG](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/react/CHANGELOG.md)
- New in 3.18/3.20: an optional declarative `<Tiptap />` component with `useTiptap()` and `useTiptapState(selector, equalityFn)` hooks. These read the editor from context so toolbars and menus can subscribe without prop drilling. The legacy `useEditor` API stays supported in v3. — [react CHANGELOG 3.18.0/3.20.0](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/react/CHANGELOG.md); [Tiptap.tsx (installed source)](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/Tiptap.tsx)
- React node view performance and caret fixes across 3.x:
  - 3.12.0: fixed invalid positions when the React and PM render cycles desync.
  - 3.22.5: added `selectedOnTextSelection`.
  - 3.23.5: "NodeViews no longer re-render on decoration or position changes without content modifications", plus an optional `trackNodeViewPosition`.
  - 3.28.0: batched portal notifications.
  - 3.29.1: caret placement fixed after splitting blocks rendered with a React NodeView.
  - 3.29.2: fixed "caret jumping backward when pressing Enter inside React node views".
  - 3.30.6: "Reduce overhead in React node views on documents with many nodes".
  - 3.31.1: fixed freezes in framework node views on iOS/Android.
  - 3.31.4: fixed Enter/Shift-Enter inside React node views on iOS and Android.
  - 3.32.3: fixed a React warning when `setContent` creates React node views inside an effect.
  — [react CHANGELOG](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/react/CHANGELOG.md); [Tiptap releases](https://github.com/ueberdosis/tiptap/releases)
- `ReactNodeViewRenderer` options (installed): `as`, `className`, `attrs`, `update(...)` (custom update predicate that receives `oldNode/newNode/decorations/updateProps`), `stopEvent`, `ignoreMutation`, `contentDOMElementTag`, and `selectedOnTextSelection`. — [ReactNodeViewRenderer.tsx](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/ReactNodeViewRenderer.tsx)
- 3.32.3 fixed "a performance issue where code highlighting updates were unnecessarily triggered by selection-only changes" in `@tiptap/extension-code-block-lowlight`. That is the same failure class a hand-rolled Shiki highlighter can have. — [v3.32.3 release notes](https://github.com/ueberdosis/tiptap/releases)
- 3.30.0 added an `addDecorations()` extension hook (inline, node and widget decorations, with `shouldUpdate()` and `update: 'changedRanges'`). React and Vue components can be rendered as widget decorations (`ReactWidgetRenderer`). — [react CHANGELOG 3.30.0](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/react/CHANGELOG.md)
- Decoration-based highlighting is the common ProseMirror alternative to a React node view for code. `prosemirror-highlight` (ocavue) uses `createHighlightPlugin({ parser })`. A lazy parser returns `Promise<void>` while Shiki loads a language or theme and `Decoration[]` once it is ready. Shiki colours are exposed as `--prosemirror-highlight` / `--prosemirror-highlight-bg` on the `<pre>`. `tiptap-extension-code-block-shiki` (timomeh) wraps it for Tiptap. — [ocavue/prosemirror-highlight](https://github.com/ocavue/prosemirror-highlight); [timomeh/tiptap-extension-code-block-shiki](https://github.com/timomeh/tiptap-extension-code-block-shiki)

### Inferences
- If the composer passes inline `editorProps: { handleKeyDown: ... }` or rebuilds `extensions` (e.g. `Mention.configure({...})`) inside the component body, every re-render of the composer host (typing state, attachment state, send-button state) triggers `view.setProps` + `view.updateState`. That is extra PM view work on hot paths, and it can disturb DOM selection or composition. Hoist extensions into a `useMemo`/module constant. Route changing callbacks through refs: `editorProps.handleKeyDown: (v, e) => handlerRef.current(v, e)`.
- Extensions configured with closures only take effect at editor creation (unless `deps` change). Stale closures over props like "members list" or "onSend" are a classic bug. Use refs or `editor.storage`.
- Keep `<EditorContent>` in a memoized child that receives only `editor`. Subscribe the send button, toolbar and bubble menu with separate narrow `useEditorState` selectors that return primitives (e.g. `isEmpty`, `isBold`), so the deep equality check stays cheap.
- For the Shiki code block: a React node view re-renders synchronously on every keystroke inside the block. Moving highlighting into decorations (prosemirror-highlight, or the 3.30 `addDecorations` hook with `update: 'changedRanges'`) and keeping only a thin DOM node view (or none) for the language label is the lower-jank architecture. At minimum, skip re-highlighting when `tr.docChanged` is false, mirroring the 3.32.3 lowlight fix.

### Gaps
- No official benchmark numbers comparing ReactNodeViewRenderer against plain DOM node views were found.
- The official performance page has not been updated for v3 defaults. The upgrade guide and source are the authority.

## 2. @tiptap/markdown (official v3): parse/serialize, round-trip bugs, pasting markdown, vs tiptap-markdown

### Takeaway
`@tiptap/markdown` (released in 3.7.0) parses with MarkedJS (`marked@^17`) into Tiptap JSON and serializes through per-extension `renderMarkdown` handlers. It has no paste handler, so pasting markdown as rich content must be hand-built (`editor.markdown.parse(text)` + `insertContent`). In 3.32.2 `getMarkdown()` backslash-escapes `\ ` * _ [ ] ~` and HTML-encodes `& < >` in all non-code text. Hard breaks serialize as two trailing spaces + `\n`. Several round-trip bugs are open as of 2026-11-07, none fixed in 3.32.3/3.33.0.

### Cited Findings
- Architecture: Markdown → MarkedJS lexer → tokens → extension handlers → JSON, and the reverse for export. API: `contentType: 'markdown'` on the editor, `editor.getMarkdown()`, `setContent(md, { contentType: 'markdown' })`, `insertContent(md, { contentType: 'markdown' })`. Custom syntax uses `parseMarkdown`/`renderMarkdown`/`markdownTokenizer` plus the helpers `createBlockMarkdownSpec`/`createInlineMarkdownSpec`. Documented limitations: comments are not supported, and table cells support a single child node. — [Tiptap Markdown intro](https://tiptap.dev/docs/editor/markdown)
- No built-in paste support. The installed `@tiptap/markdown` 3.32.2 source contains no `handlePaste`/`clipboardTextParser`/`transformPasted` code; a grep for "paste" returns nothing outside tests. The docs' examples page shows a hand-rolled paste handler with the heuristic `/^#{1,6}\s/ || /\*\*[^*]+\*\*/ || /\[.+\]\(.+\)/ || /^[-*+]\s/`, then `const json = editor.markdown.parse(text); editor.commands.insertContent(json)`. — [Markdown examples](https://tiptap.dev/docs/editor/markdown/examples); [MarkdownManager.ts / Extension.ts (installed source)](https://github.com/ueberdosis/tiptap/blob/main/packages/markdown/src/Extension.ts)
- Extension options (installed): `indentation: { style: 'space' | 'tab', size }` (default space/2), `markedOptions` (passed to `marked.setOptions`), and an injectable `marked` instance. 3.27.0 fixed "custom markdown tokenizers registered via `marked.use(...)`". — [Extension.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/markdown/src/Extension.ts); [markdown CHANGELOG](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/markdown/CHANGELOG.md)
- Escaping (installed 3.32.2). `encodeTextForMarkdown()` returns code-context text untouched. All other text goes through `escapeMarkdownSyntax(encodeHtmlEntities(text))`, where `escapeMarkdownSyntax = text.replace(/([\\`*_[\]~])/g, '\\$1')` and `encodeHtmlEntities` replaces `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`. Escaping of these characters was introduced in 3.25.0. — [MarkdownManager.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/markdown/src/MarkdownManager.ts); [htmlEntities.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/utilities/htmlEntities.ts); [markdown CHANGELOG 3.25.0](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/markdown/CHANGELOG.md)
- Issue #8519 (open): `escapeMarkdownSyntax` "breaks roundtrip stability". When `getMarkdown()` output is fed back as plain/HTML content (without `contentType: 'markdown'`), each pass adds another backslash layer (`*bold*` → `\*bold\*` → `\\*bold\\*`…). Workaround mentioned: monkey-patch `manager.escapeMarkdownSyntax = (text) => text` (unsupported). Fix PR #8520 is open. The issue title attributes the regression to 3.32.0, but the changelog dates escaping to 3.25.0. — [Issue #8519](https://github.com/ueberdosis/tiptap/issues/8519); [PR #8520](https://github.com/ueberdosis/tiptap/pull/8520)
- Hard breaks: `HardBreak.renderMarkdown = () => '  \n'` (installed). Issue #8478 (open): consecutive hard breaks (Shift+Enter twice) are lost on round trip, because the middle line is only spaces, which markdown reads as a paragraph break. Fix PR #8479 is open. Issue #8510 (open): a hard break inside a heading does not round-trip. — [hard-break.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-hard-break/src/hard-break.ts); [Issue #8478](https://github.com/ueberdosis/tiptap/issues/8478); [Issue #8510](https://github.com/ueberdosis/tiptap/issues/8510)
- Soft breaks: Issue #8136 (open). `parse('foo\nbar')` yields a text node `"foo\nbar"`. Because `.ProseMirror` uses `white-space: break-spaces`, it renders on two lines, contrary to CommonMark. Neither `markedOptions: { breaks: true }` nor `walkTokens` fixes it. Suggested fix: `text.replace(/[ \t]*\n[ \t]*/g, ' ')`. Related: #7107 (double-space hard breaks not parsed), #7170, #7269. — [Issue #8136](https://github.com/ueberdosis/tiptap/issues/8136); [Issue #7107](https://github.com/ueberdosis/tiptap/issues/7107)
- Other recent markdown fixes:
  - 3.29.0: blank lines after block elements were being dropped on each cycle.
  - 3.30.0: unclosed inline HTML such as `<b>` no longer produces an invalid doc.
  - 3.30.6: nested lists keep their hierarchy.
  - 3.31.4: inline code containing backticks serializes correctly; table pipes are escaped; large ordered-list docs parse much faster.
  - 3.32.0: a literal `!` before a link is now escaped so it is not re-read as an image.
  — [markdown CHANGELOG](https://raw.githubusercontent.com/ueberdosis/tiptap/main/packages/markdown/CHANGELOG.md); [Tiptap releases](https://github.com/ueberdosis/tiptap/releases)
- 3.32.3 and 3.33.0 release notes contain no markdown escape or hard-break fixes. As of 2026-11-07, issues #8519/#8478/#8136/#8510 and PRs #8520/#8479 are all open (checked via GitHub API). — [v3.32.3 / v3.33.0 releases](https://github.com/ueberdosis/tiptap/releases)
- Mentions in markdown (installed). `Mention` uses `createInlineMarkdownSpec({ nodeName: 'mention', name: '@', selfClosing: true, allowedAttributes: ['id','label',{ name:'mentionSuggestionChar', skipIfDefault:'@' }] })`. Default output is a shortcode such as `[@ id="u1" label="Jacob"]`, not `@Jacob`. Override `renderMarkdown`/`parseMarkdown` for app-specific syntax. — [mention.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-mention/src/mention.ts)
- Link markdown (installed): `renderMarkdown` always emits `[text](href)` or `[text](href "title")`, never `<url>` autolinks. — [link.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-link/src/link.ts)
- Community `tiptap-markdown` (aguingand) uses markdown-it to parse and prosemirror-markdown to serialize. Its options include `transformPastedText` (default false; parses pasted markdown), `transformCopiedText`, `tightLists: true`, `bulletListMarker: '-'`, `linkify: false`, `breaks: false`, `html: true`. The maintainer says "Tiptap released a markdown extension in 3.7.0, please prefer using the official extension over this package". — [aguingand/tiptap-markdown](https://github.com/aguingand/tiptap-markdown)

### Inferences
- For a chat composer whose markdown goes to people and to an LLM, the 3.32.2 serializer changes what users typed. `snake_case`, `2*3`, `a < b && c` become `snake\_case`, `2\*3`, `a &lt; b &amp;&amp; c`. A markdown renderer decodes these, but any plain-text consumer (LLM prompt, notification preview, search index, mobile plain render) sees backslashes and entities. Options: a post-serialize unescape for consumers that need plain text; a custom text serializer (override via a wrapper `MarkdownManager`/monkey-patch, flagged unsupported); or pin until PR #8520 lands. Verify which of Lor's consumers read raw markdown.
- Shift+Enter twice (a blank line inside one message) is a common chat gesture. It does not survive `getMarkdown()` → re-parse (edit message, drafts) until #8479 ships. A custom `HardBreak.extend({ renderMarkdown: () => '\\\n' })` (backslash hard break, valid CommonMark) is a plausible local workaround. It is not verified against the parser.
- "Paste markdown as rich text" needs a custom `handlePaste` (see section 6). The Outline heuristic (`isMarkdown`, signal counting) is more robust than the docs' 4-regex example.

### Gaps
- No official statement on when #8520/#8479 will ship.
- No confirmation whether `editor.markdown.parse` handles the `[@ id=...]` shortcode for pasted text from other apps. It is only relevant if the app keeps the default mention spec.

## 3. Keyboard/list behavior, Enter-to-send, code block exit, TrailingNode/Gapcursor/Dropcursor

### Takeaway
`editorProps.handleKeyDown` runs before every plugin, including the suggestion popup's Enter/Arrow/Escape handling and the list and code-block keymaps. It is the riskiest place for Enter-to-send. The more robust pattern is a Tiptap Extension `addKeyboardShortcuts` with deliberate `priority`: Enter sends unless a suggestion menu is open, while Shift-Enter runs a structural chain (newline in code → split list item → paragraph). Plane ships exactly this. StarterKit v3 already includes ListKeymap, TrailingNode, Gapcursor, Dropcursor, UndoRedo, Link and Underline.

### Cited Findings
- ProseMirror `someProp` checks the view's direct props first, then direct plugins, then `state.plugins`, in order, and stops at the first truthy result. Tiptap passes `editorProps` as direct EditorView props and adds extension plugins later via `state.reconfigure`. So `editorProps.handleKeyDown` wins over all extension keymaps and the suggestion plugin. — [prosemirror-view index.ts `someProp` (installed 1.42.8)](https://github.com/ProseMirror/prosemirror-view/blob/master/src/index.ts); [Tiptap Editor.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/Editor.ts)
- Tiptap plugin order: `sortExtensions([...extensions].reverse())`. Higher `priority` runs earlier. At equal priority (default 100), later-registered extensions run first. Each extension's `addKeyboardShortcuts` keymap plugin is pushed before its other plugins. Mention has `priority: 101`, so its suggestion plugin runs before default-priority keymaps. — [ExtensionManager.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/ExtensionManager.ts); [mention.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-mention/src/mention.ts)
- Plane's `EnterKeyExtension` (AGPL), simplified:
  ```ts
  Enter: () => { const { activeDropbarExtensions } = this.editor.storage.utility
    if (activeDropbarExtensions.length === 0) { onEnterKeyPress?.(); return true } return false },
  "Shift-Enter": ({ editor }) => editor.commands.first(({ commands }) => [
    () => commands.newlineInCode(), () => commands.splitListItem("listItem"),
    () => commands.splitListItem("taskItem"), () => commands.createParagraphNear(),
    () => commands.liftEmptyBlock(), () => commands.splitBlock() ])
  ```
  Open dropdowns (mentions, slash menu) register in `editor.storage.utility.activeDropbarExtensions` so Enter falls through to them. — [makeplane/plane packages/editor/src/extensions/enter-key.ts](https://github.com/makeplane/plane/blob/preview/packages/editor/src/extensions/enter-key.ts)
- Another public implementation (quillandcup/hub PR #952, "Enter sends in a list too, Shift+Enter starts the next item"). Shift-Enter runs Tiptap's default Enter chain (`newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock`) plus `splitListItem('listItem')` and a code-fence rule. On an empty item it exits the list via the same split → lift → split chain. — [quillandcup/hub PR #952 (via search summary)](https://github.com/quillandcup/hub/pull/952)
- Core keymap (installed): `Enter` → `first([newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock])`, `Mod-Enter` → `exitCode()`, `Backspace` → `first([undoInputRule, ...])`, `Mod-a` → `selectAll`. HardBreak binds both `Mod-Enter` and `Shift-Enter` → `setHardBreak()` with `keepMarks: true` default. CodeBlock binds `Mod-Alt-c` → `toggleCodeBlock`. — [keymap.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/extensions/keymap.ts); [hard-break.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-hard-break/src/hard-break.ts); [code-block.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-code-block/src/code-block.ts)
- CodeBlock options (installed defaults): `exitOnTripleEnter: true`, `exitOnArrowDown: true`, `exitOnArrowUp: true`, `enableTabIndentation: false`, `tabSize` (DEFAULT_TAB_SIZE), `defaultLanguage: null`, `languageClassPrefix: 'language-'`. The node spec is `content: 'text*', marks: '', code: true, defining: true`. — [code-block.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-code-block/src/code-block.ts)
- StarterKit v3 registers: Bold, Blockquote, BulletList, Code, CodeBlock, Document, Dropcursor, Gapcursor, HardBreak, Heading, UndoRedo, HorizontalRule, Italic, ListItem, ListKeymap, Link, OrderedList, Paragraph, Strike, Text, Underline, TrailingNode. Each can be disabled with `false`. — [starter-kit.ts (installed source)](https://github.com/ueberdosis/tiptap/blob/main/packages/starter-kit/src/starter-kit.ts); [upgrade guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2)
- ListKeymap (in `@tiptap/extension-list`) handles `Backspace`, `Delete`, `Mod-Backspace`, `Mod-Delete` at list-item boundaries for the configured `listTypes`. — [list-keymap.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-list/src/keymap/list-keymap.ts)
- prosemirror-schema-list 1.6.0 (2026-10-30): `splitListItem`, `splitListItemKeepMarks`, `liftListItem`, `sinkListItem` now accept an array of node types; a `wrapInList` crash was fixed. — [ProseMirror changelog](https://prosemirror.net/docs/changelog/)
- TrailingNode options: `node` (default: the doc's default block) and `notAfter` (the default node is always included). It keeps an empty trailing block after nodes such as code blocks. — [trailing-node.ts (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/extensions/src/trailing-node/trailing-node.ts)
- Lexical analogue: `editor.registerCommand(KEY_ENTER_COMMAND, e => { if (e.shiftKey) return editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND); onSend(); return true }, COMMAND_PRIORITY_LOW)`. The typeahead menu registers Enter/Arrow/Tab/Escape listeners while open, so they intercept first. — [Lexical discussion #7060](https://github.com/facebook/lexical/discussions/7060); [Lexical API docs](https://lexical.dev/docs/api/modules/lexical)
- Slack list behaviour (secondary sources disagree). One says "Press Enter to continue the list. Press Shift + Enter to add a line inside the same list item". Another says Enter sends and "Use Shift+Enter for the next bullet". — [slack.green bullet guide](https://slack.green/en/blog/how-to-make-bullet-points-in-slack); contradicted by [slack.green new-line guide](https://slack.green/en/blog/how-to-add-a-new-line-in-slack)

### Inferences
- With Enter-to-send in `editorProps.handleKeyDown`, pressing Enter while the @mention or slash popup is open sends the message unless the handler checks suggestion state itself. Arrow keys work only because the handler ignores them. Move send into an Extension with priority below Mention (101) and its suggestion plugin. Or check `SuggestionPluginKey.getState(state)?.active` (or per-suggestion plugin keys) in the handler.
- Decide list semantics explicitly. Options: (a) Plane style: Enter always sends, Shift-Enter = new list item or paragraph. (b) "In a list or code block Enter is structural; Mod-Enter sends." Note the default `Shift-Enter` = hard break (`<br>` inside the same list item), which is rarely what chat users expect in a list.
- `Mod-Enter` is bound twice by default (core `exitCode`, HardBreak `setHardBreak`). If Cmd+Enter is a send shortcut, intercept it at higher priority.
- TrailingNode adds an empty paragraph after a trailing code block. In an auto-growing composer that can read as a phantom blank line or height jump, and it may add trailing whitespace to `getMarkdown()`. Consider `trailingNode: false` with `exitOnArrowDown`/`exitOnTripleEnter`, plus Gapcursor for leaving code blocks.

### Gaps
- No first-party Tiptap guide for chat Enter-to-send was found. Patterns come from open-source apps.

## 4. Input rules, undoInputRule, markdown shortcuts, Typography

### Takeaway
`undoInputRule` is bound by default in v3: core Backspace runs `undoInputRule()` first, so Backspace right after an input rule fires restores the raw text. Input rules are skipped inside code blocks and next to code marks. Typography is risky in a chat app that carries code, commands and prompts (smart quotes, `--`→—, `->`→→, `!=`→≠, `2x3`→2×3). The macOS/WebKit native substitution layer can do the same independently of Tiptap.

### Cited Findings
- Core keymap `handleBackspace = () => this.editor.commands.first(({ commands }) => [() => commands.undoInputRule(), ...])`, bound to `Backspace`, `Mod-Backspace`, `Shift-Backspace`, `Ctrl-h`, `Alt-Backspace` (installed 3.32.2). — [keymap.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/extensions/keymap.ts)
- Tiptap InputRule `run()` bails when `$from.parent.type.spec.code` or an adjacent node has a mark with `spec.code`. PasteRule skips code blocks and non-text nodes. Editor-wide switches: `enableInputRules: true`, `enablePasteRules: true` (each can be a list of extension names to allow). — [InputRule.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/InputRule.ts); [PasteRule.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/PasteRule.ts); [Editor.ts defaults](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/Editor.ts)
- Link has a new `markdownLinks` option (default `false`, with a source TODO to default it to `true` in the next major). It adds an input rule and a paste rule converting `[text](url "title")` to a link and accepts curly-quote titles produced by Typography. — [link.ts / helpers/markdownLink.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-link/src/helpers/markdownLink.ts)
- Typography (`@tiptap/extension-typography`) has 23 rules: `emDash` (`--`→—), `ellipsis`, `openDoubleQuote`/`closeDoubleQuote`, `openSingleQuote`/`closeSingleQuote`, `leftArrow`, `rightArrow`, `copyright`, `registeredTrademark`, `trademark`, `servicemark`, `oneHalf`/`oneQuarter`/`threeQuarters`, `plusMinus`, `notEqual` (`!=`→≠), `laquo`/`raquo`, `multiplication` (`2*3`/`2x3`→2×3), `superscriptTwo`/`superscriptThree`. Each rule can be disabled with `false`. — [Typography docs](https://tiptap.dev/docs/editor/extensions/functionality/typography)
- A real-world chat-composer bug: macOS WebKit "silently replaced ASCII apostrophes with smart quotes... corrupting prompts containing code or commands". The fix was `spellCheck={false}`, `autoCorrect="off"`, `autoCapitalize="off"`, at the cost of native spelling underlines. — [OpenBitFun PR #3684](https://github.com/GCWing/OpenBitFun/pull/3684)

### Inferences
- In a chat app that sends code and prompts to an agent, skip Typography or enable only `ellipsis`/`emDash`. `notEqual`, `multiplication`, arrows and quotes silently change technical text. Backspace-undo mitigates this only if the user notices.
- Markdown shortcut coverage in StarterKit (bold `**`, italic `*`/`_`, strike `~~`, inline code `` ` ``, lists `- `/`1. `, code fence ```` ``` ````) comes from each extension's input rules. Headings and blockquote are disabled in Lor, so `# ` stays literal text, which suits chat.

### Gaps
- No source found quantifying user expectations for smart typography in chat. The inference rests on the code-corruption reports.

## 5. Placeholder, CharacterCount, Focus, UndoRedo, Selection, and the `@tiptap/extensions` package

### Takeaway
`@tiptap/extensions` (v3) bundles CharacterCount, Dropcursor, Focus, Gapcursor, Placeholder, Selection, TrailingNode and UndoRedo. The official Placeholder uses node decorations (`data-placeholder` + `is-editor-empty`/`is-empty` classes) with a `::before` pseudo-element styled `float:left; height:0; pointer-events:none`. That keeps the caret at the real text start, with no overlay element and no layout shift. A manual placeholder span duplicates this less robustly.

### Cited Findings
- Package contents (installed directory listing): `character-count`, `drop-cursor`, `focus`, `gap-cursor`, `placeholder`, `selection`, `trailing-node`, `undo-redo`. The upgrade guide lists the same consolidation, plus `History` renamed to `UndoRedo` (StarterKit key `undoRedo`). — [upgrade guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2); [packages/extensions/src](https://github.com/ueberdosis/tiptap/tree/main/packages/extensions/src)
- Placeholder: import `{ Placeholder } from '@tiptap/extensions/placeholder'`. Options and defaults: `placeholder: 'Write something …'` (string or `({ node }) => string`), `emptyEditorClass: 'is-editor-empty'`, `emptyNodeClass: 'is-empty'`, `dataAttribute: 'placeholder'`, `showOnlyWhenEditable: true`, `showOnlyCurrent: true`, `includeChildren: false`. Recommended CSS: `.tiptap p.is-editor-empty:first-child::before { color: #adb5bd; content: attr(data-placeholder); float: left; height: 0; pointer-events: none; }` — [Placeholder docs](https://tiptap.dev/docs/editor/extensions/functionality/placeholder)
- 3.32.3: "The Placeholder extension no longer leaves placeholders behind on empty nodes after the cursor moves away when `includeChildren` is enabled." — [v3.32.3 release](https://github.com/ueberdosis/tiptap/releases)
- UndoRedo defaults: `depth: 100`, `newGroupDelay: 500`. Keys: `Mod-z`, `Shift-Mod-z`, `Mod-y`, plus Cyrillic-layout `Mod-я`. — [undo-redo.ts (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/extensions/src/undo-redo/undo-redo.ts)
- CharacterCount defaults: `limit: null`, `mode: 'textSize'` (or `'nodeSize'`), `textCounter: text => text.length`, `wordCounter` splits on spaces. — [character-count.ts (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/extensions/src/character-count/character-count.ts)
- Selection extension: `className: 'selection'`. It decorates a non-empty text selection when the editor is not focused (and not dragging) and restores it on focus. This keeps the selection visible while a link popover input has focus. — [selection.ts (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/extensions/src/selection/selection.ts)
- Focus extension: `className: 'has-focus'`, `mode: 'all' | 'deepest' | 'shallowest'`. — [focus.ts (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/extensions/src/focus/focus.ts)

### Inferences
- Replace the manual placeholder span with `Placeholder` plus the `::before` CSS (or keep the span but match the `float:left;height:0` geometry). A separately positioned span can mis-align with the caret in WebKit, flash on the first keystroke (React state lags the PM transaction), and intercept clicks unless it has `pointer-events:none`.
- Add `Selection` if the composer opens a link-edit popover with an input, so the user still sees which text will be linked.
- Use `CharacterCount` with `limit` for a hard message cap. It blocks transactions that exceed the cap, which beats truncating at send time.

### Gaps
- No source specifically documents WebKit caret mis-positioning with overlay placeholder spans. That point is an inference.

## 6. Paste and clipboard (transformPastedHTML, clipboardTextParser, handlePaste, URL-over-selection, code, plain paste)

### Takeaway
ProseMirror already pastes as plain text when Shift is held (Cmd+Shift+V) and always pastes text into code blocks. `transformPasted` gained an `isPlainText` argument and now runs for code-block pastes (1.41.0). Tiptap's Link `linkOnPaste` wraps a non-empty selection when the clipboard is a single URL. CodeBlock creates a code block from VS Code pastes (via `vscode-editor-data`). Markdown-to-rich paste and Google Docs/Word cleanup are not built in. Outline's PasteHandler is a mature, copyable reference.

### Cited Findings
- prosemirror-view paste: `let plain = view.input.shiftKey && view.input.lastKeyCode != 45` (Shift held = plain paste). In `parseFromClipboard`, `asText = !!text && (plainText || inCode || !html)`. `transformPastedText(text, inCode || plainText, view)` runs first, then `clipboardTextParser(text, $context, plainText, view)`. Otherwise `transformPastedHTML(html, view)` runs before HTML parsing. During composition (non-Android), paste is left to the browser. — [prosemirror-view input.ts / clipboard.ts (installed 1.42.8)](https://github.com/ProseMirror/prosemirror-view/blob/master/src/clipboard.ts)
- prosemirror-view changelog:
  - 1.41.0: "Make sure `transformPasted` is properly called when pasting into a code block"; "Pass an argument to `transformPasted` that tells the handler whether the paste is plain text".
  - 1.42.0: "The clipboard content parser now inlines simple styles defined in the pasted HTML before parsing it" (helps Google Docs/Word class-based styles).
  - 1.42.3: runs attribute validators on slice-context attributes and fixes trusted-type paste.
  - 1.38.0: `view.serializeForClipboard` exposed as `serializeToClipboard`.
  — [ProseMirror changelog](https://prosemirror.net/docs/changelog/)
- Tiptap Link paste handler (installed): when the selection is not empty and the whole pasted slice text is exactly one linkify link (and `shouldAutoLink` allows it), it runs `setMark(link, { href })`. Link defaults: `linkOnPaste: true`, `autolink: true`, `openOnClick: true`, `enableClickSelection: false`, `defaultProtocol: 'http'`, `protocols: []`. 3.32.3: "Pasting a link without a protocol now uses the `defaultProtocol` option instead of always falling back to `http`." — [pasteHandler.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-link/src/helpers/pasteHandler.ts); [link.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-link/src/link.ts); [v3.32.3](https://github.com/ueberdosis/tiptap/releases)
- Tiptap CodeBlock `codeBlockVSCodeHandler` (installed): outside a code block, if the clipboard has `vscode-editor-data` with a `mode`, it inserts a code block with that language and strips `\r`. Inside a code block it returns false and lets PM paste plain text. — [code-block.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-code-block/src/code-block.ts)
- Tiptap core `clipboardTextSerializer` has a `blockSeparator` option (via `coreExtensionOptions.clipboardTextSerializer.blockSeparator`) that controls the plain text written on copy. — [Editor.ts / clipboardTextSerializer.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/extensions/clipboardTextSerializer.ts)
- Outline's `PasteHandler`, in order:
  1. In code (inclusive): `tr.insertText(text)` and return.
  2. If not Shift: HTML containing `data-pm-slice` (copied from a ProseMirror editor) uses the HTML parser. HTML containing `font-claude-response-body` (copied from Claude) also uses the HTML parser.
  3. A single URL: wrap the selection as a link, or offer an embed/mention menu.
  4. VS Code paste with a non-markdown language → code block.
  5. If `isMarkdown(text)` (and not Dropbox Paper, images or tables), or `vscode mode === 'markdown'`, or Shift held, or no HTML: parse markdown with `normalizePastedMarkdown`. A single paragraph is unwrapped and inserted inline.
  6. Otherwise fall back to the default HTML parser.
  It tracks `shiftKey` via `handleDOMEvents.keydown/keyup`. — [outline/outline app/editor/extensions/PasteHandler.tsx](https://github.com/outline/outline/blob/main/app/editor/extensions/PasteHandler.tsx)
- Outline `isMarkdown(text)`: counts signals (fences ≥2, `$latex$`, `[..](https://..)` ×2, relative links ×2, `^#{1,6}\s+\S+`, `^[-*]\s\S+`, table separators `|---|`). Returns `signals > min(3, floor(lines/5))`. — [outline/outline shared/editor/lib/isMarkdown.ts](https://github.com/outline/outline/blob/main/shared/editor/lib/isMarkdown.ts)

### Inferences
- For Lor (an AI chat app), users will often paste from Claude/ChatGPT, VS Code and terminals. Copy Outline's ordering: code context → plain; PM/Claude HTML → HTML parser; single URL over a selection → link (already done by Link); VS Code → code block (already done by CodeBlock); markdown-looking text with no or poor HTML → `editor.markdown.parse`. Since headings and blockquotes are disabled in the schema, parsed headings collapse to paragraphs via schema fitting. Verify that output.
- Google Docs/Word cleanup: prosemirror-view 1.42.0 already inlines class styles. A `transformPastedHTML` that strips `<meta>`, `<style>`, Google's `<b style="font-weight:normal" id="docs-internal-guid-…">` wrapper and Word `mso-` spans remains common practice. No Tiptap-official cleaner was found.
- Cmd+Shift+V plain paste works by default (PM `shiftKey` path). Make sure no custom `handlePaste` ignores Shift. Outline instead re-parses Shift-paste as markdown, which is a product choice.

### Gaps
- No primary source for a maintained Google Docs/Word HTML sanitizer specific to Tiptap v3.

## 7. Mentions and suggestions (@tiptap/suggestion pitfalls, positioning, keyboard, atom caret)

### Takeaway
`@tiptap/suggestion` 3.32 is much richer than the v2 docs most examples copy. It has managed Floating UI positioning (`props.mount(element)` returns `unmount`), `placement`/`offset`/`flip`/`container`/`floatingUi` middleware, `debounce`, `minQueryLength`, `initialItems`, an `AbortSignal` passed to async `items()`, a `loading` flag, `dismissOnOutsideClick`, `shouldResetDismissed`, and Escape that always closes and keeps the range dismissed. Atom inline mentions (`contenteditable=false`) still have WebKit caret issues. prosemirror-view ≥1.42.6 inserts an `img.ProseMirror-separator` hack node before atoms at line start and after trailing non-editable inlines in Safari and Chrome.

### Cited Findings
- Suggestion defaults (installed 3.32.2): `char: '@'`, `allowSpaces: false`, `allowToIncludeChar: false`, `allowedPrefixes: [' ']`, `startOfLine: false`, `decorationTag: 'span'`, `decorationClass: 'suggestion'`, `decorationContent: ''`, `decorationEmptyClass: 'is-empty'`, `minQueryLength: 0`, `debounce: 0`, `placement: 'bottom-start'`, `offset: { mainAxis: 4, crossAxis: 0 }`, `flip: true`, `dismissOnOutsideClick: true`, `allow: () => true`, plus `findSuggestionMatch`, `shouldShow` and `shouldResetDismissed` hooks. `items({ query, editor, signal })` may be async. Render hooks: `onBeforeStart`, `onStart`, `onBeforeUpdate`, `onUpdate`, `onExit`, `onKeyDown`. `SuggestionProps` include `mount`, `floatingUi`, `clientRect`, `decorationNode` and `loading`. — [suggestion.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/suggestion.ts); [types.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/types.ts)
- `mount` doc (installed): "Mounts your floating element and takes over positioning — the recommended, default way to render a suggestion popup... appends it into the configured `container` (default `document.body`), keeps it anchored to the cursor, and repositions it on scroll, resize, and layout shifts — no manual listeners required. Returns an `unmount` function... call it in `onExit`." Example: `onStart: props => { component = new ReactRenderer(DropdownList, { props, editor: props.editor }); unmount = props.mount(component.element) }, onExit: () => unmount?.()`. — [types.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/types.ts)
- Escape (installed `plugin/props.ts`): on `Escape`/`Esc`, the consumer's `onKeyDown` is called, but the plugin "always clear[s]" the active state with a metadata-only transaction (dismissed range). Reactivation follows `shouldResetDismissed` (default: stay dismissed at the same `range.from` until whitespace is inserted). Older issue #6898 reported `onKeyDown` not firing on Esc. — [plugin/props.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/plugin/props.ts); [helpers.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/helpers.ts); [Issue #6898](https://github.com/ueberdosis/tiptap/issues/6898)
- IME-aware suggestion state (installed `plugin/state.ts`): it tracks `editor.view.composing`, keeps the suggestion alive during composition, and does not exit when the selection briefly leaves the range mid-composition. — [plugin/state.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/plugin/state.ts)
- Match regex (installed `findSuggestionMatch.ts`): with `allowSpaces`, `${prefix}${char}.*?(?=\s${char}|$)`; otherwise `${prefix}(?:^)?${char}[^\s${char}]*`. `allowSpaces` is ignored when `allowToIncludeChar` is true. — [findSuggestionMatch.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/suggestion/src/findSuggestionMatch.ts)
- Mention defaults (installed): `priority: 101`, `inline: true`, `atom: true`, `selectable: false`, `deleteTriggerWithBackspace: false`, `suggestions: []` (multiple triggers, e.g. `@` and `#`), `renderText`, `renderHTML`, `renderLabel`. Backspace right after a mention replaces the whole node with its trigger char (reopening the popup) unless `deleteTriggerWithBackspace: true`. The default `command` inserts `[mention, ' ']`, absorbs one following space, and then calls `ownerDocument.defaultView.getSelection().collapseToEnd()`. — [mention.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-mention/src/mention.ts); [get-default-suggestion-attributes.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-mention/src/utils/get-default-suggestion-attributes.ts)
- WebKit and atom caret history:
  - Tiptap #1264: in Safari, with no text after a mention, the caret cannot be placed after it.
  - Tiptap #2978: the caret cannot be placed between two adjacent "tags", and it vanishes on ArrowLeft.
  - Tiptap #4345: selecting a mention in Safari selects the whole line before it.
  - ProseMirror #1189: Up/Down arrows don't put the cursor before a contenteditable=false atom at line start in Chrome/Safari.
  - ProseMirror #1134: the caret disappears after a non-editable node in bold text.
  — [Tiptap #1264](https://github.com/ueberdosis/tiptap/issues/1264); [Tiptap #2978](https://github.com/ueberdosis/tiptap/issues/2978); [Tiptap #4345](https://github.com/ueberdosis/tiptap/issues/4345); [ProseMirror #1189](https://github.com/ProseMirror/prosemirror/issues/1189); [ProseMirror #1134](https://github.com/ProseMirror/prosemirror/issues/1134)
- prosemirror-view fixes for atoms:
  - 1.42.6 (2026-09-25): "On Safari and Firefox, work around skipped cursor positions... by putting a dummy node in front of atomic inline nodes"; also a Firefox fix for horizontal motion skipping inline atoms.
  - 1.42.4: "Prevent uneditable elements rendered as part of node or mark view from blocking cursor motion".
  - 1.42.8: fixed a 1.42.6 regression in widget wrapping.
  - 1.41.4: workaround for Chrome/Safari inserting a bogus hard break when backspacing the last text before an inline-flex node.
  - 1.41.7: workaround for Chrome inserting a random `<br>` when backspacing before a widget.
  — [ProseMirror changelog](https://prosemirror.net/docs/changelog/)
- Implementation (installed 1.42.8 `viewdesc.ts`): `if (atBufferPos && child.isAtom && !child.isText) updater.addHackNode("IMG", updater.top)`. `addTextblockHacks` adds an `IMG` plus a `BR` when the last child is `contentEditable == "false"` on Safari/Chrome ("Avoid bugs in Safari's cursor drawing (#1165)"). The hack image gets `class="ProseMirror-separator"`. Tiptap's injected CSS forces `img.ProseMirror-separator { display: inline !important; border: none !important; margin: 0 !important; width: 0 !important; height: 0 !important; }`. — [prosemirror-view viewdesc.ts](https://github.com/ProseMirror/prosemirror-view/blob/master/src/viewdesc.ts); [Tiptap style.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/style.ts)
- Older community workarounds: wrap the widget with zero-width spaces on both sides, or set `display: inline-block` on the node DOM. — [ProseMirror #1069 / discuss (search summary)](https://github.com/ProseMirror/prosemirror/issues/1069)

### Inferences
- Two likely sources of mention jank in an app that copied v2-era examples: (1) a hand-rolled popup positioning loop (tippy-style or manual `clientRect` listeners) where 3.32's `props.mount()` would track scroll and resize, and (2) Enter handled by the composer before the suggestion (section 3). Also consider `debounce` + `signal` for remote member search, and `initialItems` for instant recent-people lists.
- Since prosemirror-view 1.42.6+ adds separator images, check that app CSS does not override `img` inside `.ProseMirror` (e.g. global `img { display:block }` with higher specificity, or `!important` utilities). Remove any legacy zero-width-space hacks in the mention node view, because they now double up with PM's own hack nodes.
- Decide Backspace-on-mention behaviour deliberately. Slack-style deletion of the whole token needs `deleteTriggerWithBackspace: true`. The default leaves `@` and reopens the popup, which many users read as glitchy.

### Gaps
- No primary-source confirmation that the 1.42.6 dummy-node fix resolves the specific "caret after last mention at end of line" case in WKWebView (macOS). Device QA is required.

## 8. WebKit / Safari / WKWebView (Tauri) specifics

### Takeaway
ProseMirror treats Tauri's macOS WKWebView as Safari (`/Apple Computer/.test(navigator.vendor)`). So its Safari IME, caret and selection workarounds apply. Keymaps and `editorProps.handleKeyDown` are not called during composition or within 500 ms after `compositionend` on Safari. A React `onKeyDown` on a wrapper has no such guard. macOS adds two native layers in WebKit: text substitution (smart quotes and dashes, gated by `spellcheck`) and inline predictions (gated by `writingsuggestions="false"` since Safari 18). Scroll-into-view walks every scrollable ancestor up to the window unless a `fixed`/`sticky` ancestor stops it.

### Cited Findings
- Browser detection (installed 1.42.8): `safari = !ie && !!nav && /Apple Computer/.test(nav.vendor)`; `webkit = "webkitFontSmoothing" in document.documentElement.style`. — [prosemirror-view browser.ts](https://github.com/ProseMirror/prosemirror-view/blob/master/src/browser.ts)
- Keydown guard (installed): `editHandlers.keydown` returns early if `inOrNearComposition(view)`. That is true when `view.composing`, or on Safari when `Math.abs(Date.now() - view.input.compositionEndedAt) < 500` (once), because "On Safari, when Enter is pressed, compositionend and keydown events are emitted". Only after this check does it call `view.someProp("handleKeyDown")`. On iOS, Enter is deferred via `lastIOSEnter` with a 200 ms fallback. — [prosemirror-view input.ts](https://github.com/ProseMirror/prosemirror-view/blob/master/src/input.ts)
- Plane PR #8893 ("prevent IME composition Enter from triggering submit actions") notes that ProseMirror's `editHandlers.keydown` already guards via `inOrNearComposition` with the Safari 500 ms grace, "so addKeyboardShortcuts in Tiptap extensions are never invoked during IME composition". — [makeplane/plane PR #8893](https://github.com/makeplane/plane/pull/8893)
- prosemirror-view 1.42.9 (2026-10-31, after the installed 1.42.8):
  - "Fix an issue where the editor could dispatch Enter or Backspace keys during composition"
  - "Fix an issue where `handleKeyDown` could be called multiple time for a single backspace press"
  - "Remove an obsolete kludge that could interfere with the selection on focus"
  - "Fix an issue that could cause a selection change right after focus to be overwritten by the old selection"
  `@tiptap/pm@3.32.2` depends on `prosemirror-view: ^1.42.6`, so 1.42.9 is in range (a lockfile bump). — [ProseMirror changelog](https://prosemirror.net/docs/changelog/); [@tiptap/pm package.json (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/pm/package.json)
- Other Safari entries:
  - 1.41.0: "Work around a Safari issue that broke composition right after changing the set of active marks" (e.g. Cmd+B then typing with an IME).
  - 1.41.5: Chrome misreporting cursor and breaking composition; a Safari table-cell composition bug.
  - 1.42.7: Safari shadow-root selection fixes; "Avoid a selection read in DOM flushing when the editor doesn't have focus".
  - 1.39.3: "Only delete the selection when starting a composition when it crosses block boundaries".
  - 1.38.1: fixes to scrolling the selection back into view after focus, and not scrolling parents of absolutely positioned elements inappropriately.
  — [ProseMirror changelog](https://prosemirror.net/docs/changelog/)
- Tiptap side: 3.32.3 "Bubble menus now update correctly after IME input, including Korean text" (same for floating menus). 3.31.4 fixed Enter/Shift-Enter inside React node views on iOS/Android (`handleMobileEnter` re-dispatches `insertParagraph`/`insertLineBreak` beforeinput as synthetic keydown through `handleKeyDown`, after `domObserver.forceFlush()`). — [v3.32.3 release](https://github.com/ueberdosis/tiptap/releases); [handleMobileEnter.ts (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/react/src/handleMobileEnter.ts)
- Scroll (installed `scrollRectIntoView`): reads `scrollThreshold` (default 0) and `scrollMargin` (default 5) props, each a number or `{top,right,bottom,left}`. It walks from the editor DOM through every ancestor, adjusting `scrollTop`/`scrollLeft` (or `window.scrollBy` at `body`), and stops when an ancestor's computed `position` is `fixed` or `sticky`. `handleScrollToSelection` can override the whole behaviour. — [prosemirror-view domcoords.ts](https://github.com/ProseMirror/prosemirror-view/blob/master/src/domcoords.ts)
- Native text substitution: WebKit gates smart quote and dash substitution through spellchecking. Setting `spellcheck=false` (with `autocorrect="off"`, `autocapitalize="off"`) stops smart quotes, dashes and text replacements but removes spelling underlines. — [OpenBitFun PR #3684](https://github.com/GCWing/OpenBitFun/pull/3684); [Tauri discussion #7635](https://github.com/tauri-apps/tauri/discussions/7635)
- Inline predictions: an Apple forum report says `WKWebViewConfiguration.allowsInlinePredictions = false`, `writingToolsBehavior = .none` and the spellcheck/autocorrect attributes did not stop inline predictions breaking a contenteditable editor in WKWebView on Mac. Apple DTS asked for a Feedback report. — [Apple Developer Forums thread 800476](https://developer.apple.com/forums/thread/800476)
- WebKit for Safari 18.0 (macOS Sequoia and Sonoma, iOS 18) added the `writingsuggestions` attribute. "You can turn off the capability by including the writingsuggestions="false" attribute on any type of text input field." It is a WHATWG global attribute. — [WebKit Features in Safari 18.0](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/); [MDN writingsuggestions](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/writingsuggestions)
- Tiptap sets editor DOM attributes via `editorProps.attributes` (merged in `getEditorViewAttributes`). Core injected CSS: `.ProseMirror { white-space: pre-wrap; white-space: break-spaces; word-wrap: break-word; font-variant-ligatures: none; font-feature-settings: "liga" 0 }`, plus `[contenteditable="false"] { white-space: normal }`. — [Tiptap style.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/style.ts); [Editor.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/Editor.ts)

### Inferences
- Bump prosemirror-view to 1.42.9 (in range). Its composition Enter/Backspace and focus-selection fixes map directly onto "janky" reports: the caret jumping after focus, and Enter acting during Japanese/Chinese/Korean composition.
- Keep Enter-to-send inside ProseMirror's keydown path (keymap or `handleKeyDown`), never a React `onKeyDown` on a parent. If any parent handler exists, guard it with `event.isComposing || event.keyCode === 229`.
- For the Tauri build, set `editorProps.attributes` to `{ spellcheck: 'false' | 'true' (product choice), autocorrect: 'off', autocapitalize: 'off', writingsuggestions: 'false' }`. Treat `writingsuggestions` in WKWebView as needing on-device verification, given the forum report.
- Auto-growing composer in a `max-height` scroller: ProseMirror will also scroll the window or ancestors unless the composer sits in a `position: sticky/fixed` container. Set `scrollMargin`/`scrollThreshold` (e.g. `{ top: 8, bottom: 8 }`) so the caret line isn't flush with the clip edge. Use `handleScrollToSelection` if the message list behind it must never move.

### Gaps
- No authoritative source on whether WKWebView in Tauri 2 honours `writingsuggestions="false"` on macOS 15/26. The forum thread predates or does not mention it.
- No source found for WKWebView-specific double-click word selection issues in ProseMirror. Only general click-grouping fixes appear (1.39.3).

## 9. Link UX (options, editing bubble menus, Cmd+K)

### Takeaway
Link v3 has `autolink`, `linkOnPaste`, `openOnClick`, `enableClickSelection`, `defaultProtocol`, `protocols`, `isAllowedUri(url, ctx)`, `shouldAutoLink(url)`, `validate` (deprecated in favour of `isAllowedUri`) and the new `markdownLinks`. It is `exitable` (ArrowRight leaves the mark), `keepOnSplit: false`, and trailing whitespace no longer extends a link (3.31.4). There is no built-in Mod-K binding. Cmd+K is app-level, typically a BubbleMenu or popover plus the `Selection` extension.

### Cited Findings
- Link option defaults (installed): `openOnClick: true`, `enableClickSelection: false`, `linkOnPaste: true`, `autolink: true`, `protocols: []`, `defaultProtocol: 'http'`, `HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow', class: null }`, `isAllowedUri: (url, ctx) => !!isAllowedUri(url, ctx.protocols)`, `validate: url => !!url`, `shouldAutoLink` (default rejects some patterns), `markdownLinks: false`. The mark has `keepOnSplit: false`, `exitable: true` and a dynamic `inclusive()` (tied to autolink). — [link.ts](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-link/src/link.ts)
- Helpers: `autolink.ts`, `clickHandler.ts` (open or select on click), `pasteHandler.ts`, `markdownLink.ts`, `unlinkTrailingWhitespace.ts`, `whitespace.ts`. 3.31.4: "Typing spaces after a link no longer extends the link, including multiple spaces inserted in one transaction." 3.32.3: protocol-less paste uses `defaultProtocol`. — [extension-link helpers](https://github.com/ueberdosis/tiptap/tree/main/packages/extension-link/src/helpers); [Tiptap releases](https://github.com/ueberdosis/tiptap/releases)
- BubbleMenu v3 (Floating UI, `@tiptap/react/menus`). Options: `element`, `pluginKey`, `updateDelay` (plugin default 250 ms), `resizeDelay`, `appendTo`, `getReferencedVirtualElement`, `shouldShow`, `options` (Floating UI: `placement`, `offset`, `flip`, `shift`, `arrow`, `size`, `autoPlacement`, `hide`, `inline`, `scrollTarget`). `tippyOptions` were removed (v2-only). — [bubble-menu-plugin.ts (installed)](https://github.com/ueberdosis/tiptap/blob/main/packages/extension-bubble-menu/src/bubble-menu-plugin.ts); [upgrade guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2)
- Liveblocks Composer offers formatting via a selection-triggered floating toolbar (`showFormattingControls`, `Composer.FloatingToolbar`, `Composer.MarkToggle`), automatic link detection (`Composer.Link`), `pasteFilesAsAttachments`, `blurOnSubmit`, `collapsed`/`defaultCollapsed` and `createMention()`. — [Liveblocks React UI Composer docs](https://liveblocks.io/docs/api-reference/liveblocks-react-ui#Composer)

### Inferences
- In a composer, `openOnClick: true` is usually wrong while editing (a click to place the caret opens a tab). Prefer `openOnClick: false`, or Cmd+click to open, with `enableClickSelection: true` so a click selects the whole link for a Cmd+K edit popover.
- Restrict `protocols`/`isAllowedUri` to http(s)/mailto and set `defaultProtocol: 'https'` (now honoured on paste as of 3.32.3; 3.32.2 still falls back to http on paste).
- `markdownLinks: true` lets users type `[label](url)`, which fits a markdown-sending chat.
- BubbleMenu's 250 ms `updateDelay` can feel laggy or flickery when selecting text. Tune `updateDelay` and use a narrow `shouldShow` (non-empty text selection, not in code block, editor focused).

### Gaps
- No official Tiptap Cmd+K link UX guide for v3 was found. Tiptap UI Components (paid/templated) include link popovers but were not reviewed.

## 10. What open-source TipTap/ProseMirror products do well (techniques to copy)

### Takeaway
The best copyable techniques are concrete. Plane: Enter sends unless a dropdown is open, Shift+Enter does structural splits, and IME guarding relies on PM. Outline: a layered paste handler with a markdown-likelihood heuristic, VS Code language detection, PM-HTML and Claude-HTML passthrough, and single-URL handling. ocavue's prosemirror-highlight: lazy Shiki via decorations. Liveblocks: a selection-only floating toolbar, auto-detected links, file paste into attachments, and a collapsed state.

### Cited Findings
- Plane `EnterKeyExtension` and the `activeDropbarExtensions` storage pattern (open menus register themselves so Enter falls through). — [plane enter-key.ts](https://github.com/makeplane/plane/blob/preview/packages/editor/src/extensions/enter-key.ts)
- Plane PR #8893 analysis of IME composition Enter. — [plane PR #8893](https://github.com/makeplane/plane/pull/8893)
- Outline `PasteHandler` ordering and `isMarkdown` heuristic (section 6). — [Outline PasteHandler.tsx](https://github.com/outline/outline/blob/main/app/editor/extensions/PasteHandler.tsx); [isMarkdown.ts](https://github.com/outline/outline/blob/main/shared/editor/lib/isMarkdown.ts)
- prosemirror-highlight lazy Shiki parser. — [ocavue/prosemirror-highlight](https://github.com/ocavue/prosemirror-highlight)
- Liveblocks Composer feature set. — [Liveblocks Composer docs](https://liveblocks.io/docs/api-reference/liveblocks-react-ui#Composer)

### Inferences
- The `font-claude-response-body` passthrough in Outline signals that pasting from AI chat UIs is a first-class case worth handling in Lor.

### Gaps
- GitLab (content editor), Novel, BlockNote, Cal.com, Mattermost and Rocket.Chat composer code was not reviewed within the time budget. Linear's ProseMirror editor is closed source. No verified techniques from those are included.

## 11. Brief comparison: Lexical, Plate/Slate, Liveblocks (ideas to port, not migration)

### Takeaway
What others provide out of the box that maps to Tiptap ports:
- Lexical's explicit command priorities (`COMMAND_PRIORITY_*`) make "menu first, then send" composable. Port: an Enter-to-send extension with priority below Mention plus storage-based menu registration.
- Liveblocks ships a chat-shaped composer: a selection-triggered toolbar, link detection, file paste into attachments, a collapsed state and `blurOnSubmit`.
- Plate/Slate was not researched in depth.

### Cited Findings
- Lexical priorities `COMMAND_PRIORITY_EDITOR/LOW/NORMAL/HIGH/CRITICAL` (0–4). The typeahead menu registers Enter/Arrow/Tab/Escape listeners while open. Chat send uses `KEY_ENTER_COMMAND` at LOW, and Shift → `INSERT_PARAGRAPH_COMMAND`. Markdown export used `$convertToMarkdownString(transformers, undefined, true)` (`shouldPreserveNewLines`) to keep line breaks. — [Lexical API](https://lexical.dev/docs/api/modules/lexical); [Lexical discussion #7060](https://github.com/facebook/lexical/discussions/7060)
- Liveblocks Composer props: `showFormattingControls`, `showAttachments`, `pasteFilesAsAttachments`, `blurOnSubmit`, `collapsed`/`defaultCollapsed`, `autoFocus`, `onComposerSubmit`, and the `useComposer().createMention()` helper. — [Liveblocks Composer docs](https://liveblocks.io/docs/api-reference/liveblocks-react-ui#Composer)

### Inferences
- `createMention()` (programmatically insert `@` and open the popup from a button) is easy to port with `editor.chain().focus().insertContent('@').run()`. Suggestion picks it up because `allowedPrefixes` includes a space or line start.

### Gaps
- Plate/Slate chat-composer specifics were not researched. No sourced claims about them are included.
- Which editor engine Liveblocks Composer uses was not confirmed by the fetched docs.
