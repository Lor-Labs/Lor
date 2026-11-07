# Best-in-class chat and comment composers: copyable rich-text editing behaviors

Scope: Slack, Linear, Notion, Discord, GitHub (priority), plus ChatGPT, Claude.ai, Microsoft Teams, Liveblocks Comments, Basecamp/Campfire (Trix → Lexxy) and Campsite (open-source TipTap chat composer). Research date: 2026-11-07. Many vendor help pages do not document fine-grained keystroke behavior; where only third-party "tested" blogs exist, that is flagged. Two open-source codebases (Campsite, a TipTap app; Campfire, 37signals' chat app) were read directly because they show exact, shipping key handling.

Source-quality legend used below: **[official]** vendor docs/changelog/code; **[3P-tested]** third-party blog that states a test date; **[3P]** third-party/aggregator; **[forum]** user reports; **[old]** pre-2025 information.

---

## 1. Enter vs Shift+Enter vs Cmd/Ctrl+Enter (including lists, code blocks, quotes, exits, and settings)

### Takeaway
Chat composers (Slack, Discord, Teams, Claude.ai, ChatGPT, Campfire, Campsite) use Enter = send, Shift+Enter = new line. Doc-style comment boxes (Linear, GitHub) use Enter = new line and Cmd/Ctrl+Enter = submit. The best chat composers make Shift+Enter "structure-aware" (new bullet in a list, exit on an empty bullet, new line in code), keep Cmd/Ctrl+Enter as an always-works send, never send on Enter during IME composition, never send on Enter on touch devices, and flip to "Enter = newline" when the composer is in an expanded/long-form mode.

### Cited Findings

**Slack**
- Official shortcut list: New line = Shift+Enter; "Create snippet: ⌘ Shift Enter" (Ctrl+Shift+Enter on Windows/Linux); "Edit last message: ↑ (up arrow from message field)"; "Unsend: ⌘ Z" — [Slack keyboard shortcuts [official]](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)
- Help center: "press Shift Enter" to start a new line, adjustable via preferences — [Slack: Format your messages [official]](https://slack.com/help/articles/202288908-Format-your-messages)
- Preference wording, Preferences > Advanced: "When writing a message, press Enter to…" with options send / start a new line. With "new line" chosen, Cmd+Enter (Mac) / Ctrl+Enter (Win/Linux) sends. Second preference: "When typing code with three backticks, Enter should not send the message" — when on, Enter adds lines inside a ``` code block and Shift+Enter sends instead. Shift+Enter works under all settings; Shift+Enter twice makes a blank line; preference is per person. (Tested 2026-10-02) — [slack.green: new line in Slack [3P-tested]](https://slack.green/en/blog/how-to-add-a-new-line-in-slack)
- Lists: Shift+Enter creates a new list item, Enter alone sends; Backspace on an empty bullet ends the list. (Tested 2026-10-03) — [slack.green: bullet points [3P-tested]](https://slack.green/en/blog/how-to-make-bullet-points-in-slack)
- User complaint about mode confusion: "If you turn on Markdown formatting, shift+enter adds a new line, unless you're in a multi-line code block started with three backticks, and then enter adds a new line and shift+enter sends the message." Replies: one defends it as modal editing like spreadsheets; others want a visible mode indicator ("the status line in Vim lets you know which mode you're in"); one proposes "When you're in a multi code block it should simply never send on (shift+)enter then." — [Hacker News thread, ~2026 [forum]](https://news.ycombinator.com/item?id=47741915)

**Discord**
- Line breaks via Shift+Return; Enter sends — [Markdown Guide: Discord [3P]](https://www.markdownguide.org/tools/discord/)

**Microsoft Teams**
- New line = Shift+Enter. "Expand compose box: Ctrl+Shift+X"; in the expanded box, send = Ctrl+Enter (i.e., Enter becomes a newline in long-form mode) — [Microsoft: Keyboard shortcuts for Teams [official]](https://support.microsoft.com/en-us/accessibility/teams/keyboard-shortcuts-for-microsoft-teams)

**Campfire (37signals ONCE Campfire, open source) — exact shipping logic**
- `submitByKeyboard`: returns early if key isn't Enter or `this.textTarget.hasOpenPrompt` (mention/prompt menu open → Enter selects). `metaEnter = event.metaKey || event.ctrlKey`; `plainEnter = !event.shiftKey && !event.isComposing`; submits only if `!usingTouchDevice && (metaEnter || (plainEnter && !toolbarVisible))`. So: Enter sends only when the formatting toolbar ("extended composer") is collapsed; with the toolbar open, Enter is a newline and Cmd/Ctrl+Enter sends; on touch devices Enter never sends; IME composition never sends. After submit: collapse toolbar, refocus composer — [basecamp/once-campfire composer_controller.js [official code]](https://github.com/basecamp/once-campfire/blob/main/app/javascript/controllers/composer_controller.js)

**Campsite (open-sourced TipTap app) — exact shipping logic**
- `EnterSubmit` extension: `Enter` calls `onSubmit`. `Shift-Enter` runs the same command chain as TipTap's default Enter: `newlineInCode()` → `createParagraphNear()` → `liftEmptyBlock()` → `splitBlock()` (comment: "mirroring TipTap enter key handler"). Shift+Enter therefore inserts a newline in code, splits paragraphs (not `<br>`), and lifts an empty block out of its wrapper — [campsite/campsite packages/editor/src/extensions/EnterSubmit.ts [official code]](https://github.com/campsite/campsite/blob/main/packages/editor/src/extensions/EnterSubmit.ts)
- TipTap core's default chains, for reference: handleEnter = `newlineInCode` → `createParagraphNear` → `liftEmptyBlock` → `splitBlock` — [tiptap core keymap.ts [official code]](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/extensions/keymap.ts)

**Linear (comments and editor)**
- "click the Comment button or ⌘/Ctrl + Enter to post the comment" — [Linear docs: Comment on issues [official]](https://linear.app/docs/comment-on-issues)
- Editor: "Line break: Shift Enter"; "Exit formatting blocks: Enter Enter"; "Cmd/Ctrl + Enter to check or uncheck a checklist item" — [Linear docs: Editor [official]](https://linear.app/docs/editor)

**Notion**
- "Enter = new line [new block]; shift + Enter = line break within block" — [Notion keyboard shortcuts [official]](https://www.notion.com/help/keyboard-shortcuts)

**GitHub**
- "Submit comment: Cmd+Enter (Mac) / Ctrl+Enter" — [GitHub Docs: Keyboard shortcuts [official]](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)
- List syntax "will now be autocompleted after you press return or enter"; at the end of a list "you can use shift + enter to skip the autocomplete" (2020-12-15) — [GitHub changelog [official, old but current]](https://github.blog/changelog/2020-12-15-markdown-list-syntax-now-autocompleted/)

**Claude.ai / Claude Desktop**
- Enter sends; accidental sends when writing paragraphs are a stated pain; author found no plan for a Slack-style preference and ships a userscript targeting the `.ProseMirror` element (2026-01-05) — [harshilkamdar blog [3P]](https://harshilkamdar.github.io/2026/01/05/enter-key.html)
- "In the Desktop app, Enter always submits the message; the only way to get a newline is Shift+Enter." Feature request for Enter=newline, Ctrl/Cmd+Enter=submit (opened 2026-08-26) — [anthropics/claude-code#89673 [forum]](https://github.com/anthropics/claude-code/issues/89673)

**IME (CJK) guard**
- Repeated bug class: Enter that confirms an IME conversion sends the message; fix is to skip submit when `event.isComposing === true` (or `keyCode === 229`). Reported against Claude Code, Cursor, many others; reporters call it "non-standard behavior compared to … Slack, Discord, and Teams" — [anthropics/claude-code#8455 [forum]](https://github.com/anthropics/claude-code/issues/8455); [Cursor forum [forum]](https://forum.cursor.com/t/critical-i18n-ime-enter-key-triggers-unintended-submission-in-chat-and-askquestion-completely-breaks-cjk-input-for-1-5-billion-users/154276)

### Inferences
- The cleanest TipTap mapping of the Slack/Campsite model: bind `Enter` → send (unless a suggestion popup is open or `view.composing`/`event.isComposing`), bind `Shift-Enter` → TipTap's Enter chain (plus `splitListItem` for lists), bind `Mod-Enter` → always send. This yields "Shift+Enter = new bullet; Shift+Enter or Backspace on empty bullet = exit list; Shift+Enter in code = newline" for free.
- Caveat for TipTap: CodeBlock's `exitOnTripleEnter` lives in CodeBlock's own `Enter` shortcut, so it will not fire for Shift+Enter unless the Shift+Enter handler also calls the exit logic (or the code block keeps arrow-down exit, see §4).
- Two models exist for code blocks in an Enter-sends composer: (a) Slack default — Enter still sends even inside a code block, Shift+Enter adds code lines; (b) Slack opt-in — Enter adds code lines inside a block, Shift+Enter sends. HN signal says (b)'s "Shift+Enter sends" inversion is confusing; a safer variant is "inside a code block Enter = newline, and only Cmd/Ctrl+Enter sends" (never invert Shift).
- An "expanded composer" mode (Teams Ctrl+Shift+X, Campfire toolbar open) that flips Enter to newline is a well-precedented answer to "I'm writing something long" without a global setting.
- Touch devices: Return = newline, send button sends (Campfire code; Slack mobile per slack.green).

### Gaps
- No official Slack page states the exact "Shift+Enter on empty bullet exits the list" behavior; only Backspace-on-empty-bullet is reported (3P). Behavior of Shift+Enter inside a Slack blockquote is undocumented.
- Discord's behavior inside lists/code blocks in the composer (whether Shift+Enter continues a list) is undocumented.
- Notion comment submission key (Enter vs Cmd+Enter) is not documented in Notion's help.
- A search summary claimed Linear changed comments to Enter-sends; no primary source supports it, and Linear's own docs say Cmd/Ctrl+Enter posts. Treat as unverified.

---

## 2. Inline markdown shortcuts while typing: live vs raw, undo of auto-conversion, escaping

### Takeaway
Every WYSIWYG leader (Notion, Linear, Slack default, Lexxy/Basecamp, ChatGPT since 2026) converts markdown live as soon as the closing delimiter or trailing space is typed. Discord is the outlier: it keeps the syntax characters visible but styled ("markdown preview"). Slack's "Format messages with markup" setting keeps everything raw until send. Recovery from an unwanted conversion is Cmd+Z (Slack documents "Undo formatting: ⌘ Z") or Backspace immediately after the conversion (ProseMirror `undoInputRule`, bound to Backspace by TipTap by default).

### Cited Findings

**Notion** — inline: `**text**` bold, `*text*` italic, `` `text` `` inline code, `~text~` strike. Line-start blocks: `* `/`- `/`+ ` bullets; `1. `, `a. `, `i. ` numbered; `[] ` to-do; `# `/`## `/`### ` headings; `> ` toggle list; `" ` quote; `---` divider — [Notion keyboard shortcuts [official]](https://www.notion.com/help/keyboard-shortcuts)
- Note Notion's divergence: `> ` makes a **toggle**, `" ` makes a **quote** — same source.

**Linear** — "Type in Markdown or paste it directly and it will be converted into rich text automatically": `**text**` bold, `_text_` italics, `~~text~~` strike, `# ` H1; lists via `*`, `-`, `+`, `1.`, `[]` — [Linear docs: Editor [official]](https://linear.app/docs/editor)

**Slack (default WYSIWYG composer)**
- Lists: "add a 1 and a period and press the spacebar"; bullets: "add an asterisk and press the spacebar" — [Slack: Format your messages [official]](https://slack.com/help/articles/202288908-Format-your-messages)
- Typed: `*text*` and `**text**` both become bold; `_text_` italic; `~text~` strike but `~~text~~` stays literal; backticks make code/code blocks; `>`, `-`, `1.`, `#` make quotes, lists, headings; "`[text](url)` stays literal until you press Cmd+Shift+F" (tested 2026-10-27) — [slack.green: markdown not working [3P-tested]](https://slack.green/en/blog/slack-markdown-not-working)
- Official shortcuts: "Apply markdown: ⌘ Shift F"; "Undo formatting: ⌘ Z" — [Slack keyboard shortcuts [official]](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)
- Cmd+Shift+F converts pasted markdown; "Running the shortcut a second time picks up cases the first pass misses"; headings `#` remained unconverted in that test (2026-05-20) — [fredin.co [3P]](https://www.fredin.co/blog/slack-markdown-shortcut/)
- Markup mode (Preferences > Advanced > Input Options > "Format messages with markup"): "Formatting will be applied to messages after you send them"; "Messages that you copy and paste will appear in plain text"; "Automatic formatting for bulleted, numbered, and indented lists won't be applied." Syntax: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, `>quote`, ```` ```block``` ````, `[text](link)` — [Slack: Format with markup [official]](https://slack.com/help/articles/360039953113-Format-your-messages-in-Slack-with-markup)
- History [old, 2019]: Slack shipped the WYSIWYG composer on 2019-11-20 with no way back to markup; backlash led Slack to add the markup option ("We thought we had nailed it, but we have seen an outpouring of feedback from customers who love using Slack with markup") — [VICE [3P, old]](https://www.vice.com/en/article/slacks-new-rich-text-editor-shows-why-markdown-still-scares-people/); [HN 21589647 [forum, old]](https://news.ycombinator.com/item?id=21589647)
- Specific 2019 bugs that defined "janky" [old]: "closing backticks are not respected! … you must hit right-arrow after the closing backtick"; typing at the start of a code span put text outside the span; underscores inside code triggered italics; behavior differed between Safari and Chrome — [quuxplusone blog [3P, old]](https://quuxplusone.github.io/blog/2019/11/20/slack-rich-text-box/)

**Discord** — supports `**bold**`, `*italic*`/`_italic_`, `__underline__`, `~~strike~~`, `||spoiler||`, `-# subtext`, `#`/`##`/`###` headings, `>` and `>>>` quotes (multi-line to message end), lists, fenced code with highlighting, masked links; no tables, task lists, horizontal rules — [Markdown Guide: Discord [3P]](https://www.markdownguide.org/tools/discord/)
- Composer renders a "markdown preview": syntax characters stay visible but styled differently — [tiptap discussion #3004 (2022) [forum]](https://github.com/ueberdosis/tiptap/discussions/3004). Discord: "You can disable the markdown preview in your text box by going to your User Settings > Appearance tab!" (Dec 2019) — [Discord on X [official, old]](https://x.com/discord/status/1204953612889317376)
- Escaping: backslash — [GitHub Docs basic formatting [official]](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax) (GitHub); Discord backslash escaping is widely known but I did not retrieve a primary source (403 on Discord support).

**ChatGPT** — composer moved "from plain text/Markdown-style editing to real-time rich text formatting"; `**text**`, `# title`, list markers auto-format while typing and on paste — [ChatGPT-ComposerFormatGuard README [3P]](https://github.com/MehverSynRGB/ChatGPT-ComposerFormatGuard). Users ask for a plain-text composer: pasted content "may become a structured code block, bold text, list … instead of remaining literal text" (2026-08-16); a userscript bypasses "ProseMirror's conversion"; OpenAI Support (2026-09-08): "We'll share the request for an optional plain-text composer and predictable paste behavior with the product team. We don't have a timeline" — [OpenAI community [forum]](https://community.openai.com/t/add-a-plain-text-composer-option-for-chatgpt-and-codex/1390698)

**Basecamp / Lexxy (Lexical)** — Lexxy 1.0 (2026-09-28): converts typed markdown to rich text as you write; WYSIWYG-first by design — [37signals Dev: Lexxy 1.0 [official]](https://dev.37signals.com/lexxy-1-0/). Campfire replaced Trix with Lexxy specifically "to add markdown support as that's an often-requested feature" (PR opened 2026-07-20) — [once-campfire PR #224 [official]](https://github.com/basecamp/once-campfire/pull/224)

**Undo mechanics (ProseMirror/TipTap)**
- ProseMirror: "`undoInputRule` … will undo an input rule, if applying such a rule was the last thing that the user did"; rules record `{transform, from, to, text}` and undo restores the original typed text; `undoable: false` opts a rule out; input rules do not fire inside code nodes by default (`inCode`) and can be blocked in code marks (`inCodeMark`) — [prosemirror-inputrules source [official code]](https://github.com/ProseMirror/prosemirror-inputrules/blob/master/src/inputrules.ts)
- TipTap core Backspace chain starts with `commands.undoInputRule()` before `deleteSelection`/`joinBackward` — [tiptap core keymap.ts [official code]](https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/extensions/keymap.ts)

### Inferences
- Backspace-right-after-conversion restoring raw characters is already TipTap's default; it breaks if a custom Backspace binding (e.g., a list keymap or mention handler) runs before core's handler and returns true. Campsite overrides list Backspace, a place to check.
- For an AI-chat product, the ChatGPT backlash shows that live conversion must be predictable and escapable: provide (1) Backspace/Cmd+Z to revert a conversion, (2) Cmd+Shift+V for literal paste, (3) never convert inside inline code or code blocks.
- Delimiter semantics disagree: Slack typed `*x*` = bold, standard markdown `*x*` = italic. A composer that receives LLM-generated markdown should use standard CommonMark meaning (`*x*`/`_x_` italic, `**x**` bold, `~~x~~` strike), which matches Linear, Discord, GitHub, Notion's `**`.

### Gaps
- Whether Notion and Linear revert a conversion on Backspace (vs only Cmd+Z) is not documented; the task brief asserts it but no source was found.
- Slack's exact conversion trigger (on closing delimiter vs on following space) is not documented officially.
- No source found on Slack's escaping inside the WYSIWYG composer.

---

## 3. Lists: auto-numbering, continuation, Tab/Shift+Tab, Backspace at start, nesting, renumbering

### Takeaway
Live list creation by `- `, `* `, `1. ` + space is universal. In chat composers the "next item" key is Shift+Enter (Slack), and an empty item + Backspace (Slack) or Enter-Enter (Linear "exit formatting blocks") ends the list. Tab/Shift+Tab indent/outdent in Slack (max 5 levels, distinct bullet glyphs per level) and Notion. GitHub's plain-textarea box continues markdown list syntax on Enter but Tab moves focus.

### Cited Findings
- Slack triggers: `* `, `- `, `• `, `1. `; selecting lines + Cmd+Shift+8 bullets each line. Shift+Enter new item; Enter sends; Tab indents; Shift+Tab outdents; Backspace on empty bullet ends the list; "The message box maxes out at five indent levels"; levels show different glyphs (filled dot, hollow circle, square); in markup mode list auto-formatting is off — [slack.green: bullets (tested 2026-10-03) [3P-tested]](https://slack.green/en/blog/how-to-make-bullet-points-in-slack); markup mode also confirmed by [Slack official](https://slack.com/help/articles/360039953113-Format-your-messages-in-Slack-with-markup)
- Slack shortcuts: "Bulleted list: ⌘ Shift 8"; "Numbered list: ⌘ Shift 7" — [Slack keyboard shortcuts [official]](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)
- Linear: bullets `*`, `-`, `+`; numbered `1.`; checklist `[]`; Cmd/Ctrl+Shift+8 bulleted, Cmd/Ctrl+Shift+9 numbered, Cmd/Ctrl+Shift+7 checklist; "Exit formatting blocks: Enter Enter"; Cmd/Ctrl+Enter toggles a checklist item — [Linear docs: Editor [official]](https://linear.app/docs/editor)
- Notion: `1. `, `a. `, `i. ` start numbered lists (letters/roman too); Tab = indent/nest, Shift+Tab = un-indent; Cmd/Ctrl+Option/Shift+0–9 convert block type — [Notion keyboard shortcuts [official]](https://www.notion.com/help/keyboard-shortcuts)
- GitHub: Cmd+Shift+7 ordered, Cmd+Shift+8 unordered — [GitHub keyboard shortcuts [official]](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts); list syntax autocompleted on Enter, Shift+Enter skips — [GitHub changelog 2020 [official]](https://github.blog/changelog/2020-12-15-markdown-list-syntax-now-autocompleted/); in comment boxes Tab moves focus to the next element; users request Tab indentation — [GitHub community discussion #127067 [forum]](https://github.com/orgs/community/discussions/127067)
- TipTap ListKeymap: "pressing backspace at the start of a list item keeps the list item content on the same line. With the List Keymap, the content is lifted into the list item above" — [TipTap ListKeymap docs [official]](https://tiptap.dev/docs/editor/extensions/functionality/listkeymap)
- Campsite extends ListKeymap with custom `Backspace` and `Mod-Backspace` list handling — [Campsite ListKeyMap.ts [official code]](https://github.com/campsite/campsite/blob/main/packages/editor/src/extensions/ListKeyMap.ts)

### Inferences
- Copyable spec for a chat composer: `- `/`* `/`1. ` + space → list; Shift+Enter → next item (number auto-increments via the ordered-list node); Shift+Enter or Backspace on an empty item → exit to paragraph (TipTap `liftEmptyBlock`/`liftListItem`); Tab/Shift+Tab → `sinkListItem`/`liftListItem` only while inside a list (otherwise Tab should keep its focus-navigation role for accessibility); cap nesting (Slack: 5).
- Ordered list renumbering is structural in ProseMirror (numbers come from position), so deleting/reordering renumbers automatically; this matches WYSIWYG leaders.

### Gaps
- Whether Slack continues numbering after an interrupted list (e.g., `3.` start) is undocumented; whether `3. ` starts a list at 3 in Slack/Linear/Notion was not found.
- Discord composer list continuation behavior not documented.

---

## 4. Code blocks: language selection, Tab, exiting, paste-into-code, highlighting

### Takeaway
``` + space/Enter creates a block everywhere; Linear and Lexxy add language and live syntax highlighting. Exits: Enter-Enter (Linear), triple-Enter and arrow-down-at-end (TipTap defaults). Pasting into a code block must insert plain text (Campsite). The single most-cited Slack pain is whether Enter sends from inside a code block.

### Cited Findings
- Slack: "Code: ⌘ Shift C"; "Codeblock: ⌘ Alt Shift C" — [Slack keyboard shortcuts [official]](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts); setting "When typing code with three backticks, Enter should not send the message" — [slack.green [3P-tested]](https://slack.green/en/blog/how-to-add-a-new-line-in-slack)
- Linear: "Code block: Cmd/Ctrl Shift \\"; "Inline code: Cmd/Ctrl E"; `/code` slash command; "Exit formatting blocks: Enter Enter" — [Linear docs: Editor [official]](https://linear.app/docs/editor)
- Teams: "Inline code: Ctrl+Shift+C"; "Code block: Ctrl+Shift+B" — [Microsoft Teams shortcuts [official]](https://support.microsoft.com/en-us/accessibility/teams/keyboard-shortcuts-for-microsoft-teams)
- Lexxy: syntax highlighting in "more than twenty languages", highlighting live as you type — [Lexxy 1.0 [official]](https://dev.37signals.com/lexxy-1-0/)
- TipTap CodeBlock defaults: `exitOnTripleEnter: true`, `exitOnArrowDown: true` ("if there is no node after it"), `exitOnArrowUp: true`, `enableTabIndentation: false`, `tabSize: 4`; input rules ``` and ~~~ (``` ```css ``` sets language); shortcut Mod-Alt-C — [TipTap CodeBlock docs [official]](https://tiptap.dev/docs/editor/extensions/nodes/code-block)
- Campsite paste: if the selection is in code, `insertText(text)` plain; if the clipboard carries VS Code's `vscode-editor-data` with a non-markdown language and the text is multi-line, it creates a code block with that language (and appends a trailing paragraph if the block lands at the doc end); single-line VS Code copy becomes inline code — [Campsite PasteHandler.ts [official code]](https://github.com/campsite/campsite/blob/main/packages/editor/src/extensions/PasteHandler.ts)
- Discord: fenced code blocks with syntax highlighting (``` ```lang ```) — [Markdown Guide: Discord [3P]](https://www.markdownguide.org/tools/discord/)
- 2019 Slack code-span bugs (closing backtick not respected, caret stuck outside code span, italics inside code) — [quuxplusone [3P, old]](https://quuxplusone.github.io/blog/2019/11/20/slack-rich-text-box/)

### Inferences
- Copyable: ``` + space (or ```lang) → code block; inside a block, typing never triggers markdown rules (ProseMirror default `inCode: false`); paste is plain text; VS Code paste → fenced block with detected language; exit by arrow-down at end (always leave a trailing empty paragraph so the caret can escape), by triple Shift+Enter, or by Cmd/Ctrl+Enter sending.
- Tab inside code: TipTap leaves it off by default; turning it on only inside code blocks is consistent with Notion/IDE expectations, but it traps keyboard users unless Escape/Shift+Tab escapes.
- Inline code edge: the "caret at the boundary of a code mark" problem from 2019 Slack is the classic jank; TipTap's Code mark is `inclusive: false`-style by default plus right-arrow escape; verify typing after a closing backtick lands outside the mark.

### Gaps
- Linear's code block language picker UI (dropdown vs typed) not documented in retrieved pages.
- Whether Slack's composer highlights syntax in code blocks: not found (it does not appear in docs).

---

## 5. Paste: markdown, HTML cleanup, URL over selection, paste-in-code, plain-text paste, large paste

### Takeaway
Best-in-class: (1) URL pasted over selected text → link (GitHub, Notion, Lexxy, TipTap default, Campsite); (2) markdown text → formatted (Linear, Lexxy, Campsite, and Slack since Oct 2026); (3) code context → plain text; (4) Shift held / Cmd+Shift+V → plain; (5) very large pastes → attachment card with a way back (ChatGPT "Show in text field"; Discord text file; Claude "pasted text").

### Cited Findings

**URL over selection → link**
- GitHub: "When you have text selected, you can paste a URL from your clipboard to automatically create a link from the selection." Also "GitHub automatically creates links when valid URLs are written" — [GitHub Docs basic formatting [official]](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
- Notion: "Copy the URL … Select the text … Paste with cmd/ctrl + v" (2019) — [Notion on X [official, old]](https://x.com/NotionHQ/status/1162130287960055809)
- Lexxy: transforms "URLs pasted over selected text into hyperlinks" — [Lexxy 1.0 [official]](https://dev.37signals.com/lexxy-1-0/)
- TipTap Link `linkOnPaste` (default true): "Adds a link to the current selection if the pasted content only contains an url"; `autolink` (default true) "adds links as you type" — [TipTap Link docs [official]](https://tiptap.dev/docs/editor/extensions/marks/link)

**Markdown paste**
- Linear: "paste it directly and it will be converted into rich text automatically"; "Pasting an issue ID will also link it"; pasting a Figma link embeds a preview, "press Esc to keep as link" — [Linear docs: Editor [official]](https://linear.app/docs/editor)
- Slack: as of the 2026-10-27 test "pasted standard markdown now formats in Slack on paste, tables included" (bold, links, headings, lists, code fences, pipe tables → table blocks); the same paste "stayed literal with a toast" on 2026-09-28; pasted `*text*` → italic (standard markdown), unlike typed; "Cmd+Z right after the paste removed the whole paste … not only the formatting"; in markup mode pasted markdown shows literally and formats on send — [slack.green: markdown not working [3P-tested]](https://slack.green/en/blog/slack-markdown-not-working). **Conflict:** the same site's 2026-10-03 list test says "Markdown lists pasted from external sources arrive as plain text" — [slack.green bullets](https://slack.green/en/blog/how-to-make-bullet-points-in-slack) — consistent with a rollout between Sept 28 and Oct 27, 2026. HN users had complained "pasted markdown doesn't format automatically" — [HN [forum]](https://news.ycombinator.com/item?id=47741915)
- ChatGPT: rich-text conversion on paste triggers complaints for code, JSON, paths and diffs; users fall back to Ctrl+Shift+V — [OpenAI community: plain-text composer [forum]](https://community.openai.com/t/add-a-plain-text-composer-option-for-chatgpt-and-codex/1390698); [OpenAI community: paste-to-attachment [forum]](https://community.openai.com/t/chatgpt-converts-pasted-text-to-file-attachment/1369430)

**Campsite's TipTap paste pipeline (exact order)** — [PasteHandler.ts [official code]](https://github.com/campsite/campsite/blob/main/packages/editor/src/extensions/PasteHandler.ts)
1. If Shift is held during paste → return false (browser/ProseMirror default "paste without formatting" path).
2. Read `text/plain` or `text/uri-list` (iOS share-sheet URLs).
3. In code → insert plain text.
4. Single URL: supported service → inline attachment; clipboard also has files → ignore URL (image copied from web); non-empty selection → `toggleMark(link)`; empty root paragraph → link unfurl node; internal app URL → resource mention; else insert URL text with link mark.
5. VS Code clipboard with language → code block / inline code.
6. HTML containing `data-pm-slice` (copied from a ProseMirror editor) → default handling (preserve structure).
7. `isMarkdown(text)` (and not Dropbox Paper HTML) → parse markdown via markdown parser and insert; single-paragraph results are inlined rather than splitting the block.
8. `transformPastedHTML` cleans Dropbox Paper's double paragraphs.

**Paste as plain text**
- GitHub: "Paste as plain text: Cmd+Shift+V" — [GitHub keyboard shortcuts [official]](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)
- Slack markup mode: "Messages that you copy and paste will appear in plain text" — [Slack official](https://slack.com/help/articles/360039953113-Format-your-messages-in-Slack-with-markup)

**Large paste → attachment**
- ChatGPT: from 2026-03-25 Plus/Pro/Business pastes > 5,000 characters become an attachment; from 2026-06-22 Free/Go at > 10,000; Enterprise/Edu from 2026-08-04; "Show in text field" moves it back into the message — [devicebase summary of OpenAI release notes [3P]](https://devicebase.net/en/openai-chatgpt/updates/large-pastes-are-now-handled-as-attachments/908); [reconn-ai [3P]](https://reconn-ai.com/chatgpt-march-25-2026-large-pastes-are-now-handled-as-attachments) (primary [OpenAI release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) returned 403). Earlier, in Dec 2025–Jan 2026, users reported an A/B-tested conversion with no way back and demanded a toggle — [OpenAI community [forum]](https://community.openai.com/t/chatgpt-converts-pasted-text-to-file-attachment/1369430)
- Claude.ai: "Past a certain length, a paste stops behaving like typing. Claude converts the block into an attachment … names it pasted text.txt"; shows as a "file chip" above the box; later pastes increment (`pasted text(2).txt`) — [leadsource (2026-08/09) [3P]](https://leadsource.co/blog/claude-pasted-text-empty). Users build extensions to stop it — [unclecode/claude-paster [3P]](https://github.com/unclecode/claude-paster)
- Discord: 2,000-character cap (4,000 with Nitro); longer pastes can be sent as a plain text file; filename editable and a comment can be added (from Discord support via search snippet; page 403 on fetch) — [Discord: Sending Messages [official, via snippet]](https://support.discord.com/hc/en-us/articles/360034632292-Sending-Messages)
- Slack: manual "Create snippet: ⌘ Shift Enter" — [Slack keyboard shortcuts [official]](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts); Slack truncates message text past 40,000 characters and advises < 4,000 — [slack.green: character limit [3P]](https://slack.green/en/blog/slack-message-character-limit)

### Inferences
- The ChatGPT history is a cautionary tale: a forced large-paste attachment with no undo produced months of forum anger; the later "Show in text field" escape hatch is the copyable part. Any auto-attachment threshold should show a removable card that can be expanded back to inline text.
- Paste priority order worth copying (Campsite's): plain-text override → code context → URL logic → editor-native slices → markdown detection → HTML cleaned by schema.
- Pasting HTML from Google Docs/web: ProseMirror's schema-based parse drops unsupported marks automatically; only marks/nodes in the chat schema survive. This is the de facto "clean to supported marks" behavior.

### Gaps
- Claude.ai's exact paste threshold is unverified; one aggregator claims ~20,000 characters ([fast.io [3P, low confidence]](https://fast.io/resources/claude-character-limit/)). No official Anthropic doc found.
- Whether Slack auto-offers a snippet for long pastes: no reliable source; only the manual shortcut is documented.
- Google Docs → Slack/Linear/Notion HTML cleanup specifics (e.g., what happens to headings in chat) were not documented.

---

## 6. Formatting UI: toolbar vs toggle vs bubble menu, shortcuts, link dialog

### Takeaway
Slack shows a formatting toolbar in the composer (hideable via markup mode; the "Aa" toggle). Linear and Liveblocks show a floating toolbar on selection. Teams and Campfire hide formatting behind an "expand" toggle that also changes Enter semantics. Shortcut sets disagree on strike, inline code, link, list and quote keys.

### Cited Findings
- Slack toolbar: "highlight the desired text and select an option from the toolbar"; options Bold, Italics, Underline, Strikethrough, Code, Block quote, Code block, Ordered list, Bulleted list; markup preference hides it — [Slack: Format your messages [official]](https://slack.com/help/articles/202288908-Format-your-messages)
- Slack shortcuts (Mac): Bold ⌘B; Italic ⌘I; Underline ⌘U; Strike ⌘⇧X; Code ⌘⇧C; Code block ⌘⌥⇧C; Quote ⌘⇧9; Bullets ⌘⇧8; Numbered ⌘⇧7; Hyperlink ⌘⇧U; Apply markdown ⌘⇧F; Undo formatting ⌘Z — [Slack keyboard shortcuts [official]](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)
- Linear: Bold ⌘B; Italic ⌘I (or ⌘>); Strike ⌘⇧S; Underline ⌘U; Inline code ⌘E; Link ⌘K; Code block ⌘⇧\\; Bullets ⌘⇧8; Numbered ⌘⇧9; Checklist ⌘⇧7; Undo ⌘Z / Redo ⌘⇧Z — [Linear docs: Editor [official]](https://linear.app/docs/editor); toolbar "pops up after you highlight a word or phrase" (search summary of Linear docs) — [Linear docs: Editor](https://linear.app/docs/editor)
- Notion: ⌘B, ⌘I, ⌘U, ⌘⇧S strike, ⌘E inline code, ⌘K link — [Notion keyboard shortcuts [official]](https://www.notion.com/help/keyboard-shortcuts)
- GitHub: ⌘B, ⌘I, ⌘E code, ⌘K link, ⌘⇧7 ordered, ⌘⇧8 unordered, ⌘⇧. quote, ⌘G suggestion, ⌘⇧P Write/Preview toggle, ⌘⇧V plain paste, `R` quotes selected text into a reply — [GitHub keyboard shortcuts [official]](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)
- Teams: Ctrl+B/I/U; Strike Ctrl+Alt+X; Inline code Ctrl+Shift+C; Code block Ctrl+Shift+B; H1–H3 Ctrl+Alt+1–3; Quote Ctrl+Alt+4; Link Ctrl+K; Expand compose box Ctrl+Shift+X — [Microsoft Teams shortcuts [official]](https://support.microsoft.com/en-us/accessibility/teams/keyboard-shortcuts-for-microsoft-teams)
- Liveblocks Comments: four marks only ("Bold, italic, strikethrough and code"); "a contextual formatting toolbar is now shown when selecting text" (2.13+, `showFormattingControls={false}` to disable); primitives `FloatingToolbar`, `MarkToggle` — [Liveblocks Nov 2024 [official]](https://liveblocks.io/blog/whats-new-in-liveblocks-november-edition-2024)
- Campsite chat schema: Bold, Italic, Strike, inline Code, Link, Typography, Mention, Reaction, Placeholder, BlurOnEscape — no lists, quotes or code blocks in chat (comment: "chat doesn't support underline") — [Campsite chat.ts [official code]](https://github.com/campsite/campsite/blob/main/packages/editor/src/chat.ts)
- Campfire: toolbar toggle (`toggleToolbar`), toolbar collapses after send — [once-campfire composer_controller.js [official code]](https://github.com/basecamp/once-campfire/blob/main/app/javascript/controllers/composer_controller.js)
- TipTap Link: "This extension doesn't bind a specific keyboard shortcut. You would probably open your custom UI on Mod-k" — [TipTap Link docs [official]](https://tiptap.dev/docs/editor/extensions/marks/link)

### Inferences
- Majority shortcut set to copy: ⌘B/⌘I/⌘U, ⌘E inline code (Linear/Notion/GitHub), ⌘K link (Linear/Notion/GitHub/Teams), ⌘⇧7 numbered and ⌘⇧8 bullets (Slack/GitHub), ⌘⇧X strike (Slack; Linear/Notion use ⌘⇧S). Slack's ⌘⇧U link exists because ⌘K is Slack's quick switcher; if Lor's ⌘K is a global switcher, pick one and accept the conflict deliberately.
- Bubble menu on selection (Linear, Liveblocks) plus an optional pinned toolbar toggle (Slack Aa, Campfire, Teams) covers both mouse and keyboard users.

### Gaps
- Slack's link-edit popover behavior (click a link in the composer → edit/remove) is undocumented in retrieved pages.
- Linear/Notion link popover details (Cmd+K with selection vs without) not documented.

---

## 7. Mentions, emoji, slash commands

### Takeaway
`@` opens a live-filtered people (and often entity) menu; `:` + 2 characters opens emoji autocomplete; `/` opens commands. Enter (and commonly Tab) accepts, Escape closes, and while the menu is open Enter must never send (Campfire checks `hasOpenPrompt`).

### Cited Findings
- Linear: "Write @text to mention users, issues, or dates"; `:emoji_name:` (e.g. `:100:`, `:+1:`); `/` menu: `/code`, `/diagram`, `/collapsible section`, `/file`, `/insert`, `/date`, `/table` — [Linear docs: Editor [official]](https://linear.app/docs/editor). `@Linear` in a comment invokes Linear's agent — [Linear docs: Comment on issues [official]](https://linear.app/docs/comment-on-issues)
- Notion: `@` person/page/date, `@remind`; `:emoji_name` inline emoji; extensive slash commands — [Notion keyboard shortcuts [official]](https://www.notion.com/help/keyboard-shortcuts); in comments, type `@` and press Enter to confirm a selection; results update in real time — [Notion comments help [official]](https://www.notion.com/help/comments-mentions-and-reminders)
- GitHub: `@` people/teams; `#` suggests issues and PRs; `:EMOJICODE:` or start typing `:` for suggestions — [GitHub Docs basic formatting [official]](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
- Lexxy "Prompts": "Type a character, get a menu" for mentions, emoji, or custom items — [Lexxy 1.0 [official]](https://dev.37signals.com/lexxy-1-0/)
- Liveblocks: `createMention()` "focuses the editor, adds `@`, and opens the mention suggestions dropdown"; keyboard nav in `Composer.SuggestionsList` — [Liveblocks react-ui docs [official]](https://liveblocks.io/docs/api-reference/liveblocks-react-ui)
- Slack-style emoji convention as re-implemented by others: `:` plus 2 characters opens emoji autocomplete with arrow/Enter/Tab/Esc like the mention menu; `:thinking:` converts on the closing colon; a colon right after a word character never triggers (so `12:30:45`, `re: x`, URLs are safe) — [joswayski/caper PR #311 [3P implementation]](https://github.com/joswayski/caper/pull/311)
- Campfire: Enter ignored for sending while `hasOpenPrompt` — [once-campfire composer_controller.js [official code]](https://github.com/basecamp/once-campfire/blob/main/app/javascript/controllers/composer_controller.js)
- Campsite: resource mentions created by pasting internal URLs — [Campsite PasteHandler.ts [official code]](https://github.com/campsite/campsite/blob/main/packages/editor/src/extensions/PasteHandler.ts)

### Inferences
- Trigger rule to copy: open only at word start (after whitespace/line start) for `@`, `:`, `/` (slash only at the very start of the message for commands, if commands exist), require 2 characters for `:`; Enter/Tab accept; Escape closes the menu without blurring (second Escape blurs).
- Mention chips should be atomic nodes: one Backspace selects/deletes the whole chip (ProseMirror `selectNodeBackward` is already in TipTap's Backspace chain).

### Gaps
- Slack's exact behavior when backspacing into a mention chip (delete whole vs revert to text) — no source found.
- Fuzzy-matching algorithms for any product are undocumented.

---

## 8. Editing sent messages

### Takeaway
Up-arrow in an empty composer edits your last message (Slack, Discord); editing happens inline in the message with Enter to save and Escape to cancel (Discord documented; Slack documents a Save button). Edits should reuse the composer's editor and keymap.

### Cited Findings
- Slack: "Edit last message: ↑ (up arrow from message field)" — [Slack keyboard shortcuts [official]](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts); desktop: three-dots menu → Edit message → "Save Changes"; Android double-tap to edit; "Unsend" within 15 seconds via Cmd/Ctrl+Z — [Slack: Edit or delete messages [official]](https://slack.com/help/articles/202395258-Edit-or-delete-messages)
- Discord: "E or Up Arrow: Edit Last Message" (keyboard navigation); "ESC: Move your cursor to the chat input. If there's a menu or modal open, it will close that first" — [Discord blog: keyboard navigation [official]](https://discord.com/blog/how-to-navigate-discord-using-only-your-keyboard); Escape cancels an edit, Enter (or Save) saves — [Discord support: How do I edit my messages? [official, via snippet]](https://support.discord.com/hc/en-us/articles/207618817-How-do-I-edit-my-messages); Shift+Up (Win) / ⌥+Up (Mac) also cited for edit last message [3P snippet, unverified]
- Linear: edit via `...` → edit; no keyboard shortcut documented — [Linear docs: Comment on issues [official]](https://linear.app/docs/comment-on-issues)
- Campfire: `replaceMessageContent` sets content, focuses and "placeCursorAtTheEnd" — [once-campfire composer_controller.js [official code]](https://github.com/basecamp/once-campfire/blob/main/app/javascript/controllers/composer_controller.js)

### Inferences
- Up-arrow should only trigger edit when the composer is empty (or caret at very start of an empty doc), otherwise it must move the caret. Caret at end on entering edit mode.

### Gaps
- Slack Escape-to-cancel in inline edit is not documented in the retrieved help page.

---

## 9. Drafts

### Takeaway
Per-conversation drafts that survive channel switches and reloads, restored with the caret at the end, are standard (Campfire code shows the minimal version). Slack additionally syncs drafts across devices and lists them, but I could not retrieve the current official page.

### Cited Findings
- Campfire: on connect `#restoreDraft()` loads `localStorage["composer-draft-<roomId>"]`, sets the value and calls `placeCursorAtTheEnd()`; `saveDraft()` removes the key when blank, else stores the value — [once-campfire composer_controller.js [official code]](https://github.com/basecamp/once-campfire/blob/main/app/javascript/controllers/composer_controller.js)

### Inferences
- Copy: key drafts by channel/thread/session, store rich JSON (not HTML) so marks/mentions survive, delete on empty, restore caret at end (restoring exact caret position is a nice-to-have no product documents), show a draft indicator in the sidebar.

### Gaps
- Slack's drafts help URL tried returned 404; Slack's draft sync/indicator behavior is not cited here.
- Discord, Linear draft behavior not documented in retrieved sources.

---

## 10. Feel details: auto-grow, focus, type-anywhere, Escape, IME, accessibility, performance

### Takeaway
Focus lands in the composer on every conversation switch (Slack, Campfire), typing anywhere routes keystrokes into it (Slack on Mac), Escape closes menus first and then blurs (Discord, Campsite, Linear), touch devices skip autofocus (Campfire), and Enter respects IME composition. Keystroke latency matters: 37signals cites 4 ms vs 38 ms per keystroke (Lexxy vs Trix).

### Cited Findings
- Slack: "To write a message in a channel or DM on Mac, start typing. Slack will automatically move focus to the message field"; Windows/Linux F6; "Upon navigating to a conversation, your focus will land in the message composer" — [Slack: screen reader help [official]](https://slack.com/help/articles/360000411963-Use-Slack-with-a-screen-reader)
- Slack engineering (2021): the composer uses a `forceFocus` pattern because "the next most likely action is that the user will type"; focus returns to a reliable place after modals close — [Slack Engineering: Managing focus transitions [official, old]](https://slack.engineering/managing-focus-transitions-in-slack/)
- Campfire: autofocus on connect only if not a touch device; refocus after send — [once-campfire composer_controller.js [official code]](https://github.com/basecamp/once-campfire/blob/main/app/javascript/controllers/composer_controller.js)
- Campsite `BlurOnEscape`: Escape → preventDefault, stopPropagation, `editor.commands.blur()` — [Campsite BlurOnEscape.ts [official code]](https://github.com/campsite/campsite/blob/main/packages/editor/src/extensions/BlurOnEscape.ts)
- Linear fixed "an issue where pressing Escape twice would not blur the editor after pasting a link" (Dec 2023), implying Escape #1 dismisses the embed/link prompt, Escape #2 blurs — [Linear changelog 2023-12-06 [official, old]](https://linear.app/changelog/2023-12-06-editor-improvements)
- Discord ESC moves the cursor to the chat input, closing menus/modals first — [Discord blog [official]](https://discord.com/blog/how-to-navigate-discord-using-only-your-keyboard)
- Lexxy: "Everything is reachable with the keyboard"; screen-reader support; ~4 ms vs Trix's 38 ms per keystroke in a 10,000-word doc — [Lexxy 1.0 [official]](https://dev.37signals.com/lexxy-1-0/)
- Teams expands the compose box with Ctrl+Shift+X (long-form mode) — [Microsoft Teams shortcuts [official]](https://support.microsoft.com/en-us/accessibility/teams/keyboard-shortcuts-for-microsoft-teams)
- IME guard (see §1) — [claude-code#8455 [forum]](https://github.com/anthropics/claude-code/issues/8455)

### Inferences
- Type-to-focus implementation: a window keydown listener that, when no input is focused and the key is printable (no Cmd/Ctrl/Alt), focuses the composer and lets the character land. Skip for shortcuts and when a dialog is open.
- Escape ladder to copy: close suggestion popup → close link/bubble popover → cancel edit (if editing) → blur composer.

### Gaps
- No product documents composer max height; values (e.g., Slack growing to about half the viewport then scrolling) could not be sourced.
- Discord "type anywhere to focus" is widely observed but no primary source was retrieved (Discord support pages returned 403); a userscript for auto-focus exists ([greasyfork [3P]](https://greasyfork.org/en/scripts/443850-discord-auto-focus-text-box/code)), which does not settle the question.
- Spellcheck/autocorrect settings per product not documented.

---

## 11. Synthesis: best-in-class conventions, and where products disagree

### Takeaway
There is a clear consensus core (live markdown in WYSIWYG, Shift+Enter structure-aware newline in chat, Cmd/Ctrl+Enter universal submit, URL-over-selection → link, plain paste in code, up-arrow edit, per-channel drafts, focus-on-switch, IME-safe Enter). Disagreements are concentrated in delimiter meaning (`*x*`), shortcut keys for strike/code/link/lists, code-block Enter semantics, and how aggressively to auto-convert pastes (a live issue for AI composers).

### Cited Findings
- Consensus: Enter-sends/Shift+Enter-newline in chat — Slack ([official](https://slack.com/help/articles/201374536-Slack-keyboard-shortcuts)), Teams ([official](https://support.microsoft.com/en-us/accessibility/teams/keyboard-shortcuts-for-microsoft-teams)), Discord ([3P](https://www.markdownguide.org/tools/discord/)), Claude Desktop ([forum](https://github.com/anthropics/claude-code/issues/89673)), Campfire and Campsite (code above).
- Consensus: Cmd/Ctrl+Enter submits in doc-style comment boxes — Linear ([official](https://linear.app/docs/comment-on-issues)), GitHub ([official](https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts)); and in long-form chat modes — Slack "Enter = new line" pref ([3P-tested](https://slack.green/en/blog/how-to-add-a-new-line-in-slack)), Teams expanded box, Campfire toolbar mode.
- Consensus: URL over selection → link — GitHub, Notion, Lexxy, TipTap default (sources in §5).
- Consensus trend: markdown paste converts — Linear, Lexxy, Slack (Oct 2026), Campsite (sources in §5); counter-signal: ChatGPT users demanding a plain-text composer ([forum](https://community.openai.com/t/add-a-plain-text-composer-option-for-chatgpt-and-codex/1390698)) and Slack's 2019 backlash ([VICE](https://www.vice.com/en/article/slacks-new-rich-text-editor-shows-why-markdown-still-scares-people/)).
- Disagreement — strike: Slack `~x~` (and `~~x~~` stays literal) vs Linear/Discord `~~x~~` vs Notion `~x~` ([slack.green](https://slack.green/en/blog/slack-markdown-not-working), [Linear](https://linear.app/docs/editor), [Notion](https://www.notion.com/help/keyboard-shortcuts), [Discord](https://www.markdownguide.org/tools/discord/)).
- Disagreement — `*x*`: Slack typed = bold; Notion/Discord/standard = italic; Slack pasted `*x*` = italic ([slack.green](https://slack.green/en/blog/slack-markdown-not-working)).
- Disagreement — `>`: quote in Slack/Discord/GitHub; toggle list in Notion (Notion quote = `"`) ([Notion](https://www.notion.com/help/keyboard-shortcuts)).
- Disagreement — keys: link ⌘K (Linear/Notion/GitHub/Teams) vs ⌘⇧U (Slack); inline code ⌘E (Linear/Notion/GitHub) vs ⌘⇧C (Slack/Teams); strike ⌘⇧X (Slack) vs ⌘⇧S (Linear/Notion) vs Ctrl+Alt+X (Teams); numbered list ⌘⇧7 (Slack/GitHub) vs ⌘⇧9 (Linear); quote ⌘⇧9 (Slack) vs ⌘⇧. (GitHub) vs Ctrl+Alt+4 (Teams); code block ⌘⌥⇧C (Slack) vs ⌘⇧\\ (Linear) vs Ctrl+Shift+B (Teams) vs Mod-Alt-C (TipTap default) — sources in §6.
- Disagreement — code block Enter: Slack offers both, via a setting; users find the inversion confusing ([HN](https://news.ycombinator.com/item?id=47741915)).
- Disagreement — rendering model: hide syntax (Notion/Linear/Slack/ChatGPT/Lexxy) vs show-styled syntax (Discord preview) vs raw until send (Slack markup mode) — sources in §2.
- Disagreement — scope of formatting in chat: Campsite chat and Liveblocks allow inline marks only (no lists/blocks) ([Campsite](https://github.com/campsite/campsite/blob/main/packages/editor/src/chat.ts), [Liveblocks](https://liveblocks.io/blog/whats-new-in-liveblocks-november-edition-2024)); Slack, Discord, Teams support lists, quotes and code blocks.

### Inferences
Copyable spec for a TipTap chat composer, Enter-sends model (each line traces to a product above):
1. **Enter** → send, unless: suggestion popup open (accept instead), `isComposing`, touch device, or "expanded" mode active. Consider making Enter insert a newline inside a code block (Slack opt-in behavior) but then send only with Cmd/Ctrl+Enter there, never Shift+Enter.
2. **Shift+Enter** → TipTap Enter chain (`newlineInCode` → `splitListItem` → `createParagraphNear` → `liftEmptyBlock` → `splitBlock`). In a list: new item; on empty item: exit list. In a quote: new paragraph in quote; on empty: exit quote.
3. **Cmd/Ctrl+Enter** → always send.
4. **Backspace** directly after an auto-conversion → restore raw characters (TipTap `undoInputRule`; make sure custom handlers don't preempt it). Backspace on empty list item / empty quote line → lift out. **Cmd+Z** undoes a conversion as a separate step.
5. Live input rules: `**x**`/`__x__` bold, `*x*`/`_x_` italic, `~~x~~` strike (optionally also `~x~` for Slack muscle memory), `` `x` `` code, `- `/`* `/`1. ` lists, `> ` quote, ``` code block (```lang sets language); none fire inside code.
6. Paste order: Shift/Cmd+Shift+V → plain; in code → plain; URL with selection → link; lone URL → link (optionally unfurl); VS Code → code block with language; editor-native slice → keep; markdown → parse; HTML → schema-cleaned; very long text → attachment card with "show inline" escape hatch.
7. Shortcuts: ⌘B/I/U, ⌘⇧X strike, ⌘E inline code, ⌘K link (or ⌘⇧U if ⌘K is global), ⌘⇧7/⌘⇧8 lists, ⌘⇧9 quote, ⌘⌥C code block, ⌘⇧F "apply markdown" to convert literal markdown already in the box.
8. Suggestion menus: `@`/`:`(2 chars)/`/` at word start; arrows + Enter/Tab accept; Escape closes; chips are atomic.
9. Up-arrow in an empty composer → edit last own message inline; Enter saves, Escape cancels.
10. Drafts per conversation as editor JSON; caret at end on restore.
11. Focus composer on conversation switch (desktop only), type-anywhere-to-focus, Escape ladder (popup → popover → edit → blur).
12. Selection bubble menu for marks plus an optional pinned toolbar toggle.

### Gaps
- No primary source covers how any product handles the caret at mark boundaries (stored marks, "typing after bold continues bold?"), a core cause of perceived jank; would need hands-on testing.
- Composer max height, scroll-into-view rules and animation for auto-grow are undocumented everywhere.
- Height (product shut down) had no retrievable composer docs; Trix's original behaviors were not researched since 37signals replaced it with Lexxy.
