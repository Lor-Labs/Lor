# Harness slash commands and skills (LOR-151)

Each session's harness takes its own slash commands and skills the way its
CLI does, including the skills checked into the session's repository.
Workspace-level skills are deferred.

## Decisions (Jacob, 2026-11-06)

- Follow each CLI and the Agent Skills format (agentskills.io); no
  Lor-specific skill format or workspace skills for now.
- A message is a command only when its first word names a command the
  session's harness has. Anything else ("/etc/hosts is wrong") stays ordinary
  text with its speaker line.
- Commands that reset the harness's conversation (Claude Code `/clear`) are
  left out: Lor saves the conversation per turn for rewind and fork.
- The server decides, so typed commands work on every client; the menus are
  web and desktop first.

## Command turns

Lor normally sends a turn's prompt as a conversation update with speaker
lines and notes, so a leading `/` never reaches the harness. When the
message that starts a turn is a command, `respond()` sends it as typed
instead (`packages/lor/src/index.ts`, `harness-commands.ts`):

- The worker passes the trigger message's text when it starts with `/`
  (a person's message; never a Loop fire, an Act event, a resume, a fork's
  first turn or a continued session's first turn).
- `respond()` lists the repo's skills and command files in the sandbox,
  builds the session's command list and decides whether the text is one.
- A command run saves `context.command` and covers only its own message.
  The next turn's delta walks back through it (`continuedFromRunId`, like a
  `continueOnly` run), so what teammates said around the command still
  reaches the harness.
- Retry notes and lost-sandbox notes are not sent on a command turn (they
  would turn the command into text); the trail still shows them.
- A command that answers with no text (`/compact`) gets a short answer:
  "Ran `/compact`." or why it didn't run.

## Per harness

| | Claude Code | Codex | Pi |
|---|---|---|---|
| Repo skills | Its SDK loads `.claude/skills`, `.claude/commands` and `~/.claude` from the work folder by default | Loads `.agents/skills` from the work folder | Lor lists `.pi/skills` and `.agents/skills` and hands them to Pi in place (patched `skills` option); Pi's own discovery reads the worker's disk and stays off |
| Invoke | `/name args`, sent as typed: built-ins (`/compact`, `/context`, …), bundled skills, repo and personal skills and command files | `$skill-name` anywhere in a message (Codex parses it natively, so no command turn); `/compact`, `/review [instructions]`, `/init` | `/skill:name args`, `/<prompt template> args` (`.pi/prompts`), `/compact [focus]` |
| How | The text is the turn's prompt | `/compact` → `thread/compact/start`, `/review` → `review/start` inline (uncommitted changes, or custom instructions), through the patched bridge; `/init` sends Codex's own init prompt | Lor expands skills and templates in Pi's exact format (Pi's expansion reads the worker's disk); `/compact` calls `session.compact()`, with the person's focus after Lor's |
| "/" menu | Claude Code's own list (`initializationResult().commands`, reported by the bridge patch at turn end) plus the repo's files; built-ins until the first report | `/compact`, `/review`, `/init`; a `$` menu of the repo's skills | `/compact`, `/skill:<name>`, templates |

## Data

- `agent_session.harness_commands` (jsonb, nullable): the session's
  `{ slash, mentions }` lists, written by the worker when they change
  (`apps/worker/src/lib/session-commands.ts`) and sent as `session:updated`.
  On `RealtimeAgentSession` and the API's `AgentSession`.
- `agent_run.context.command`: the command a run sent.

## Adapter patches

- `@ai-sdk/harness-pi`: `skills` takes a list of sandbox skill files, read in
  place so their relative references resolve.
- `@ai-sdk/harness-claude-code`: the bridge reports Claude Code's command
  list on the finish part beside the models.
- `@ai-sdk/harness-codex`: a `command` setting runs `/compact` or `/review`
  as the turn; a review's findings (its `exitedReviewMode` item) show as the
  turn's text.

## Status

- [x] Adapter patches, command turns, per-session lists, composer `/` and `$`
  menus (2026-11-06). Type check and Biome pass.
- [ ] `db:push` for `agent_session.harness_commands` before deploying: every
  full-row session select reads it.
- [ ] Live QA per harness: Claude Code `/compact`, `/context` and a repo
  skill; Codex `/compact`, `/review`, `/init` and a `$` skill; Pi `/compact`,
  `/skill:` and a template, and a model-invoked repo skill.
- [ ] Mobile `/` and `$` menus (typed commands already work there).

## Not covered yet

- Workspace (org-level) skills.
- Codex's system skills and the person's `~/.agents/skills` are not in the
  `$` menu (they still work when typed); Codex's `skills/list` could replace
  the repo scan.
- Pi extension commands (extensions stay off).
