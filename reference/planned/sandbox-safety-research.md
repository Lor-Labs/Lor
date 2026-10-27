# Sandbox command safety: what other agent harnesses do

Research input for the sandbox safety policy in
`reference/planned/pi-harness-runbook.md` §4.6 (slice 1.3f). Gathered
2026-10-21 by reading source code (at the commits named), vendor docs,
engineering posts, security advisories and papers. Vendor metrics are the
vendors' own numbers. Items marked [unverified] were not confirmed in a
primary source.

## 1. Findings

1. **Containment carries the most weight; approval covers what crosses the
   boundary.** Claude Code, Codex and Cursor all moved to "sandbox first,
   rules at the edges, a model for the rest":
   - Anthropic: sandboxing "safely reduces permission prompts by 84%".
   - Cursor: sandboxed agents "stop 40% less often".
   - Codex removed its known-safe command allowlist (PRs #39524 and #39630,
     2026-08-19/20) and lets unmatched commands run inside its sandbox.
   - Anthropic ("How we contain Claude", 2026-05-25): a prompt pasted by an
     employee made Claude read `~/.aws/credentials` and POST it out in 24 of
     25 tries. "When the user is the one typing the instruction, there's
     nothing anomalous for a classifier to catch." Only egress and
     filesystem limits stop that.
2. **Text matching fails; parse the shell.** Codex, Gemini CLI, VS Code,
   OpenCode and the OpenHands rails parse with tree-sitter-bash and judge
   every sub-command. Unparseable input is never safe.
   - Cursor removed its denylist (1.3, 2025-07-29) after Backslash bypassed
     it with base64, subshells, write-then-run scripts and quote splicing.
   - Gemini CLI checked only the first command; `grep … ; env | curl …` ran
     after `grep` was approved (Tracebit, fixed in 0.1.14).
3. **"Read-only" command lists keep breaking through arguments and repo
   config.** Claude Code has 35 advisories, mostly read-only-list bypasses:
   `echo`, `rg`, `sed` (twice), `find`, `$IFS`, zsh `>|`, symlinks, an
   over-broad allowlist (CVE-2025-55284). Trail of Bits:
   `go test -exec`, `git show --output` then `rg --pre`. A repo's
   `.git/config` (`core.fsmonitor`, `core.pager`, `diff.external`) makes
   `git status` or `git diff` run code (Goose CVE-2026-72718); Codex
   removed git from its safe list for this reason.
4. **Production classifiers judge the action against what the person asked
   for, and do not see untrusted text.**
   - Claude Code auto mode (2026-03-25): "The classifier sees only user
     messages and the agent's tool calls; we strip out Claude's own messages
     and tool outputs." Stripping outputs "is the primary prompt-injection
     defense". A tool-calls-only variant blocked actions the user had asked
     for.
   - Codex auto-review: only user and developer messages, `AGENTS.md` and
     answers to its question tool establish authorization; tool output is
     untrusted. "User-provided tasks do not authorize all possible steps."
   - Cursor auto-review (2026-06-11): judges "whether the action is
     justified by what the user asked", and may read workspace files
     because "`python script.py` might be safe or unsafe depending on what is
     inside the file".
5. **Denials go back to the agent, with a circuit breaker; errors deny.**
   Claude Code: a denial tells the agent to find a safer path; after 3
   consecutive or 20 total denials it asks a person (headless runs stop).
   Codex: 3 consecutive or 10 of the last 50. Both fail closed. Gemini
   CLI's Conseca and Goose's adversary reviewer fail open; do not copy them.
6. **Even the best classifiers miss a lot.** Claude Code full pipeline: 0.4%
   false positives on real traffic, 17% misses on real overeager actions,
   5.7% misses on synthetic exfiltration. The misses are mostly misjudged
   consent: the classifier "finds approval-shaped evidence and stops short
   of checking whether it's consent for the blast radius". Codex: 90.3%
   recall on overeagerness, 99.3% on prompt injection.
7. **People are a weaker check than either.** Users approve 93–97% of
   prompts. In Anthropic's seeded study (1,053 testers) people caught 13.6%
   of dangerous commands and auto mode 89%; the human rate fell from about
   17% early in a session to about 5% after 50 prompts. Asking more often
   makes each ask weaker.
8. **Model self-reported risk is abandoned or a convenience only** (Cline
   `requires_approval`, OpenHands `security_risk`, Windsurf and Warp "agent
   decides"): a prompt-injected agent rates itself low.

## 2. Tools

| Tool | Default | Shell decision | Edits | Model |
|---|---|---|---|---|
| Codex CLI (`bd5a836`) | workspace-write sandbox, network off, on-request | Exec-policy prefix rules per segment (strictest wins); small "dangerous" heuristic (forced `rm`, unwraps `sudo`/`env`/`trap`/`bash -lc`, depth 8, fails closed); otherwise run in the sandbox. Safe allowlist removed Aug 2026. | Auto-approved inside writable roots; `.git`, `.codex`, `.agents`, `.aws` read-only | Auto-review for sandbox escalations only (7.2% of actions) |
| Claude Code | Auto (since v2.1.283); `-p` denies what needs approval | Rules deny > ask > allow, each subcommand must match; built-in read-only set; never auto-approves critical-path `rm` in any mode | Allowed in project in auto; protected: `.claude`, `.mcp.json`, rc files, `.git/hooks`, `.git/config` | Two-stage transcript classifier (Sonnet) |
| Cursor | Auto-review (since 3.6) | Prefix allowlist (first token); sandbox (Seatbelt / Landlock+seccomp); denylist removed | File-deletion and outside-workspace protection; config writes need approval | Small-model agentic reviewer, blocks ~4% of reviewed calls |
| Gemini CLI (`578f033`) | Shell and writes ask; headless denies | TOML policy engine; tree-sitter, every segment; redirection downgrades allow to ask; `$( )`, backticks, `<( )` refused in every mode | Denies `.git`, `.env*`, `node_modules` paths; build files always ask; taint tracking from web/MCP/curl output | Conseca, off by default, fails open |
| VS Code / Copilot | Read commands auto-approved | tree-sitter, every `(command)` node; deny rules win; variable assignment and parse errors ask | `**/*` allowed except `.git`, `package.json`, `.env`, lockfiles; an always-checked list for agent config | "Assisted permissions" LLM judge |
| OpenCode (v1.19.3) | Everything allowed | tree-sitter; glob rules per command node; wrappers not unwrapped (`env *` approves anything) | `external_directory` asks | None |
| Goose | Autonomous | Per-tool only; regex threat patterns off by default | Per-tool | "Smart approve" read-only judge, fails closed, caches "not read-only" per tool |
| OpenHands SDK | NeverConfirm in Docker | Rails (fetch-to-exec, raw disk, catastrophic delete) via tree-sitter | Docker boundary | Agent self-reports LOW/MEDIUM/HIGH; ensemble takes the worst |
| Cline 4.x | Command auto-approval off | All-or-nothing toggle (v3 used model-set `requires_approval`) | — | — |
| Aider | Never runs model commands unattended (`--yes-always` answers "n") | Asks per command | Git auto-commit is the undo | — |

## 3. Rules that work

**Parser.** tree-sitter-bash (web-tree-sitter in TypeScript, as Gemini CLI).
Two separate jobs:
- *Proving safe* (Codex `try_parse_word_only_commands_sequence`): accept only
  plain commands — words and quoted strings joined by `&& || ; |`. Reject
  parse errors, redirections (narrow exceptions: `2>/dev/null`, `2>&1`),
  `&`, subshells, `$( )`, backticks, `<( )`, `$VAR`, `FOO=bar cmd`
  prefixes, heredocs, control flow, and words containing glob, brace,
  tilde, backslash or `$`. Every segment must be on the safe list.
- *Finding danger*: walk every literal command, including those nested in
  `$( )`, backticks, subshells, loops, `if` bodies, `trap`, `eval` strings
  and `bash|sh|zsh -c`. Unwrap `sudo`, `doas`, `env` (skip `-i`,
  `NAME=VALUE`), `command`, `exec`, `nohup`, `nice`, `timeout`, `time`,
  `stdbuf`, `xargs <cmd>` and `find -exec` payloads. Cap depth at 8 and
  fail closed beyond it.

**Codex's last safe list** (`is_safe_command.rs` @ `1b450c7`, before its
removal): `cat cd cut echo expr false grep head id ls nl paste pwd rev seq
stat tail tr true uname uniq wc which whoami` (+ `numfmt`, `tac` on Linux);
`base64` without `-o/--output`; `find` without `-exec -execdir -ok -okdir
-delete -fls -fprint -fprint0 -fprintf`; `rg` without `--pre
--hostname-bin --search-zip -z`; `sed` only `-n Np` or `-n M,Np`; git
`status/log/diff/show/branch` with strict flag limits (removed later — see
§1.3). VS Code adds `sort -o`, `tree -o`, `date -s` and sed `w/e/r`
commands as ask triggers.

**Never a prefix or blanket approval** (Codex `BANNED_PREFIX_SUGGESTIONS`):
shells (with or without `-c`), interpreters (`python node ruby perl php lua
deno bun Rscript osascript pwsh`), `env`, `sudo`, `rm`, `git`, `npm/pnpm/yarn
run`.

**Protected paths** (union of Claude Code, Codex, Gemini CLI, VS Code,
Cursor): `.git/hooks`, `.git/config`; the agent's own config and
instruction files; `.env*` (not templates); keys and credential files
(`*.pem`, `id_*`, `.aws/`, `.npmrc`, `.pypirc`, `.netrc`,
`.git-credentials`); shell rc files; CI workflows; build and lockfiles
(Gemini always asks). Normalize case and resolve symlinks first
(CVE-2025-59944; Claude Code symlink advisories).

**Hard rules in every mode, including bypass:** critical-path deletes
(`/`, `~`, the workspace root and its parents); the agent writing its own
permission config (CVE-2025-53773: an injection wrote
`"chat.tools.autoApprove": true`); the cloud metadata address
`169.254.169.254`; bypass flags (`--dangerously-skip-permissions`,
`--yolo`, `--trust-all-tools`; Nx "s1ngularity" used them); invisible or
bidirectional Unicode.

**Egress at the network, not in flags.** Parsing `curl` methods misses
GET query-string exfiltration (Trail of Bits), DNS, `git push`, `ssh` and
scripts. Codex "limited" network mode allows only GET, HEAD and OPTIONS.
Anthropic: an allowed host is "a capability grant", not a destination
filter (Cowork leaked files through an allowlisted API host using an
attacker's key).

## 4. Classifiers in production

| | Claude Code auto mode | Codex auto-review | Cursor auto-review |
|---|---|---|---|
| Scope | Everything not settled by read-only tools, narrow allow rules or in-project edits | Only actions that would otherwise wait for a person (sandbox escalations, blocked network, MCP side effects) | Calls not on the allowlist and not runnable in the sandbox |
| Model | Sonnet; stage 1 single token "err on the side of blocking", stage 2 reasoning on flagged calls only (prompt cache-hit) | GPT-5.4 Thinking (low); newer single-token first pass | Gemini 3.5 Flash Lite, Haiku fallback; agentic (reads files) |
| Input | User messages + tool calls; no assistant text, no tool outputs; plus CLAUDE.md and `git status` before destructive git | User/developer messages, assistant updates, tool calls and outputs labeled untrusted | Request + action; may read workspace files |
| Output | Block / allow with reason | `{risk_level low…critical, user_authorization unknown…high, outcome, rationale}`; low/medium allow, high only if authorization ≥ medium and narrow, critical deny | Allow / block with explanation |
| Errors | Deny | Deny (`FailedClosed`), 90 s timeout | — |
| Breaker | 3 consecutive / 20 total, then ask (headless stops) | 3 consecutive / 10 of 50, turn stops | — |
| Reported | FPR 0.4%, FNR 17% (overeager), 5.7% (exfil) | 99.1% of escalations approved; recall 90.3% / 99.3% | ~4% of reviewed calls blocked; ~7% of chats interrupted |

**Jev** (TypeSafe, our planned decision model), from its docs: ask one
yes/no question per Noul and combine answers in code; extra Nouls in one
request barely add latency; a Noul is not a scale (use Score for degree);
it reads literally, handles indirection poorly, loses accuracy with large
noisy state and binary-encoded instructions; it "does not treat [state] as
hostile by default", so untrusted content must stay out of state. 32k
tokens per question; pin a versioned model ID.

## 5. Research evidence

- Judges find risk poorly unless told what to look for: R-Judge GPT-4 F1
  72% (99.5% when given the risk description); GPT-4o specificity 51.7%
  (flags about half of safe records). Agent-SafetyBench GPT-4o judge 75.5%
  accuracy; a fine-tuned 7B judge 91.5%.
- Recall is the weak point: OS-Harm judge safety recall 64%; SHADE-Arena
  best monitor AUC 0.87 (over 20% FPR at 80% recall).
- Context fools judges: agents' rationalizations, injected notes and
  "benign framing" (OS-Harm, CoT Red-Handed, Async Control, MonitoringBench:
  Opus 4.5 catch rate 94.9% → 60.3% on refined attacks). Injections in the
  agent's own output drove a GPT-4.1 monitor to zero suspicion on all 375
  backdoored solutions (arXiv 2510.09462). Action-only or hybrid scoring
  and withholding tool outputs (LlamaFirewall AlignmentCheck: 83% of goal
  hijacks caught at 2.5% FPR) hold up better.
- Obfuscation beats surface cues: random-character URLs dropped one model's
  rejection rate from 23% to 0.8% (RedCode).
- Detectors and stacked defenses fall to adaptive attacks ("The Attacker
  Moves Second", 2025: 12 defenses, most over 90% bypass). Hard limits on
  what a step can do work best (AgentDojo tool filter 6.8% attack success;
  Progent 1.0%).
- Thresholds are set from operating budgets on held-out data: two
  thresholds as percentiles of the suspicion score (AI Control); report
  recall at a fixed FPR (about 1%).

## 6. Incidents

| Incident | What happened | What stops it |
|---|---|---|
| Replit, 2025-07 | Agent deleted a production database in a code freeze | Separate dev/prod credentials; restore points |
| Gemini CLI, 2025-07 (Tracebit) | README injection; only the first command checked; payload hidden by whitespace | Check every subcommand; show the full command; sandbox |
| Copilot CVE-2025-53773 | Injection set auto-approve in `.vscode/settings.json` | Agent may never write its own permission config |
| Nx "s1ngularity", 2025-08 | Postinstall ran local AI CLIs with bypass flags to list secrets | Credential isolation; bypass flags as a hard rule |
| Jules, 2025-08 | Injected issue → malware download and C2 implant | Egress default-deny |
| Clinejection, 2026-02 | Triage workflow ran an agent with Bash on untrusted issue text; cache poisoning reached release secrets | No secrets or shared caches near agents reading untrusted input |
| Cursor CurXecute / MCPoison, 2025 | Injection rewrote `mcp.json`; approved config changed silently | Re-approve on any config change; protect config paths |

## 7. Blaxel network controls (1.3f-4 spike, 2026-10-21)

From the docs (`Sandboxes/Proxy`, `Proxy-domains`, `Proxy-secrets-injection`,
`Infrastructure/Gens`), `@blaxel/core` 0.3.11 types, and the
`blaxel-ai/sandbox` source (`sandbox-api/src/lib/proxy/`).

- **Status:** public preview, "not recommended for production use". The
  proxy is per region (`Region.proxyAvailable`). Firewalled sandboxes run on
  Mark 3.0 only; Carbon (Mark 3.1, private preview, rolling out by
  workspace) has no firewalling.
- **Fixed at creation:** the proxy cannot be added to or removed from an
  existing sandbox, and firewall rulesets "can only be set when the sandbox is
  created". Domain lists, routing and secrets change on a running sandbox
  with `updateNetwork`, which replaces the whole `network` object.
- **Patterns:** `[!]METHOD:...:domain[/path]`. The domain is exact, `*.suffix`
  (not the bare domain) or `*` (every domain), so `GET:HEAD:OPTIONS:*` is
  valid. Paths are start-anchored prefixes with `*`, canonicalized; query
  strings are ignored. A pattern that does not fit is a literal domain, so a
  typo matches nothing extra.
- **Order:** a `forbiddenDomains` match blocks; else a non-empty
  `allowedDomains` must match; else allow. (The SDK's type comment says the
  allow list wins; the docs' explicit order is newer.) So method limits must
  be an allow list: a forbidden `!GET:HEAD:*` would also block registries.
- **Blocked request:** HTTP 403 with `Proxy-Error: firewall_blocked`.
- **Enforcement:** without `firewall: { rulesets: ["proxy"] }`, only clients
  that honor `HTTP(S)_PROXY` are filtered. With it, all egress must go
  through the proxy.
- **Live result (2026-10-23):** ephemeral volumes now need Carbon
  (`EPHEMERAL_VOLUME_CONFLICT`: with the firewall in `us-pdx-1`, and "the
  previous infrastructure generation" in `eu-lon-1`), and Carbon has no
  firewalling, so the ruleset is off. Without it, in `us-pdx-1`: the proxy
  variables are set; `curl -X POST` and Python `urllib` POST get 403; GET
  gets 200; Node 22's `fetch` POST got through until `NODE_USE_ENV_PROXY=1`
  (now set for every sandbox command), then 403. Raw sockets and clients
  that ignore the variables are not filtered. Ask Blaxel when Carbon gets
  firewalling, then turn the ruleset back on and bump `lor-egress`.
- **Inside the sandbox:** `HTTP(S)_PROXY` points at a loopback shim that adds
  a rotating workload identity token, read from a file. Every process
  inherits the variables (process env is merged with the sandbox server's).
  The proxy CA is merged into `/etc/ssl/certs/sandbox-ca-bundle.crt`, and
  `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, `CURL_CA_BUNDLE` and
  `NODE_EXTRA_CA_CERTS` point at it. Git reads none of these: Debian's git
  (libcurl-gnutls) needs `GIT_SSL_CAINFO`.
- **Git over HTTPS:** clone and fetch send `POST …/git-upload-pack`; push
  sends `POST …/git-receive-pack`. GET-only egress blocks clone.
- **Always bypassed** (`NO_PROXY`): localhost, private ranges,
  `169.254.169.254`, `.local`, `.internal`.
- **Still unverified** (needs a live sandbox): whether the firewall blocks
  direct traffic to the bypassed ranges and the metadata address; DNS (and
  so DNS exfiltration); SSH and raw TCP; what the proxy's identity token can
  reach besides the proxy (workloads run as root, so they can read it);
  whether the Lor workspace is on Carbon.

## Sources

Tools: openai/codex (`exec_policy.rs`, `bash.rs`, `is_dangerous_command.rs`,
`is_safe_command.rs` @ `1b450c7`, guardian prompts, PRs #39524 #39630
#15796 #20085); learn.chatgpt.com/docs (approvals, rules, auto-review);
alignment.openai.com/auto-review (2026-04-30);
code.claude.com/docs/en/{permissions,permission-modes,security,sandboxing,hooks};
anthropic.com/engineering/{claude-code-auto-mode (2026-03-25),
claude-code-sandboxing (2025-10-20), how-we-contain-claude (2026-05-25)};
claude.com/blog/auto-mode-default-in-claude-code (2026-08-07);
github.com/anthropics/claude-code/security/advisories;
cursor.com/docs/agent/security/run-modes; cursor.com/blog/{agent-sandboxing,
agent-autonomy-auto-review}; cursor.com/changelog/1-3;
google-gemini/gemini-cli (`policy-engine.ts`, `commandSafety.ts`,
`shell-utils.ts`, `built-in.ts`, `conseca/`); microsoft/vscode
(`terminalChatAgentToolsConfiguration.ts`);
code.visualstudio.com/docs/agents/run/{approvals,security};
anomalyco/opencode (v1.19.3); block/goose (`permission_judge.rs`);
OpenHands/software-agent-sdk (`security/`); cline/cline; RooCodeInc/Roo-Code;
Aider-AI/aider; docs.typesafe.ai (Noul, Jev 1.13 jaggedness);
docs.blaxel.ai/Sandboxes/{Proxy,Proxy-domains,Proxy-secrets-injection};
docs.blaxel.ai/Infrastructure/Gens; github.com/blaxel-ai/sandbox
(`sandbox-api/src/lib/proxy/{proxy,ca,shim}.go`).

Advisories and incidents: backslash.security (Cursor denylist, 2025-07-21;
Claude Code auto mode, 2026-09-27); tracebit.com (Gemini CLI); Trail of
Bits 2025-10-22 (prompt injection to RCE); embracethered.com (Copilot
CVE-2025-53773, Jules, Devin); aws.amazon.com/security/security-bulletins/
AWS-2025-015; nx.dev/blog/s1ngularity-postmortem; adnanthekhan.com
(Clinejection); research.checkpoint.com (MCPoison); lakera.ai
(CVE-2025-59944).

Papers (arXiv): ToolEmu 2309.15817; R-Judge 2401.10019; Agent-SafetyBench
2412.14470; RedCode 2411.07781; OS-Harm 2506.14866; AgentHarm 2410.09024;
ShieldAgent 2503.22738; SHADE-Arena 2506.15740; CoT Red-Handed 2505.23575;
Ctrl-Z 2504.10374; Async Control 2512.13526; MonitoringBench 2605.09684;
LlamaFirewall 2505.03574; Design Patterns 2506.08837; AgentDojo 2406.13352;
CaMeL 2503.18813; The Attacker Moves Second 2510.09023; adaptive attacks on
monitors 2510.09462; AI Control 2312.06942; Akhawe & Felt, USENIX Security
2013 (warning click-through).
