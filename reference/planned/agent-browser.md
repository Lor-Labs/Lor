# Agent browser

> Status: planned, not started. Written 2026-10-12 with Jacob. Decided: build
> it after the `app-redesign-sessions` branch merges, as the first feature
> after it and before the demo video. Open: the vendor (Browserbase or Steel,
> decided by the spike) and the model. Vendor and model facts were checked on
> the web on 2026-10-12; check them again before the spike, because this
> market moves fast.

## Why

- Lor's pitch is "a channel is a shared agent" (`positioning.md`): a team
  gives a channel its tools and lets it work. Today Lor acts only through
  connector APIs and Exa search and fetch (`packages/lor/src/web.ts`). Much of
  the work teams want done has no API: careers pages, job boards, web apps,
  dashboards, forms.
- Agent products that do real work now give each agent a cloud computer with a
  browser. Users expect it.
- Our angle is the shared session. In most products the browser belongs to one
  person, or to a team bot that nobody watches together. In Lor the browser
  belongs to the session: everyone in it watches live, anyone can take over,
  and the right person approves what goes out. `workspace-model.md` already
  gives each session "its own computer… and its own screen".
- It makes the demo: #gtm finds leads in a browser while the team watches and
  steps in.

## How the industry does it (2026-10)

- **Cloud, not the user's device.** Most agent products give each agent (or
  each account) a persistent cloud computer with a browser, files and a
  terminal, so work goes on after the laptop closes. Browser extensions that
  drive the user's own browser exist too; they use the user's logins and stop
  when the browser closes.
- **Logins persist** between tasks.
- **The live view is one click away**, not always on screen: an "open browser"
  button, a card in the conversation, or a small window.
- **Take over, then hand back.** At a login, 2FA or CAPTCHA the agent stops and
  shows an "action needed" card. A person takes control, signs in and hands
  control back. Taking control pauses the agent. Passwords go in through the
  live view or a separate vault form, never through the chat or the model.
- **Approval cards** before sending, buying, publishing, deleting or changing
  permissions: allow once, always allow, deny. Some products add a second model
  that reviews outbound actions. Approvals raised by background work expire.
- **Audit trail:** a list of visited URLs and a recording.
- **Team products keep identities apart.** A channel's agent gets its own
  computer, separate from any person's, and never lends one person's logins to
  another. One product clears saved logins when collaborators join a shared
  task.
- **Common complaints:** slow browser tasks, usage limits that run out in
  minutes, unclear cost, long tasks that stall, and sites that block agents (a
  large online store blocked one agent product outright).
- The large companies run their own VMs. Small teams use hosted browser
  infrastructure.

## Decisions so far

- Build after the merge, before the demo video.
- A hosted cloud browser for v1. No self-hosting (see Steel self-hosted below).
- The vendor sits behind one provider file, like
  `packages/lor/src/providers/exa.ts`, so a switch rewrites one file.
- The browser is a built-in capability, not a connector (like `web`).
- No LinkedIn in the demo or in default prompts: its user agreement bans bots
  and shared logins.

## Vendors (checked 2026-10-12)

| | Browserbase | Steel Cloud | Kernel |
|---|---|---|---|
| Plan for us | Developer $20 (100 h, then $0.12/h); Startup $99 (500 h, then $0.10/h) | Launch $0 + $0.10/h; Scale $250 + usage ($100 included, then $0.08/h) | Plans $30 / $200; full-desktop browser about $0.48/h |
| Max session | 15 min free; 6 h on Developer and Startup | 15 min on Launch; 1 h on Scale; 24 h on Enterprise only | 72 h; standby (no billing) 5 s after the last viewer or controller leaves |
| Cost at 500 h/month | $99 | about $250 | about $260–390 |
| Logins | Contexts, encrypted; one session at a time per context | Profiles and a Credentials API | Profiles and managed auth (a hosted login; credentials never reach the model) |
| Live view | iframe, a URL per tab; watch-only by CSS (`pointer-events: none`); phone viewport documented, but "Mobile keyboards aren't officially supported"; URL auth not documented | WebRTC H.264 at 25 fps; `interactive` true or false; "Anyone with the debug URL can view or interact with that session" | iframe; read-only by a URL parameter; full-desktop mode only |
| CAPTCHA, proxies | CAPTCHA solving on paid plans; proxy 1 GB / 5 GB included, then $10–12/GB | CAPTCHA $1–3 per 1,000; proxy $6–10/GB | Not compared |
| Retention | 7 days (Developer), 30 days (Startup) | 7 days (Launch), 14 days (Scale) | 1–30 days |
| Compliance | SOC 2 Type II; verified bot identity on Scale only | HIPAA BAA on Scale; no SOC 2 listed | SOC 2 Type II (vendor claim) |
| Open source | Stagehand (the control library) only | Core (`steel-browser`), Apache-2.0 | Browser image, Apache-2.0 |

**Leaning: Browserbase.**
- Its 6-hour sessions on the $20 and $99 plans let one browser last a whole
  Lor run (2 h at most) plus a teammate's login. Steel's 1-hour cap on Scale
  means a new browser partway through long runs.
- It is the cheapest of the three at our volume.

**Steel's strengths:**
- An open-source core.
- A lower hourly price at high volume.
- A documented video stream.

The spike decides.

**Steel self-hosted (Railway).** There is a one-click Railway template, but:
- One instance holds one active session. `startSession` in
  `api/src/services/session.service.ts` resets the single `activeSession`. So
  each concurrent browser needs its own container, and we would run a pool and
  hand containers out.
- The API and the viewer have no auth. They must stay on the private network,
  behind our own authenticated proxy.
- Logins across runs, CAPTCHA, proxies and recordings are ours to build.
- Railway's datacenter IPs get flagged as bots.
- Revisit at thousands of browser-hours a month.

**Blaxel** (our sandbox vendor) has no managed browser. It has Playwright and
VNC desktop images, so a live view would be noVNC behind a preview URL, built
by us. Not for v1.

**Looked at and dropped:**
- Cloudflare Browser Run: its live view is a hosted page, not embeddable; it
  closes after 10 minutes idle; it has no profiles.
- Browser Use Cloud: Python first, and its proxy is on by default.
- Hyperbrowser, Anchor (SOC 2 only on the $2,000 plan), E2B Desktop, and
  Vercel Sandbox (no browser features).

## How it fits Lor

### Capability

- Add a `browser` value to `lorCapabilityEnum`
  (`packages/db/src/schemas/agent-profiles.ts`). Needs `db:push`.
- Add its descriptor in `packages/connectors/src/registry.ts` with
  `connector: null`.
- The API hides it when the vendor key is missing, as it does for `web` without
  `EXA_API_KEY` (`apps/api/src/routes/v1/agent-profiles/handlers.ts`).
- Add a tile in the profile editors: web `agent-profiles-section.tsx`, mobile
  `app/settings/agent-profiles.tsx`.
- Add a prompt line in `connectorPromptLines` (`packages/lor/src/index.ts`).

### The `browse` tool

- `browse({ goal, startUrl? })` in `packages/lor` runs a browser sub-agent,
  like the sandbox's coding sub-agent. Each action (open, click, type, read)
  streams as a sub-step with `parentToolCallId`, the pattern in
  `packages/lor/src/sandbox/sub-events.ts`, so the tool trail shows the steps.
- Lor gets a short result back. Screenshots and page text stay out of its main
  transcript.
- Control: Playwright over CDP to the vendor's browser.
  - Pages are read as accessibility-tree text with element references (the
    Playwright MCP approach). It costs far fewer tokens than screenshots and
    works with text-only models.
  - Screenshots only when the text is not enough (canvas, maps, image-only
    UIs). They reach the model the way `view_image` sends images
    (`toModelOutput` file part), never the saved transcript.
  - Stagehand v4 is optional: it takes a bring-your-own-model callback, which
    can call AI Gateway.
- `browse` joins `SIDE_EFFECT_TOOLS` (`packages/lor/src/tool-guard.ts`), so
  crash recovery doesn't repeat it.
- It respects the run's `deadlineAt` and `abortSignal` (Stop, steer).
- Page text is untrusted, wrapped like `fetch_web` output
  (`<untrusted_web_content>`).

### Browser lifetime and cost

- One browser per Lor session, keyed by the thread root like the workbench
  sandbox (`wbs-{scopeKey}`). It starts on the first `browse`, stays up for
  the run plus a short idle time, then closes. The next run starts a new
  browser with the channel's logins.
- Cost cap: browser-hours per channel per month and a cap per run. It is our
  first guard on external compute; sandboxes still have none
  (`github-connector.md`).
- Count browser time in run credits.

### Logins per channel

- One vendor profile per channel, its id kept in a new table and encrypted
  with `encryptSecret` (`packages/utils/src/crypto.ts`) if the vendor treats it
  as a bearer key.
- Teammates log in through take over. The UI says so plainly: "Logins here are
  shared with everyone in #gtm." Never copy a person's own browser logins in.
- A profile serves one browser at a time (Browserbase contexts; check Steel).
  A second session in the same channel waits or runs logged out. Open.
- Sites expire cookies, so expect an occasional new login.

### Live view and take over

- **Web:**
  - A new right-panel view type (`right-sidebar-types.ts`).
  - It opens from a "Browser" card in the transcript, which shows while
    `browse` runs and reads "Action needed" when Lor needs a person. It also
    opens from the session's Details panel (`session-work-panel.tsx`).
  - Everyone in the session watches read-only.
- **Take over:**
  - One controller at a time: a lock on the server and a socket event to the
    session room.
  - Taking over pauses the sub-agent and makes the controller's view
    interactive.
  - "Hand back" resumes it with a note ("Rafael signed in").
  - Watch-only is a display mode, not a security boundary. Session members can
    already steer Lor.
- **Live-view URLs are bearer links.** The API mints them per viewer after it
  checks session access. They never go in messages or logs.
- **Desktop:** the Tauri CSP (`apps/desktop/src-tauri/tauri.conf.json`) has no
  `frame-src`, so `default-src` blocks the vendor iframe. Add the vendor's
  live-view origin.
- **Phone:**
  - A "Browser" row in `components/session-sheet.tsx` opens the live view full
    screen.
  - `@expo/dom-webview` is already a dependency; whether it can host the
    vendor page is unverified. `react-native-webview` is the fallback.
  - Typing in the live view on iOS is unverified for every vendor.
- **Recordings:** vendors keep them 7–30 days. v1 links to the vendor's replay.
  Keeping them longer (copy to R2) is open, since we keep team data by
  default.
- **Later:** the browser as a participant in a call, the `liveView` slot in
  `voice-channels-runbook.md`.

### Approvals and safety

- **Approval gates are per capability today** (`approval-policies.md`), so a
  gate on `browser` would also gate reading.
  - Options: a second capability for outbound actions (`browser_act`, like
    `linear` and `linear_write`), or a new approval target for one tool.
  - A sub-agent can click a "Send" button with a plain click, so the gate only
    works if outbound actions go through a gated tool. How the sub-agent knows
    when to use it is open. Some products add a review model.
- **Prompt injection** has no full fix. Use these layers:
  - page text marked untrusted;
  - approvals before outbound actions;
  - an optional domain allowlist per channel;
  - no browser content written to memory without review;
  - credentials never through the model.
- **Bot detection.** Use the vendor's CAPTCHA solving. No residential proxies by
  default (cost). Use verified bot identity where the plan has it.
- **Site terms.** Some sites ban bots or shared logins (LinkedIn). Keep them out
  of demos and default prompts.

## Models

- Open models only, through AI Gateway. Today: `zai/glm-5.3-flash` (takes
  images, per `attachment-search.md`), with `moonshotai/kimi-k3` as the
  fallback.
- Candidates for the sub-agent (OSWorld-Verified scores, mostly self-reported,
  via llm-stats.com):
  - `alibaba/qwen3.8-27b`: 84.3%, $0.04 / $0.40 per million tokens.
  - `moonshotai/kimi-k2.6`: 73.1%.
  - `minimax/minimax-m3`: 70.1%.
  - `zai/glm-5v-turbo`.
- On live-web benchmarks (Online-Mind2Web), closed systems still lead.
- The sub-agent has its own loop, so it can use its own model
  (`LOR_BROWSER_MODEL`).

## Spike (one to two days)

- [ ] Browserbase Developer ($20) and Steel Launch (free): run the same 10 real
  tasks on each.
- [ ] Live view in an iPhone WebView, typing included, and in the Tauri app.
- [ ] A login survives into the next run through the channel's profile.
- [ ] Images in tool results through AI Gateway with our model (unverified,
  `context-continuation.md`).
- [ ] Model eval on 30 tasks: GLM-5.3-flash, Qwen3.8-27B, Kimi K2.6. Record
  success, steps, time and tokens.
- [ ] Measure minutes and tokens per task for the cost model.

## Steps (after the spike, about 2,000–2,500 lines)

1. Capability, provider file, browser lifetime, `browse` sub-agent with
   streamed sub-steps, cost cap.
2. Live view panel on web and the Browser card in the transcript.
3. Take over and hand back, per-channel profiles and the shared-login notice.
4. Approvals for outbound actions, domain allowlist.
5. Phone: session sheet row, full-screen live view, take over.
6. Recordings and the list of visited URLs.

## Cost at 500 browser-hours a month

- Browser: Browserbase Startup $99 (plus proxy over 5 GB at $10/GB); Steel
  Scale about $250; Kernel about $260–390.
- Tokens are likely the larger cost. A rough guess of 200 steps an hour at 10k
  input tokens a step gives about $50 on Qwen3.8-27B and about $900 on Kimi
  K2.6. Measure in the spike.

## Open questions

- Vendor and model (spike).
- The approval shape for outbound actions, and how the sub-agent routes them
  through the gate.
- Two sessions in one channel that need the same logged-in profile.
- How long we keep recordings.
- Browser-hours in billing.

## Sources

- Browserbase: [pricing](https://www.browserbase.com/pricing),
  [plans](https://docs.browserbase.com/account/billing/plans),
  [live view](https://docs.browserbase.com/features/session-live-view),
  [contexts](https://docs.browserbase.com/features/contexts),
  [security](https://docs.browserbase.com/account/enterprise/security)
- Steel: [pricing](https://steel.dev/pricing),
  [live sessions](https://docs.steel.dev/overview/sessions-api/embed-sessions/live-sessions),
  [steel-browser](https://github.com/steel-dev/steel-browser),
  [session.service.ts](https://github.com/steel-dev/steel-browser/blob/main/api/src/services/session.service.ts),
  [Railway template](https://railway.com/deploy/steel-browser)
- Kernel: [pricing](https://www.kernel.sh/docs/info/pricing),
  [live view](https://www.kernel.sh/docs/browsers/live-view),
  [standby](https://www.kernel.sh/docs/browsers/standby),
  [kernel-images](https://github.com/kernel/kernel-images)
- Blaxel: [sandbox templates](https://docs.blaxel.ai/Sandboxes/Templates)
- Cloudflare: [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
- Stagehand v4: [models](https://docs.stagehand.dev/v4/configuration/models)
- Models: [OSWorld-Verified](https://llm-stats.com/benchmarks/osworld-verified),
  [Online-Mind2Web](https://leaderboard.steel.dev/leaderboards/online-mind2web/),
  [AI Gateway models](https://vercel.com/ai-gateway/models)
- [LinkedIn user agreement](https://www.linkedin.com/legal/user-agreement)
