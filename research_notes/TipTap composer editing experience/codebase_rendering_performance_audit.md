# TipTap composer: rendering, performance, layout and platform audit (source-code audit, HEAD `696ee2ee` on `dev`, 2026-11-07)

Method: read-only audit of the composer and its hosts, plus the installed TipTap 3.32.2, prosemirror-view 1.42.8 and use-sync-external-store 1.6.0 sources. Nothing was run (no dev server, no tests, no profiling). "Confirmed" means the code path was traced in source. "Unverified" means behavior that needs a profiler or a real WKWebView to confirm. Paths are repo-relative. `NM/` = `node_modules/.pnpm/`.

Important correction to the brief: the session composer is **not** pinned under the scroller any more. Commit `474179ab` ("feat: replace fixed bottom input with sticky composer", 2026-11-07 05:43 UTC, after `8a391ce5` "pin session composer") moved it back **inside** the scroll content as `sticky bottom-0`. Only the tools bar (`toolbarTarget`) stays pinned under the scroller — [session-document.tsx:749-757, 769-772](apps/web/src/components/session/session-document.tsx).

## 1. Re-render cost: what runs on every keystroke and every host render?

### Takeaway
`shouldRerenderOnTransaction` is off (TipTap 3 default), but three app `useEditorState` selectors still re-render the whole ~1,800-line `MessageInput` on almost every keystroke. Each render then makes two more editor passes: the `<BubbleMenu>` dispatches an extra transaction, and `useEditor` calls `editor.setOptions()`. Inline props cause both. `MessageInput` is not memoized, so every host re-render does this too, and that includes every Lor stream frame in a session. This is the largest structural source of typing lag.

### Cited Findings
- **Defaults confirmed.** `immediatelyRender` defaults to `true` outside SSR/Next (the editor is created on the first render, so there is no blank first frame). `shouldRerenderOnTransaction` defaults to `false`: the hook's own selector returns `null` when the option is `undefined`. The composer passes neither option. — [NM/@tiptap+react@3.32.2…/src/useEditor.ts:23-29, 96-115, ~359-375](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/useEditor.ts); [message-input.tsx:829-924](apps/web/src/components/chat/composer/message-input.tsx)
- **Three app selectors, all doing O(doc) work per transaction:**
  - `draftState` calls `editor.getText({blockSeparator:"\n"})`, which serializes the full document, and also reads `isEmpty`, `isFocused` and the first child type — [message-input.tsx:926-938](apps/web/src/components/chat/composer/message-input.tsx)
  - `mentionedIdsKey` runs `state.doc.descendants(...)` over the full document to collect mention ids — [message-input.tsx:944-953](apps/web/src/components/chat/composer/message-input.tsx)
  - `markState` makes 5× `isActive`, 1× `getAttributes("codeBlock")` and 1× `getActiveCodeBlockPos` — [message-input.tsx:1244-1271](apps/web/src/components/chat/composer/message-input.tsx)
  - `text` changes on every character, so `circularDeepEqual` fails and `MessageInput` re-renders on every content keystroke. Caret moves, focus changes and mark changes also re-render it. — [NM/@tiptap+react…/src/useEditorState.ts:172-178](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/useEditorState.ts)
- **Selectors also re-run on every render, not only on transactions.** The selectors are inline arrows, and `useSyncExternalStoreWithSelector` memoizes on `[getSnapshot, getServerSnapshot, selector, isEqual]`. A new selector identity therefore discards the memo, and all 4 selectors (3 app + 1 internal) run again during each render. — [NM/use-sync-external-store@1.6.0_react@19.2.4/…/with-selector.development.js:41-80](node_modules/.pnpm/use-sync-external-store@1.6.0_react@19.2.4/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js)
- **`editor.setOptions()` runs after every render.**
  - `useEffect(instanceManager.onRender(deps))` has no dependency array, so it runs after every render. `compareOptions` compares `extensions` element by element, but `StarterKit.configure(...)`, `CodeBlockShiki.configure(...)`, `Link.configure(...)` and `Mention.configure(...)` build new extension objects on every render, and `editorProps` (with new `handleKeyDown`/`handlePaste` closures) is a new object. The comparison always fails, so `setOptions` runs every time. — [useEditor.ts:172-236](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/useEditor.ts); [message-input.tsx:831-918](apps/web/src/components/chat/composer/message-input.tsx)
  - `setOptions` calls `view.setProps({...editorProps, attributes})` and then `view.updateState(this.state)`: two full ProseMirror `updateStateInner` passes. Each pass recomputes decorations and runs every plugin view's `update()`. — [NM/@tiptap+core@3.32.2…/src/Editor.ts:287-305](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/Editor.ts); [NM/prosemirror-view@1.42.8/src/index.ts:153-182](node_modules/.pnpm/prosemirror-view@1.42.8/node_modules/prosemirror-view/src/index.ts)
- **`<BubbleMenu>` dispatches an extra editor transaction after every render.**
  - Its second effect depends on `shouldShow`, `options`, `appendTo` and `getReferencedVirtualElement`. All four are inline props, so they are new on every `MessageInput` render. Each render therefore runs `view.dispatch(tr.setMeta(pluginKey, {type:'updateOptions'}))`. — [NM/@tiptap+react…/src/menus/BubbleMenu.tsx:129-156](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/menus/BubbleMenu.tsx); [message-input.tsx:1503-1537](apps/web/src/components/chat/composer/message-input.tsx)
  - That transaction goes through `applyTransaction` (all plugin `apply`s and `appendTransaction`s), `view.updateState`, and the `'transaction'` event. The event re-runs all 4 selectors, schedules a DesktopCaret rAF, and calls the BubbleMenu `transactionHandler`. — [Editor.ts:691-775](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/Editor.ts)
- **The hidden bubble menu still renders its buttons on every render.** The children are always portaled (`createPortal(children, menuEl.current)`), so its 4 buttons render on every `MessageInput` render, even when the menu is hidden. Each button calls `editor.can().chain().focus().toggleX().run()`: 4 dry-run command chains per render. — [BubbleMenu.tsx:158](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/menus/BubbleMenu.tsx); [message-input.tsx:1552, 1573, 1594, 1615](apps/web/src/components/chat/composer/message-input.tsx)
- **Draft persistence runs on every `update`.** It calls `editor.getJSON()`, `JSON.stringify` and a synchronous `localStorage.setItem`, with no debounce. — [message-input.tsx:996-1004](apps/web/src/components/chat/composer/message-input.tsx); [lib/composer-drafts.ts:28-41](apps/web/src/lib/composer-drafts.ts)
- **`onUpdate → onTyping` fires on every update, but the hook throttles socket emits to one per 3 s.** — [message-input.tsx:919-921](apps/web/src/components/chat/composer/message-input.tsx); [hooks/use-typing-indicator.ts:11, 34-40](apps/web/src/hooks/use-typing-indicator.ts)
- **The whole subtree re-renders per keystroke.** Nothing is memoized: DestinationBar (framer-motion `AnimatePresence` with a blur filter), ContextMeter, two HintPopovers, the attach Popover with ConnectorAttachMenu, AttachmentPreview, and the host-supplied `tools` (ModelPicker, EffortPicker, ClaudeCodeModePicker in sessions). — [message-input.tsx:1396-1785](apps/web/src/components/chat/composer/message-input.tsx); [session-document.tsx:608-621](apps/web/src/components/session/session-document.tsx)
- **Every host re-render triggers the full sequence, including Lor streaming.**
  - `MessageInput` is a plain function component, not wrapped in `React.memo`, and hosts pass new closures (`onSend`, `onComposerDraftConsumed`, `tools` JSX). — [routes/_authenticated/$workspaceSlug/$channelId.tsx:633-667](apps/web/src/routes/_authenticated/$workspaceSlug/$channelId.tsx); [session-document.tsx:567-641](apps/web/src/components/session/session-document.tsx)
  - Lor stream frames patch the thread/channel messages cache with `queryClient.setQueryData` per frame, with no rAF or throttle, so the host re-renders per frame. In a session, every stream frame therefore causes: `MessageInput` render, 4 selector runs, BubbleMenu meta transaction, `setOptions` (2 PM passes), and a DesktopCaret rAF layout read. This happens while the user may be typing. — [hooks/use-lor-stream.ts:214-238](apps/web/src/hooks/use-lor-stream.ts)
- **Store-driven re-renders block the frame.** `useSyncExternalStore` subscribers call React's forced-sync re-render, so these renders finish before the next paint and cannot be time-sliced. — React behavior, consistent with `useEditorState` using `useSyncExternalStoreWithSelector` ([useEditorState.ts:172](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/useEditorState.ts)). Unverified by profiling.
- **TipTap's own guidance:** "The editor should be isolated from renders that don't affect it", and `useEditorState` selectors exist to avoid full re-renders. — [Tiptap performance guide](https://tiptap.dev/docs/guides/performance)
- **The edit input has the same `setOptions`-per-render pattern** (inline `StarterKit.configure`/`Link.configure`/`Mention.configure` and inline `editorProps`). — [message-edit-input.tsx:46-89](apps/web/src/components/chat/message-edit-input.tsx)

### Inferences
- **Per content keystroke (confirmed structure, unmeasured cost):**
  - 1 real transaction, plus 1 BubbleMenu meta transaction, plus 2 `setOptions` PM passes. That is about 4 `updateStateInner` passes.
  - `getText` runs about 3× (store check, render, meta-transaction check). `doc.descendants` runs about 3× in selectors, plus 1× in the Shiki plugin.
  - 1× `getJSON` + `stringify` + `localStorage` write.
  - 1 full React render of `MessageInput` and its unmemoized children.
  - Each piece is cheap for short drafts. The React reconciliation and the duplicate PM passes are the parts that scale with UI complexity and with host churn (streaming).
- **Fix directions, all within TipTap:**
  - Hoist the extension array and `editorProps` into a `useMemo` or a module-level factory. Use refs for callbacks, as the code already does for `onTyping`/`addFiles`. This makes `compareOptions` pass, so `setOptions` stops running.
  - Hoist the BubbleMenu `shouldShow`, `getReferencedVirtualElement`, `appendTo` and `options` to module scope or `useCallback`/`useMemo`. This stops the per-render meta transaction.
  - Move the bubble menu buttons into a child component that owns its own `useEditorState` for mark state. Drop the `can()` calls (they are always true for these marks outside code blocks, and the menu already hides inside code blocks).
  - Split `MessageInput` so the editor and the chrome live in separate components:
    - Replace `text: getText()` with cheap booleans: `isEmpty`, plus `hasNonWhitespace` from `doc.textContent.trim() !== ""` or a quick scan that stops at the first non-whitespace character.
    - Compute `plainText` lazily in `handleSubmit` instead of during render.
    - Derive mention ids only on `docChanged`, for example in a plugin that caches the ids keyed by doc. Or compare `editor.state.doc` identity in a `useRef` before walking.
    - Pass a stable `equalityFn`.
  - Wrap the composer in `React.memo` with stable props, so stream frames don't reach it.
  - Debounce `writeComposerDraft`, and flush it on `blur`/`visibilitychange`/`pagehide`/unmount.

**Cross-cutting priority ranking (impact on felt jank):**
1. Composer re-renders and extra editor passes on every keystroke and every stream frame (this section).
2. Synchronous Shiki tokenization and full-doc decoration rebuild (section 2).
3. Bubble menu: 250 ms lag, ignores inner scroll (section 7).
4. WYSIWYG drift after send (section 6).
5. Focus gaps: no autofocus on channel switch, dead click zones, focus lost after attaching a record (section 5).
6. Edit input IME and Escape bugs (section 8).
7. Session sticky composer one-frame overlap and nested scrollers (section 4).
8. Gapcursor invisible in dark mode, trailing empty paragraph after lists/code (sections 3/4).

### Gaps
- No profiler traces. The real per-keystroke milliseconds in Chrome and WKWebView, and the per-stream-frame composer cost, are unmeasured.
- I did not confirm whether `ChatContext`/`context` objects or `mentionCandidates` arrays from hosts are referentially stable. Unstable ones re-run `normalizedMentionCandidates`/`routing` memos. The `mentionCandidates = []` default ([message-input.tsx:695](apps/web/src/components/chat/composer/message-input.tsx)) creates a new array on every render when the prop is omitted.

## 2. Typing latency in long drafts and Shiki cost in code blocks

### Takeaway
Shiki loads lazily and asynchronously. Once a language is loaded, though, the block being edited is re-tokenized **synchronously on every keystroke** inside the plugin's `apply`. On top of that, every doc change anywhere rebuilds a full `DecorationSet` for all code blocks. Code blocks also use a React node view that re-renders, including its Base UI `Select`, on every keystroke inside the block.

### Cited Findings
- **Token cache keyed by node.** Unchanged code blocks reuse their tokens, but the edited block gets a new node, so `highlighter.codeToTokens(node.textContent, …)` runs synchronously for the whole block on each keystroke (JS regex engine, dual themes). — [code-block-shiki.ts:26-28, 74-99](apps/web/src/components/chat/composer/code-block-shiki.ts)
- **Full decoration rebuild on every doc change.** `apply` calls `buildDecorations(newState.doc)` whenever `tr.docChanged`. That walks the whole document (`descendants` returns `true` for non-code nodes) and creates new `Decoration.inline` objects for every token of every code block, then a new `DecorationSet.create`. It does not map the old set through `tr.mapping`. — [code-block-shiki.ts:101-118, 133-144](apps/web/src/components/chat/composer/code-block-shiki.ts)
- **Highlighting arrives late or not at all.**
  - Languages load on demand. Until they load, the block renders unhighlighted, and then a refresher dispatches a meta transaction, so colors pop in after a delay. — [code-block-shiki.ts:30-54, 145-153](apps/web/src/components/chat/composer/code-block-shiki.ts)
  - The default language is `plaintext`, which `resolveLanguage` maps to "no highlighting". A code block inserted from the `/` menu therefore never highlights until the user picks a language. — [code-block-shiki.ts:56-63](apps/web/src/components/chat/composer/code-block-shiki.ts); [message-input.tsx:449-456](apps/web/src/components/chat/composer/message-input.tsx)
- **The code block node view re-renders per keystroke.** It is a `ReactNodeViewRenderer(CodeBlockView)`, and TipTap's React node view re-renders the component whenever the node reference changes, which is every keystroke inside the block. The view contains a Base UI `Select` with 12 items. — [code-block-shiki.ts:126-128](apps/web/src/components/chat/composer/code-block-shiki.ts); [NM/@tiptap+react…/src/ReactNodeViewRenderer.tsx:319-339](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/ReactNodeViewRenderer.tsx); [code-block-view.tsx:47-77](apps/web/src/components/chat/composer/code-block-view.tsx)
- **Large pastes become attachments.** Pastes over 4,000 characters become a `.txt` attachment, which bounds draft size from paste. Typed or appended content is not bounded. — [message-input.tsx:108-112, 898-917](apps/web/src/components/chat/composer/message-input.tsx)
- **Other per-transaction plugins:** Link `autolink`, three Suggestion plugins (`@`, `/`, `$`), TrailingNode, UndoRedo and the StarterKit input rules. — [message-input.tsx:831-870](apps/web/src/components/chat/composer/message-input.tsx); [NM/@tiptap+starter-kit@3.32.2/src/starter-kit.ts:183-270](node_modules/.pnpm/@tiptap+starter-kit@3.32.2/node_modules/@tiptap/starter-kit/src/starter-kit.ts)

### Inferences
- **Long code blocks will cost time per keystroke.** In a 100–300 line block, synchronous Shiki tokenization per keystroke is probably several milliseconds or more on the main thread (unverified), and it adds to the section 1 costs.
- **Fix directions:**
  - In `apply`, map the previous `DecorationSet` through `tr.mapping`, and only re-tokenize blocks whose node changed.
  - Debounce the re-tokenization (rAF or about 100 ms idle) and show the mapped old decorations meanwhile.
  - Consider Shiki's grammar-state APIs to tokenize only from the edited line.
  - Give `ReactNodeViewRenderer` an `update` option (or memoize the header) so typing doesn't re-render the `Select`.
  - Preload the highlighter and common languages when a code block is first created, or on composer focus.

### Gaps
- No timing data for `codeToTokens` with the JS regex engine at typical block sizes in WKWebView.
- Link autolink cost in long drafts was not traced.

## 3. Caret: what DesktopCaret does and where it can misbehave

### Takeaway
On macOS Tauri only, DesktopCaret hides the native caret (`caret-color: transparent`) and paints a 1px-wide, at most 16px-tall `<span>`, positioned from the DOM selection in a rAF and blinking via the Web Animations API. It updates the same frame and survives container moves. Its weak spots:
- soft-wrap affinity,
- a fixed 16px height (shorter than text at 15px/24px),
- it hides itself for gap cursors and node selections,
- the gap cursor TipTap draws is black, so it is invisible in dark mode,
- the message edit input and other TipTap editors don't use it, so caret looks differ between surfaces.

### Cited Findings
- **Gating and native caret hiding.** It is gated on `useDesktopChrome().isMacDesktop`. It sets `data-desktop-caret` on the editable, and globals.css makes `caret-color: transparent` under `.tauri-macos-window`. The comment says the native WKWebView caret "can persist at old composer positions." — [desktop-caret.tsx:7-12, 30-32](apps/web/src/components/chat/composer/desktop-caret.tsx); [packages/ui/src/styles/globals.css:670-675](packages/ui/src/styles/globals.css)
- **Update triggers.** Updates are coalesced into one `requestAnimationFrame`, triggered by:
  - editor `transaction`/`focus`,
  - `selectionchange`,
  - capture-phase `scroll` on the document (catches inner scrollers),
  - window `resize`/`focus`,
  - `visibilitychange`,
  - a ResizeObserver on the container and the editable.
  - It hides on blur, window blur, non-`TextSelection`, non-collapsed selection, or a DOM focus outside the editor. — [desktop-caret.tsx:41-58, 114-130](apps/web/src/components/chat/composer/desktop-caret.tsx)
- **Position source.** It uses the first non-zero-height rect from `domSelection.getRangeAt(0).getClientRects()`, falling back to `view.coordsAtPos(head)`. The comment claims "DOM ranges preserve which side of a soft wrap the caret occupies." — [desktop-caret.tsx:67-72](apps/web/src/components/chat/composer/desktop-caret.tsx)
- **Size and clipping.** Height is `Math.min(16, lineHeight)`, vertically centered in the line rect. The line height is 20px in the box variant and 24px inline (15px text), and 24px in code blocks. The caret hides when any part falls outside the editor scroller's rect. — [desktop-caret.tsx:73-85](apps/web/src/components/chat/composer/desktop-caret.tsx); [message-input.tsx:874, 1477-1478](apps/web/src/components/chat/composer/message-input.tsx)
- **Blink.** On every position change it cancels the animation and restarts it (solid for 500 ms, then 1 s period, `steps(1,end)`). Reduced motion gives a solid caret. — [desktop-caret.tsx:89-111](apps/web/src/components/chat/composer/desktop-caret.tsx)
- **Positioning model.** The caret is absolutely positioned inside the editor wrapper (`caret.parentElement`) with `translate`. Container moves (sticky composer, typing lines growing above it) carry it along. Zoom and transform are handled by `scale = bounds.width / offsetWidth`. — [desktop-caret.tsx:15-23, 59-66, 87-91](apps/web/src/components/chat/composer/desktop-caret.tsx)
- **Gap cursor.** TipTap injects `.ProseMirror-gapcursor:after { border-top: 1px solid black; … }`. StarterKit enables Gapcursor, and the composer doesn't disable it. Block atoms such as `LinearIssue` (`group: "block", atom: true`) create gap-cursor positions. DesktopCaret hides on any non-`TextSelection`, so at a gap cursor the user sees no caret in dark mode. — [NM/@tiptap+core@3.32.2…/src/style.ts](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/style.ts); [linear-issue-node.tsx:60-66](apps/web/src/components/chat/composer/linear-issue-node.tsx); [desktop-caret.tsx:49](apps/web/src/components/chat/composer/desktop-caret.tsx)
- **Not used everywhere.** `MessageEditInput` does not render DesktopCaret and does not set a caret color, so editing a message on desktop shows the native WKWebView caret, which is the one with the stale-paint bug. — [message-edit-input.tsx:158-164](apps/web/src/components/chat/message-edit-input.tsx)
- **Inline chips.** `ConnectorChip` and `RepoFileChip` are inline atom React node views (`inline-flex` with `py-0.5`). Mentions are inline atoms that ProseMirror makes `contenteditable=false`. ProseMirror's separator/trailing-break hacks (`img.ProseMirror-separator` CSS is injected) cover a textblock that ends in an atom. — [connector-chip.tsx:44-60, 70-75](apps/web/src/components/chat/composer/connector-chip.tsx); [repo-file-chip.tsx:51-55](apps/web/src/components/chat/composer/repo-file-chip.tsx); [style.ts](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/style.ts)
- **WebKit has real stale-caret history.** For example, bug 176896 ("wrong caret position … fixed position parents", WKWebView): the web process does not recompute the caret rect on a viewport change. — [WebKit bug 176896](https://bugs.webkit.org/show_bug.cgi?id=176896)

### Inferences
- **Soft-wrap affinity (unverified).** A collapsed DOM `Range` carries no affinity, so a caret at a soft-wrap boundary (End/Cmd+Right versus Down-arrow to the line start) can paint at the end of line N when WebKit's internal selection sits at the start of line N+1, or the reverse. Test long wrapped lines in WKWebView. Fix direction: when `rect.left` is at the right edge and the offset is a wrap point, compare `coordsAtPos(head, -1)` and `coordsAtPos(head, 1)` and use `view.endOfTextblock`/selection direction. Or check `domSelection.modify`-free heuristics against the last arrow key.
- **Height mismatch.** A 16px caret against 15px text with 24px leading is visibly shorter than macOS native carets (about font ascent plus descent). Derive the height from the font metrics (`range rect height`, clamped to line-height minus 4) rather than a constant.
- **Gap cursor fix:** add `.ProseMirror-gapcursor:after { border-top-color: var(--foreground) }` in globals.css, have DesktopCaret paint a horizontal bar for `GapCursor`, or disable gapcursor (`StarterKit.configure({ gapcursor: false })`). TrailingNode already guarantees a paragraph after blocks.
- **Consistency.** Render `<DesktopCaret>` in `MessageEditInput`, and in any other TipTap surface such as `components/workspace/template-input.tsx`, so the caret looks the same everywhere on desktop.
- **IME.** Range rects follow WebKit's marked text, so the caret should track composition. Not tested.

### Gaps
- No WKWebView run to confirm soft-wrap affinity, caret placement next to `inline-flex` chips, or caret behavior during IME marked text.

## 4. Height, scroll and layout shift (editor scroller, sticky session composer, tools bar, attachments)

### Takeaway
- The editor grows with no animation up to a 200px inner scroller.
- ProseMirror keeps the caret in view with a 5px margin.
- The reply bar, attachment row, typing lines and the TrailingNode empty line all snap the layout.
- In sessions, the composer is now `sticky` **inside** the transcript scroller. Growth first covers the last transcript line, then the scroller's ResizeObserver catches up a frame later.
- The inner scroller has no edge padding or fade, and hovering shows nested scrollbars.

### Cited Findings
- **Editor scroller.** `EditorContent` has `relative max-h-[200px] overflow-y-auto overscroll-contain`, and ProseMirror has `min-h-5`. There is no padding or `scroll-padding`, so text sits flush against the clip edges. — [message-input.tsx:1625-1628, 874](apps/web/src/components/chat/composer/message-input.tsx)
- **ProseMirror scroll-into-view.** `scrollRectIntoView` uses `scrollMargin` 5 / `scrollThreshold` 0 by default and walks up the scroll ancestors, but **stops at the first `fixed|sticky` ancestor**. In the session, the walk therefore never scrolls the transcript viewport. — [NM/prosemirror-view@1.42.8/src/domcoords.ts:36-66](node_modules/.pnpm/prosemirror-view@1.42.8/node_modules/prosemirror-view/src/domcoords.ts)
- **Session layout.** The composer sits in `<div className="sticky bottom-0 z-30 bg-background pt-3">` inside `MessageScrollerContent`. The viewport has `[overflow-anchor:none]`, `autoScroll` and `reconcileFollowOutput`. Jump-to-latest is now `bottom-full mb-2` above the sticky block, so it no longer overlaps the composer. — [session-document.tsx:690-760](apps/web/src/components/session/session-document.tsx)
- **The scroller reacts a frame late.** The `@shadcn/react` message-scroller observes size with a ResizeObserver and then a `requestAnimationFrame` before it reconciles the scroll. — [NM/@shadcn+react@0.2.1…/dist/message-scroller/index.js](node_modules/.pnpm/@shadcn+react@0.2.1_@types+react@19.2.13_react@19.2.4/node_modules/@shadcn/react/dist/message-scroller/index.js) (minified; `new ResizeObserver(()=>{cancelAnimationFrame(H),H=requestAnimationFrame(C)})`)
- **Typing lines.** In the session, other people's typing lines animate in with height `0 → auto` (framer-motion, 220 ms) **inside** the sticky block, above the editor. The block grows every frame of the animation. In the channel view, the typing indicator is a zero-height overlay, which causes no shift. — [session-document.tsx:565](apps/web/src/components/session/session-document.tsx); [components/chat/typing-indicator.tsx:30-70, 72-125](apps/web/src/components/chat/typing-indicator.tsx)
- **Snapping elements.**
  - The reply bar uses `ARRIVE_IN` (`fade-in slide-in-from-bottom-1`): opacity and translate animate, but its height snaps in. — [message-input.tsx:1406-1415](apps/web/src/components/chat/composer/message-input.tsx); [hooks/use-appended-ids.ts:4-5](apps/web/src/hooks/use-appended-ids.ts)
  - The attachment row (about 60px tiles plus `pt-3 pb-2`) mounts and unmounts instantly. The tiles fade and zoom in, but the row height snaps. — [attachment-preview.tsx:30-34, 58-63](apps/web/src/components/chat/composer/attachment-preview.tsx)
- **TrailingNode** is enabled through StarterKit (not disabled in `StarterKit.configure`). It appends an empty paragraph whenever the last node is not a paragraph. Typing `- ` (bullet list input rule), inserting a code block from `/`, or inserting a Linear issue card therefore adds an empty line under it right away, and the composer grows by one more line than the content. — [NM/@tiptap+starter-kit@3.32.2/src/starter-kit.ts:267](node_modules/.pnpm/@tiptap+starter-kit@3.32.2/node_modules/@tiptap/starter-kit/src/starter-kit.ts); [NM/@tiptap+extensions@3.32.2…/src/trailing-node/trailing-node.ts:66-80](node_modules/.pnpm/@tiptap+extensions@3.32.2_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm@3.32.2/node_modules/@tiptap/extensions/src/trailing-node/trailing-node.ts); [message-input.tsx:832-839](apps/web/src/components/chat/composer/message-input.tsx)
- **Inline variant tools bar.** The tools are portaled into a pinned bar under the scroller (`px-4 py-2`) that always reserves its height. Visibility is opacity only: shown immediately when active, faded over 300 ms after a 700 ms delay, and shown on `hover`/`focus-within`. Open menus are detected by a MutationObserver instead of `:has()`, following the WebKit rule. The invisible buttons stay clickable at `opacity-0`, but hover reveals them. — [message-input.tsx:1788-1838](apps/web/src/components/chat/composer/message-input.tsx); [session-document.tsx:769-772](apps/web/src/components/session/session-document.tsx)
- **Scrollbar reveal.** The global scrollbar rule `*:hover { scrollbar-color: … }` reveals the thumb on every hovered scroller, the hovered element's ancestors included. Hovering a full composer in a session therefore shows both the editor's scrollbar and the transcript's scrollbar. — [globals.css:271-279](packages/ui/src/styles/globals.css)
- **Selection-time scroll preservation.** On selection-changing transactions, ProseMirror records and restores the scroll positions of all scroll ancestors, using `elementFromPoint`, but only when `this.dom.style.overflowAnchor == null`. That holds in engines without `overflow-anchor`. — [prosemirror-view/src/index.ts:182](node_modules/.pnpm/prosemirror-view@1.42.8/node_modules/prosemirror-view/src/index.ts); [domcoords.ts:75-107](node_modules/.pnpm/prosemirror-view@1.42.8/node_modules/prosemirror-view/src/domcoords.ts)
- **Safari support for `overflow-anchor`.** Scroll anchoring and `overflow-anchor` first shipped in Safari 27 (macOS 27); WebKit had been the only major engine without them. — [WebKit Features for Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/); [caniuse PR #7593](https://github.com/Fyrd/caniuse/pull/7593)

### Inferences
- **Session growth (one-frame overlap, unverified visually).**
  - When the composer grows by a line at end-of-scroll, frame N: the sticky block's top edge moves up 24px over the last transcript line. Frame N+1: the RO→rAF follow scrolls the transcript up.
  - The same happens on every frame of a typing-line height animation, and on reply-bar or attachment insertion.
  - Fix directions: reconcile in the RO callback synchronously instead of in a rAF; give the composer block a ResizeObserver that adjusts `scrollTop` by the height delta in the same callback; or move the composer back out of the scroll content and size the scroller with `scroll-padding-bottom` set to the composer height.
- **TrailingNode fix.** Add `trailingNode: false` in `StarterKit.configure`. Keep ProseMirror's built-in exits (CodeBlock `exitOnTripleEnter`/`exitOnArrowDown`) or add an explicit "ArrowDown at the last block inserts a paragraph" command. This removes the phantom line under lists and code blocks.
- **Animate the height changes.** Animate the reply bar and attachment row with `grid-template-rows: 0fr → 1fr` (or motion `height:auto`), or reserve space, so the transcript doesn't jump. In a session, convert the typing lines to opacity/transform only with a fixed-height slot, or let them overlay.
- **Inner scroller polish.**
  - Add `scroll-padding-block: 4px` and a 4px block padding (or set `scrollMargin` higher via `editorProps`), plus a mask-image fade at the edges.
  - The 200px cap is exactly 10 lines at 20px (8.3 lines inline at 24px), so the inline variant clips mid-line. Use a multiple of the line height: 192px or 216px.
- **WKWebView on macOS 26 (this machine reports Darwin 25.6, which is macOS 26).** `overflow-anchor` is likely unsupported in the system WebKit, so ProseMirror's manual scroll-stack save and restore (with `elementFromPoint`) runs on every selection-changing transaction. On macOS 27 it would not. This is an inference from the version mapping; it was not run.

### Gaps
- I did not decode the minified message-scroller enough to confirm whether a **viewport** resize (channel composer growth) keeps the list pinned to the bottom, or leaves the newest message partly hidden for a frame.
- I did not confirm which WebKit version the Tauri desktop app ships against on users' machines.

## 5. Focus: autofocus, after send/pick/close, type-to-focus, click targets

### Takeaway
The composer never autofocuses on route, channel or thread change. The focus calls that do exist are routed through TipTap's `focus()`, which waits a frame on Safari. Several gaps:
- no click-to-focus on the box padding, and a 44px dead zone in the "New session" box,
- attaching a connector record probably returns focus to the "+" button instead of the editor,
- type-to-focus always appends at the end and drops dead keys and IME first keys,
- the edit input focuses twice, so a click in the first 200 ms gets yanked to the end.

### Cited Findings
- **No autofocus.** There is no `autofocus` option in the composer's `useEditor` and no mount, route or `draftKey` focus effect. The channel route renders `<MessageInput>` without a `key`, so the editor persists across channels, and only the draft is swapped. — [message-input.tsx:829-924, 989-1009](apps/web/src/components/chat/composer/message-input.tsx); [$channelId.tsx:633-636](apps/web/src/routes/_authenticated/$workspaceSlug/$channelId.tsx)
- **Existing focus calls.**
  - After send: `clearContent(true)` then `focus("end")`. — [message-input.tsx:1135-1136](apps/web/src/components/chat/composer/message-input.tsx)
  - On reply: `focus("end")`. — [message-input.tsx:1203-1207](apps/web/src/components/chat/composer/message-input.tsx)
  - Suggestion commands chain `.focus()`. — [message-input.tsx:435-457, 490-494](apps/web/src/components/chat/composer/message-input.tsx)
  - Mention list items use `onMouseDown preventDefault`, which keeps focus in the editor. — [mention-suggestion-list.tsx:122-125](apps/web/src/components/chat/composer/mention-suggestion-list.tsx)
- **TipTap `focus()` timing on Safari/WKWebView.** It calls `view.dom.focus({preventScroll:true})`, then `view.focus()` and `scrollIntoView` inside `requestAnimationFrame`. — [NM/@tiptap+core@3.32.2…/src/commands/focus.ts:36-80](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/commands/focus.ts)
- **Attach popover return focus.**
  - `finalFocus` returns focus to the editor only when `returnFocusToEditorRef` is true. Opening the menu resets it to `false`. — [message-input.tsx:1643-1651, 1682-1686](apps/web/src/components/chat/composer/message-input.tsx)
  - `handleAttachLinearIssue` sets the ref to `true` ([message-input.tsx:1339](apps/web/src/components/chat/composer/message-input.tsx)). `handleAttachRecord` does not: it calls `editor.chain().focus()…` and then closes the popover ([message-input.tsx:1307-1325](apps/web/src/components/chat/composer/message-input.tsx)). Base UI's default `finalFocus` (the trigger) then runs.
- **Type-to-focus.**
  - It inserts `event.key` with `focus("end").insertContent(key)`.
  - It skips keys whose `key.length !== 1` (for example `"Dead"` and `"Process"`) and events where `event.isComposing`.
  - It stays out of the way when focus is in an input, a contenteditable, a menu or listbox, or when any `[role='dialog']` exists. — [message-input.tsx:1178-1201](apps/web/src/components/chat/composer/message-input.tsx)
- **Click targets.**
  - The contenteditable is the only focus target. It is `min-h-5` (20px) and full width.
  - No `onMouseDown`/`onClick` on the box (`composerRef`), the row, or the editor wrapper calls `focus()`.
  - With `destination === "new"`, the wrapper is `min-h-16` (64px) while the editable stays at 20px. — [message-input.tsx:1444-1486, 874](apps/web/src/components/chat/composer/message-input.tsx); [new-session-view.tsx:345-351](apps/web/src/components/session/new-session-view.tsx)
- **Edit input double focus.** It sets `autofocus: "end"` and also runs `setTimeout(() => editor.commands.focus("end"), 200)`, commented "dropdown close animation steals focus back". — [message-edit-input.tsx:86-98](apps/web/src/components/chat/message-edit-input.tsx)
- **Code block language Select.** The Base UI `Select` in the code block header returns focus to its trigger after a pick. `onValueChange` only calls `updateAttributes`, with no editor refocus. — [code-block-view.tsx:56-71](apps/web/src/components/chat/composer/code-block-view.tsx)

### Inferences
- **No autofocus on desktop (confirmed absence).** After switching channels, sessions or threads, the user must click into the composer, whereas Slack and Discord autofocus. Fix: focus the editor on `draftKey` change and on thread-panel open when no other field has focus, with `focus('end', { scrollIntoView: false })` and only on pointer devices. In sessions, the existing type-to-focus partly covers this.
- **Dead click zones (confirmed).** Clicking the box padding or the empty tools-row gap does nothing. In the "New session" box, the bottom 44px of the visible text area is dead. Fix: an `onMouseDown` on the box that, when the target is not interactive, calls `preventDefault()` and `editor.commands.focus()` (or focus at the end when the click is below the content). Make `.ProseMirror` fill the wrapper (`min-h-full`) for the "new" variant.
- **Focus after attaching a record (likely, unverified).** It depends on Base UI's return-focus timing versus TipTap's rAF `view.focus()`. If Base UI focuses the trigger after the exit animation, the next keystroke goes to the "+" button, and Space reopens the menu. Fix: set `returnFocusToEditorRef.current = true` in `handleAttachRecord` (and in the upload path, after the file dialog).
- **Type-to-focus caveats.** `focus("end")` discards the caret position the user left. Use `focus()` to restore the last selection instead. On macOS, an IME's first keydown or a dead key is dropped or not routed into the editor (unverified per IME).
- **Edit input.** The 200 ms timed refocus can override a deliberate click placed within that window. Prefer focusing on the menu's `onOpenChangeComplete`/`finalFocus`, or once after the dropdown's close transition.

### Gaps
- Not verified: Base UI Popover `finalFocus` timing relative to TipTap's rAF focus.
- Not verified: whether WKWebView keeps contenteditable focus when the Tauri window regains focus. Neither DesktopCaret nor the composer restores focus on window `focus`; the caret only re-shows if focus is still in the editor.

## 6. Typography and WYSIWYG fidelity: editor vs the sent message

### Takeaway
Several styles change visibly when a message is sent:
- line-height differs by 1px (channel) and by 1.5px tighter (session),
- paragraphs gain 6px gaps,
- bold drops from 700 to 550,
- links turn from violet and not underlined to foreground and underlined,
- inline code turns from a violet tint (which reads like a mention) to neutral gray,
- code blocks go from wrapped 0.92em to scrolling 14px with line numbers.

Part of this is caused by Tailwind v4 layering: unlayered rules in globals.css and TipTap's injected CSS silently beat utility classes.

### Cited Findings
- **Composer box:** `text-sm leading-5` (14/20), `[&_p]:m-0 [&_p]:leading-5`, `text-foreground/90`. Lists use `my-0.5 list-disc/decimal pl-5`. Inline code uses `bg-primary/10 border border-border/70 px-0.75 py-0.25 font-mono text-[0.92em]`. — [message-input.tsx:874](apps/web/src/components/chat/composer/message-input.tsx)
- **Composer inline variant (sessions):** `[&_.tiptap]:text-[15px] [&_.tiptap]:leading-6 [&_.tiptap_p]:leading-6` (15/24). — [message-input.tsx:1476-1478](apps/web/src/components/chat/composer/message-input.tsx)
- **Sent message (channel).** The wrapper is `message-markdown … text-sm leading-snug`. The Nexus prose is `text-sm leading-6.5`. The **unlayered** rule `.message-markdown .prose { @apply leading-normal }` wins, giving 14/21. `.message-markdown p { @apply my-1.5 }` (6px), with first/last child margins zeroed. — [components/chat/message-markdown.tsx:406](apps/web/src/components/chat/message-markdown.tsx); [packages/ui/src/components/nexus-ui/message.tsx:24](packages/ui/src/components/nexus-ui/message.tsx); [globals.css:339-354](packages/ui/src/styles/globals.css)
- **Sent message (session document).** `message-item` adds `[&_.message-markdown_.prose]:text-[15px] [&_.message-markdown_.prose]:leading-6`. That is a utility in `@layer utilities`, while globals.css's `.message-markdown .prose` rules sit outside any layer (the file's only `@layer` block is `@layer base`, lines 199-260). Unlayered declarations beat layered ones, so the line-height resolves to `leading-normal` (15 × 1.5 = 22.5px), not 24px. — [components/chat/message-item.tsx:764-767](apps/web/src/components/chat/message-item.tsx); [globals.css:199-260, 309-341](packages/ui/src/styles/globals.css)
- **Bold.** The sent message has `[&_[data-streamdown=strong]]:font-[550] text-foreground`. The composer's `<strong>` has no class, so it uses the preflight `bolder` (700). — [nexus-ui/message.tsx:36](packages/ui/src/components/nexus-ui/message.tsx); [message-input.tsx:831-839](apps/web/src/components/chat/composer/message-input.tsx)
- **Links.** The sent message has `[&_[data-streamdown=link]]:text-foreground underline underline-offset-2`. The composer Link class is `text-primary underline-offset-2 hover:underline`: violet, underlined only on hover. — [nexus-ui/message.tsx:34](packages/ui/src/components/nexus-ui/message.tsx); [message-input.tsx:844-853](apps/web/src/components/chat/composer/message-input.tsx)
- **Inline code.** The sent message uses `bg-accent` (neutral), a border mixed toward the foreground, and `px-1 py-[0.1em]`. The CSS comment says violet "stays reserved for links and mentions" and that a "bordered pill read like an @mention". The composer uses `bg-primary/10` (violet tint) plus `border-border/70`. — [globals.css:412-433](packages/ui/src/styles/globals.css); [message-input.tsx:874](apps/web/src/components/chat/composer/message-input.tsx)
- **Code blocks.**
  - Sent: Nexus figure with `rounded-xl`, `my-4`, `text-[13px]` chrome, a body of `overflow-auto … px-4 py-3.5 text-sm leading-6`, and CSS line-number counters. — [nexus-ui/codeblock.tsx:285-345](packages/ui/src/components/nexus-ui/codeblock.tsx); [globals.css:233-250](packages/ui/src/styles/globals.css)
  - Composer: `NodeViewWrapper mt-1 rounded-md bg-muted/50`, `<pre> px-3 py-2 text-[0.92em] leading-6`. Content is a `<div>` with inline `white-space: pre-wrap`, and TipTap injects `.ProseMirror pre { white-space: pre-wrap }`, so long lines **wrap** in the composer and **scroll** after send. — [code-block-view.tsx:51-75](apps/web/src/components/chat/composer/code-block-view.tsx); [NM/@tiptap+react…/src/NodeViewContent.tsx:11-24](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/NodeViewContent.tsx); [style.ts](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/style.ts)
  - The parent editor's `[&_pre]:px-2 [&_pre]:py-1.5 [&_pre]:bg-muted/50` (specificity 0,1,1) beats the node view's own `px-3 py-2` (0,1,0). The `pre` also picks up a second `bg-muted/50` on top of the wrapper's `bg-muted/50`, a double tint. — [message-input.tsx:874](apps/web/src/components/chat/composer/message-input.tsx); [code-block-view.tsx:51, 73](apps/web/src/components/chat/composer/code-block-view.tsx)
- **TipTap's injected unlayered CSS on `.ProseMirror`:** `white-space: break-spaces` (overrides the `whitespace-pre-wrap` utility), `font-variant-ligatures: none; font-feature-settings: "liga" 0`. The editor therefore renders without ligatures, and trailing or multiple spaces wrap differently from the sent message. — [style.ts](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/style.ts); [message-input.tsx:874](apps/web/src/components/chat/composer/message-input.tsx)
- **Edit input vs composer.** The edit input uses `leading-6` (24px) at `text-sm`, while the composer box uses `leading-5`. The edit input uses the plain StarterKit `codeBlock` (no Shiki, no header), while the composer uses CodeBlockShiki. — [message-edit-input.tsx:49-54, 83](apps/web/src/components/chat/message-edit-input.tsx)
- **Matching parts.** Mentions use the same classes in both places. Lists match: `my-0.5 list-disc/decimal pl-5`. — [message-input.tsx:855-858](apps/web/src/components/chat/composer/message-input.tsx); [message-markdown.tsx:380-382](apps/web/src/components/chat/message-markdown.tsx); [globals.css:446-452](packages/ui/src/styles/globals.css)

### Inferences
- **What the user sees after sending:**
  - In the channel, line spacing opens up slightly (20 → 21px) and real paragraphs gain 6px gaps.
  - In a session, the text tightens (24 → 22.5px), even though `message-item` tries to pin 24px.
  - Bold gets lighter, links change color and gain underlines, and inline code loses its violet tint.
  - Code blocks change shape completely.
  - This is the "jump in look" the owner may be feeling.
- **Fix directions:**
  - Define one shared typography token set, for example `.lor-prose` in globals.css or a `@utility`, and apply it to both `.ProseMirror` and `.message-markdown`: line-height, paragraph gap, strong weight 550, link color and underline, inline-code style.
  - Put that set in the same layer as the message rules (unlayered), or move the `.message-markdown` rules into `@layer components` so the `message-item` utilities take effect.
  - Give `Bold.configure` and `Link.configure` `HTMLAttributes` classes that match Streamdown's.
  - For code blocks, either wrap in both places or scroll in both: set `white-space: pre` and `overflow-x: auto` on the node view's content with an override that beats `.ProseMirror pre`.
  - Override TipTap's ligature reset if the message font uses ligatures (unverified whether Geist has default ligatures that matter).

### Gaps
- Not verified: Geist's default ligature set, so the visual impact of `liga 0` is unknown.
- Not verified: the exact markdown that `@tiptap/markdown` emits for hard breaks (`Shift+Enter` → `setHardBreak`, [NM/@tiptap+extension-hard-break…/src/hard-break.ts:117-118](node_modules/.pnpm/@tiptap+extension-hard-break@3.32.2_@tiptap+core@3.32.2_@tiptap+pm@3.32.2_/node_modules/@tiptap/extension-hard-break/src/hard-break.ts)), and whether Streamdown renders them as `<br>` inside one `<p>` (which avoids the paragraph gap) or as separate paragraphs.

## 7. Bubble menu and suggestion popup positioning

### Takeaway
- **Bubble menu:** follows the selection 250 ms late, anchors to `selection.head` instead of the range, and listens only for **window** scroll. It goes stale when the editor's inner scroller or the transcript scrolls.
- **Suggestion popups:** custom-positioned, always above the caret, clamped to the viewport top with no flip. They work for the bottom composer but overlap the caret when the editor is near the top of the window. The mention list's keyboard selection can scroll out of view.

### Cited Findings
- **Bubble menu setup.** It uses `appendTo={() => document.body}`, `options={{strategy:"fixed", placement:"top", offset:8, flip:true, shift:true}}`, and `getReferencedVirtualElement` returning a 1px rect at `coordsAtPos(selection.head)`. It does not set `updateDelay`, `scrollTarget` or `hide`. — [message-input.tsx:1503-1537](apps/web/src/components/chat/composer/message-input.tsx)
- **Plugin defaults.**
  - `updateDelay = 250`, `resizeDelay = 60`, and `scrollTarget` defaults to `window` (scroll listener on `window`, not in capture).
  - Range-selection updates are debounced by `updateDelay`; collapsing hides immediately.
  - Updates are skipped while `view.composing`. — [NM/@tiptap+extension-bubble-menu@3.32.2…/src/bubble-menu-plugin.ts:376-410, 509-586](node_modules/.pnpm/@tiptap+extension-bubble-menu@3.32.2_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm@3.32.2/node_modules/@tiptap/extension-bubble-menu/src/bubble-menu-plugin.ts)
- **`hide()` and `show()` move the element in and out of the DOM.** They remove the element and append it to `document.body` again. There is no enter/exit transition. — [bubble-menu-plugin.ts:589-623](node_modules/.pnpm/@tiptap+extension-bubble-menu@3.32.2_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm@3.32.2/node_modules/@tiptap/extension-bubble-menu/src/bubble-menu-plugin.ts)
- **Suggestion popups (`@`, `/`, `$`).**
  - A `fixed z-50 w-72` div appended to body.
  - `left` is clamped to the viewport. `top = max(8, clientRect.top - popupHeight - 6)`: always above the caret, never flipped below. When it is clamped, it covers the query line.
  - Before React content mounts, it positions with a fallback height of 240. A ResizeObserver and capture-phase window `scroll`/`resize` reposition it. — [message-input.tsx:252-352, 377-382, 469-473](apps/web/src/components/chat/composer/message-input.tsx)
- **When the popup's content mounts.** `ReactRenderer` wraps `render()` in `flushSync`, but `render()` only registers a portal, and EditorContent notifies its subscribers in a `queueMicrotask`. The popup content therefore mounts a microtask later, before paint. — [NM/@tiptap+react…/src/ReactRenderer.tsx:190-202](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/ReactRenderer.tsx); [EditorContent.tsx:52-63](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/EditorContent.tsx)
- **Suggestion anchor.** `clientRect` is found by `view.dom.querySelector('[data-decoration-id=…]')` followed by `getBoundingClientRect()`. — [NM/@tiptap+suggestion@3.32.2…/src/helpers.ts:50-66](node_modules/.pnpm/@tiptap+suggestion@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm@3.32.2/node_modules/@tiptap/suggestion/src/helpers.ts)
- **Mention list.**
  - `max-h-64 overflow-y-auto` with up to 8 rows, each with an avatar and `py-1.5`.
  - No `scrollIntoView` for the selected row.
  - `selectedIndex` is only clamped when the list length changes. It is not reset to 0 when the query changes. — [mention-suggestion-list.tsx:33-60, 106-125](apps/web/src/components/chat/composer/mention-suggestion-list.tsx); [message-input.tsx:105](apps/web/src/components/chat/composer/message-input.tsx)
- **Desktop zoom.** The main region applies CSS `zoom: percent/100`. The popups and the bubble menu are appended to `document.body`, outside that zoomed subtree. — [components/desktop-zoom.tsx:172-188](apps/web/src/components/desktop-zoom.tsx)

### Inferences
- **Bubble menu lag (confirmed by defaults).** Extending a selection with Shift+Arrow or a mouse drag leaves the bubble at the old position for 250 ms, then it jumps. It can also appear mid-drag after a 250 ms pause. Fix: `updateDelay={0}` (the virtual element is cheap), and show only after `pointerup` (track pointer-down in `shouldShow`).
- **Stale on inner scroll (confirmed).** Scroll events on elements don't reach a bubbling `window` listener. With a selection active, scrolling the 200px editor or the session transcript leaves the menu floating over unrelated content. Fix: pass `options.scrollTarget` as the EditorContent element, or dispatch `setMeta(pluginKey,'updatePosition')` from a capture-phase scroll listener. Add floating-ui `hide` middleware so the menu hides when the selection scrolls out of view.
- **Anchoring to `head`.** On a backward selection the menu sits at the start; on a multi-line selection it sits at whichever line the head is on. Anchoring to the range (`posToDOMRect(view, from, to)`, the plugin's default when no reference is given) centers it like Notion and Linear.
- **Suggestion popup fixes:** add flip-below when there isn't room above (`clientRect.top - height < 8`) and a viewport-aware `max-height`. Scroll the selected item into view (`block: "nearest"`), and reset `selectedIndex` to 0 when `items` change.
- **Zoom mismatch (unverified).** When the desktop zoom is not 100%, body-portaled popups and the bubble menu render at a different scale from the composer.

### Gaps
- Not verified: actual mention row heights (UserAvatar `sm` size), so whether 8 rows overflow 256px is an estimate.
- Not verified: WebKit's `getBoundingClientRect` and `coordsAtPos` behavior under CSS `zoom` for body-portaled popups.

## 8. WebKit/Tauri specifics: IME, autocorrect and spellcheck, caret bugs, mitigations

### Takeaway
- The main composer gets ProseMirror's Safari IME Enter guard because its Enter handling goes through `editorProps.handleKeyDown`.
- `MessageEditInput` uses a raw capture-phase keydown listener, so it misses the guard. Confirming an IME candidate with Enter can save the edit early, and Escape cancels the whole edit instead of closing an open mention popup.
- No `spellcheck`, `autocorrect` or `autocapitalize` attributes are set anywhere.
- Background re-renders call `view.updateState`, which can end an IME composition when stored marks are set.

### Cited Findings
- **ProseMirror's Safari IME guard.** `inOrNearComposition` returns `true` while composing, and on Safari for 500 ms after `compositionend`, because "On Safari, when Enter is pressed, compositionend and keydown events are emitted." The `keydown` handler checks it before calling `handleKeyDown` props. ProseMirror's `browser.safari` is based on vendor, so it also matches WKWebView. — [NM/prosemirror-view@1.42.8/src/input.ts:107-110, 495-512](node_modules/.pnpm/prosemirror-view@1.42.8/node_modules/prosemirror-view/src/input.ts)
- **Main composer:** `editorProps.handleKeyDown` adds an `event.isComposing` check and a check for an open suggestion menu (`document.querySelector(SUGGESTION_MENU_SELECTOR)`). — [message-input.tsx:876-897](apps/web/src/components/chat/composer/message-input.tsx)
- **Edit input:** `domNode.addEventListener("keydown", handleKeyDown, { capture: true })` on `view.dom`.
  - Escape calls `onCancel()` unconditionally.
  - Enter saves unless `event.isComposing` or a suggestion menu is open.
  - Because the listener is capture-phase on the event target, it runs before ProseMirror's own keydown handling (the suggestion plugin's Escape and the IME guard). — [message-edit-input.tsx:118-156](apps/web/src/components/chat/message-edit-input.tsx)
- **Composer Cmd+B** is also a capture-phase listener on `view.dom`. It duplicates TipTap Bold's `Mod-b`, probably to stop the app's ⌘B sidebar shortcut. — [message-input.tsx:1209-1232](apps/web/src/components/chat/composer/message-input.tsx)
- **Composition end on stored marks.** ProseMirror `updateStateInner` calls `clearComposition` when `state.storedMarks && this.composing`. `setOptions` (every `MessageInput` render, section 1) calls `view.updateState(this.state)`. — [prosemirror-view/src/index.ts:153-160](node_modules/.pnpm/prosemirror-view@1.42.8/node_modules/prosemirror-view/src/index.ts); [Editor.ts:287-305](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/Editor.ts)
- **No input attributes set.** The editor `attributes` contain only `class`. A repo-wide grep found no `spellcheck`, `autocorrect`, `autocapitalize` or `enterkeyhint` in apps/web or apps/desktop. — [message-input.tsx:872-875](apps/web/src/components/chat/composer/message-input.tsx); [message-edit-input.tsx:81-84](apps/web/src/components/chat/message-edit-input.tsx)
- **Existing WebKit mitigations:**
  - DesktopCaret, for the stale native caret ([desktop-caret.tsx:30-32](apps/web/src/components/chat/composer/desktop-caret.tsx)).
  - The ToolsSlot MutationObserver instead of `:has()` ([message-input.tsx:1804-1820](apps/web/src/components/chat/composer/message-input.tsx)).
  - `Select` defaulting to `modal=false` ([packages/ui/src/components/select.tsx:15-17](packages/ui/src/components/select.tsx)).
  - Scrollbars use `scrollbar-color` instead of `::-webkit-scrollbar` because WebKit does not repaint the pseudo-element thumb on hover ([globals.css:262-279](packages/ui/src/styles/globals.css)).
  - TipTap's own Safari `preventScroll` focus handling ([focus.ts:44-58](node_modules/.pnpm/@tiptap+core@3.32.2_@tiptap+pm@3.32.2/node_modules/@tiptap/core/src/commands/focus.ts)).
- **WebKit editing churn.** Safari 27 release notes list IME composition fixes (for example, a "Zhuyin – Traditional" input method stalling for seconds). — [WebKit Features for Safari 27.0](https://webkit.org/blog/18325/webkit-features-for-safari-27-0/)

### Inferences
- **Edit input IME bug (high confidence from ProseMirror's own documented Safari behavior).** On Safari or Tauri, Japanese or Chinese users confirming a candidate with Enter in the edit box trigger `handleSave()`. Fix: move Enter and Escape into `editorProps.handleKeyDown` (or a TipTap `addKeyboardShortcuts` extension). Those run after `inOrNearComposition` and after Suggestion's `onKeyDown`, which also fixes Escape closing the edit while a mention popup is open.
- **Background re-renders breaking IME (plausible, unverified).** If a user presses ⌘B with an empty selection (stored marks set) and starts an IME composition, any host re-render (socket message, Lor stream frame, typing update) runs `setOptions` and `view.updateState` with stored marks, which ends the composition. Making `setOptions` stop running (section 1) removes the risk.
- **Explicit attributes.** Set `spellcheck: "true"` (chat) and `autocorrect`/`autocapitalize` deliberately on the editor element. For code blocks, set `spellcheck="false"` and `autocorrect="off"` on the node view's content, so WebKit doesn't underline or "correct" code and smart quotes don't creep in. Whether WKWebView applies macOS automatic text replacement in contenteditable by default was not verified.
- **Suggestion decoration (unverified).** Wrapping the typed `@query` in an inline decoration `span` on the trigger keystroke forces ProseMirror to redraw that text node. Some WebKit versions show caret flicker on such redraws.

### Gaps
- No WKWebView testing of IME, autocorrect or spellcheck defaults, double-tap word selection, or `-webkit-user-modify` (not referenced anywhere in the code).
- Whether Tauri sets any WKWebView preferences for text checking was not inspected.

## 9. Placeholder implementation and edge cases

### Takeaway
The placeholder is a manual absolutely positioned `<span>` (not `@tiptap/extensions` Placeholder). It is driven by React state from the `draftState` selector and hidden when the document doesn't start with a paragraph, which fixes the list-marker overlap. Its alignment matches the editor in both variants. The remaining risks are composition timing and the single-line truncation.

### Cited Findings
- **Implementation.** `showPlaceholder = isEmpty && startsWithParagraph`. The span is `pointer-events-none absolute right-0 top-1 truncate`:
  - box: `left-0 text-sm leading-5 text-muted-foreground`
  - inline: `left-10 text-[15px] leading-6 text-muted-foreground/50`
  - The wrapper has `py-1`, so `top-1` lines up with the first line, and inline `left-10` matches `pl-10`. — [message-input.tsx:926-942, 1471-1501](apps/web/src/components/chat/composer/message-input.tsx)
- **Placeholder text** comes from props or the channel name, plus the `lor_intro` hint state. — [message-input.tsx:757-763](apps/web/src/components/chat/composer/message-input.tsx)
- **Visibility timing.** It is re-evaluated only when the selector runs, that is, on editor `transaction`/`update` events. — [useEditorState.ts:99-117](node_modules/.pnpm/@tiptap+react@3.32.2_@floating-ui+dom@1.8.0_@tiptap+core@3.32.2_@tiptap+pm@3.32.2__@tiptap+pm_47vzns7rcxhngzm4dumkxjnc4u/node_modules/@tiptap/react/src/useEditorState.ts)
- **Channel switch.** The draft swap runs in a `useEffect` (`setContent(stored, { emitUpdate: false })` or `clearContent(false)`) after the render that changed `draftKey` and the placeholder text. — [message-input.tsx:989-1009](apps/web/src/components/chat/composer/message-input.tsx)

### Inferences
- **Same-frame updates.** Typing the first character hides the placeholder in the same frame: the store-driven re-render happens in a microtask before paint.
- **IME (unverified).** If WebKit defers ProseMirror transactions until `compositionend`, the placeholder stays visible on top of the marked (composing) text for the whole composition. Fix: hide the placeholder on `compositionstart` (a DOM listener toggling a data attribute), or render it as a CSS `::before` keyed off `.is-editor-empty`, combined with a composition class.
- **Channel switch flash (plausible, unverified).** The editor persists across channels, and the draft swap happens in a passive effect. If TanStack Router's navigation isn't a discrete-event update, one frame may paint the previous channel's draft with the new channel's placeholder logic. Fix: `useLayoutEffect` for the restore, or key `MessageInput` by `draftKey`, which costs an editor re-creation.
- **Truncation.** Long placeholders (for example "Ask Claude Code for changes, or attach screenshots" in a narrow New-session pane) truncate to one line, while the editor wraps. That is acceptable but differs from the TipTap Placeholder, which wraps.
- **Equivalence with the extension.** With `startsWithParagraph`, an empty list shows no placeholder, which matches what the TipTap Placeholder extension does with `showOnlyCurrent`. A switch to the extension is not required for correctness.

### Gaps
- Not verified: whether ProseMirror in WKWebView dispatches transactions during composition (which decides the IME placeholder overlap).
- Not verified: whether router navigations commit as discrete updates (which decides the draft flash).
