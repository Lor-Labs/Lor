# Positioning

**Current direction — 2026-10-25:** Lor is the team workspace for the AI era.
Keep “A workspace for your whole team” above “Work with AI, together.” The
promise underneath is concrete: shared AI sessions bring the team's
conversations, tools and knowledge into work that teammates can join and
continue. Teams can start with one project alongside their existing chat.

## Current www story

The team shares the work itself: context, decisions, files and next steps.
A pasted answer leaves out how the team got there. Show someone starting the
work, another person adding context, and someone else picking it up.

Hero copy: “Research, build, and make decisions with AI in a shared workspace.
Your team can join in and pick up where you left off.”

The hero follows one customer problem through six scenes:

1. **Discuss:** Paygrove clicks Export repeatedly because the button looks
   idle. Zoe raises it in #product; Rafael adds customer notes.
2. **Investigate:** Zoe starts a Lor session. Lor reads the customer notes
   and export code. Theo joins and adds the requirement to preserve retries.
3. **Fork:** Theo uses the fork icon on Lor’s reply. The confirmation opens
   a new chat with “Forked from” provenance. “Continue in Code” stays in the
   session menu, matching the app’s separate fork and continue actions.
4. **Build:** Theo continues the fork into a code session in the same channel,
   with the investigation attached. Lor changes the export state; Zoe helps with
   the wording.
5. **Review:** show the changed files and a selectable diff, with the team
   present. A person reviews, commits and pushes under their own GitHub identity.
6. **Remember:** Rafael asks why the export behavior changed. Lor refers to
   the customer feedback and investigation.

Keep the previews free of explanatory “Product preview”, “Example team” and
“Example only” labels (Jacob, 2026-10-25). All interactions still use fictional,
local-only data and never call connected services.
The main preview shows Lor, not unfinished agent integrations or generated
shared apps. Voice presence stays out while voice is hidden for launch.

## Page sequence

- Hero and connected product story.
- “A pasted answer leaves a lot out”: join the session and keep the context.
  Explicitly say Lor works alongside existing team chat.
- “Take the conversation into code”: repositories, files, diffs, personal
  GitHub commits and pushes. Show a fork exploring a background export while
  the original approach stays intact. Rewind restores code and conversation
  together in code sessions.
- “Work out the process once. Put it to work every week”: recurring account
  research in #gtm, a downloadable shortlist, and an Attio write with an
  example approval policy. Approval updates local preview state only.
  Connectors and per-tool approvals support the story.
- Team memory through an account handover, answered by Lor.
- Agent choice: Lor in early access, Claude Code in development, Codex
  planned. Do not claim arbitrary custom agents are available.
- “Bring your next piece of work”: start with one project and its people;
  early-access signup remains the call to action.

## Copy and presentation

Describe the reader's experience with concrete jobs and examples. Do not
make infrastructure categories the headline. Keep ambition grounded in the
current implementation; planned agent integrations retain their status labels. Check the code and detailed runbook
checkboxes before changing agent availability. Some document summaries
still say code sessions, fork/rewind or Attio writes are unbuilt.

Product illustrations follow the app's document-style sessions: avatar
gutters, inline replies, sessions under their channel, a separate Details/file
panel, and files and diffs beside the chat. Match the app’s title size,
starter avatar, relative time, repository/branch metadata, and separate source
row with its fork or conversation icon. Lor replies include the fork action.
Code sessions show the real Details / Changes / Files panel: tracked files,
staging checkboxes, counts, and the commit box at the bottom. Opening a file
puts its tab beside Chat and replaces the document with the file or diff.
Channels contain human chat;
Lor works in sessions. Use the shared Lor tokens and components.

Keep the existing carousel behavior: advance every four seconds with a fill
across the active tab; pause over the preview, offscreen and in a background
tab. Keyboard navigation or scene interaction stops rotation until resumed.
Reduced-motion visitors use manual tabs. Keep panels mounted and the preview
height stable. The review scene's file buttons work with local state. The
Files panel shows an expandable fictional repository with complete source
previews and path filtering. Code and diffs use the app's Pierre renderer,
theme and font metrics. Code turns show a compact review summary, not a TSX
artifact attachment; its counts match the sample diff.

The broader ambition remains a workspace where teams can create and evolve
their own tools. Generated shared apps are a future direction, not the
homepage's current product demonstration.

## Earlier direction — 2026-10-12 (historical)

This doc sets how Lor is described in all marketing copy and in sales
conversations. It also records how that differs from the copy we have now.

## The change in one line

- **Now:** "The multiplayer AI workspace." Lor answers questions from company
  memory, with citations. The lead differentiator is open source and open
  models.
- **New:** "AI agents your whole team can steer." Each channel has a shared
  agent. The team sets it up once, everyone sees its work, anyone can step in,
  and the right person approves what goes out. Memory is one proof point, not
  the headline.

## Why it changed

- The current headline names a category, not a problem. A buyer cannot tell
  what job Lor does for them.
- "Answers from company memory" competes with ChatGPT and Claude team plans,
  which already ship connectors and shared projects.
- Nobody uses Lor yet. Moving team chat is the biggest adoption barrier. The
  new pitch works without a chat move: one channel and one job are enough to
  start.
- Personal agents (for example xAI's Grok Bot, beta since August 2026) are tied
  to one person's account. Nobody else sees the work or approves it. The shared
  version is open.

## Positioning statement (internal, never published)

> For small startup teams (3 to 20 people) who already do much of their work
> with AI, Lor gives each channel an AI agent the whole team can set up, steer
> and check. Unlike personal AI chats and personal agents, Lor keeps the work
> shared: the team sets up the tools once, everyone sees the work, anyone can
> step in, and the right person approves what goes out.

Every piece of copy says one part of this paragraph, for one audience.

## The problem we name

Team thinking moved into private AI chats. Each person works with AI in their
own tab. Results reach the team as pasted text or a screenshot. The reasoning
stays behind. Each person builds the same context again. When someone leaves,
their chats leave too.

## Message hierarchy

**Headline:** "AI agents your whole team can steer."

**Subhead:** "Set up an agent in any channel. Give it your team's tools. It
works when you ask or on a schedule. Anyone can see its work, step in, or
approve what it sends."

**Problem section** (first section, not the hero): "Stop doing AI work alone."

**Proof points.** Each one must be backed by a built feature.

| Claim | Backed by |
|---|---|
| Set it up once, for everyone | Channel instructions and connectors |
| It knows what your team knows | Memory from chat, voice and past sessions |
| It keeps working | Loops (`loops.md`) |
| Your team stays in charge | Shared sessions, step in by mention, approvals, roles |

**Example scenes.** One per audience. The demo video uses #gtm.

| Channel | Connectors | Job |
|---|---|---|
| #gtm | Attio, web | Find leads, check them against the CRM, draft outreach for approval |
| #eng | GitHub, Datadog, CloudWatch | Check errors on a schedule, link them to recent PRs |
| #product | Linear, Notion | Weekly digest of what shipped and what slipped |

GTM is the first example, not the category. Never call Lor an AI SDR.

**Trust line** (near the bottom): open models, approvals, permissions.

**Vision line** (founder note or investor deck only, never the hero): Lor will
build the tools your team needs.

## Words

- **Use:** agent, channel, session, steer, step in, approve, "on a schedule".
  Say "Loops" only inside the product.
- **Do not lead with:** "multiplayer AI workspace", "company brain", "context
  store".
- **Avoid:** "AI teammate" (Grok Bot's launch coverage uses "AI teammates"),
  "AI SDR" (crowded category), "autonomous" (scares buyers when the agent talks
  to their customers).
- Existing copy rules still apply: no em dashes, do not name Slack, no
  uppercase mono eyebrow labels, no invented numbers.

## Do not claim until true

| Claim | Why not yet |
|---|---|
| Open source, self-host | The repo is private. www GitHub links return 404 |
| Fork a session | Designed in `planned/code-channels.md`, not built |
| Self-configuring workspace, generated apps | V2 (`product-direction.md`) |
| Lor sends email or social messages | No send connector. Say "drafts" |
| Lor updates the CRM | The Attio connector is read-only |
| "Your data never leaves us" | Inference goes through AI Gateway to third-party providers |

Never design for automated messages from personal social accounts. LinkedIn's
terms ban automated activity (verify the current terms before building
anything near it). Lor drafts, a person approves, then it sends.

## Sales conversation (30 minutes)

**Target:** founders and early teams, 3 to 20 people.

**1. Discovery (10 min).** Let them name the problem.

- "Where does your team use AI today? On whose accounts?"
- "When someone gets a good result from AI, how does the rest of the team see
  it?"
- "What repeat work would you hand off if you could trust it? Who would need
  to check it?"

Listen for pasted AI output, the same work done twice, and a job they would
hand off but do not trust.

**2. Reframe (1 min).** "Your team uses AI a lot, but each person alone. Lor
makes it a shared agent. You set it up once, everyone sees the work, and
someone approves what goes out."

**3. Demo (10 min).** Use their job if possible. If not, use #gtm:

1. The channel with its instructions and connectors.
2. Start a loop.
3. Open a running session.
4. Mention a teammate. They step in and fix a draft.
5. The approval card.
6. Forward the result into the chat.

**4. Objections.**

| They say | We say |
|---|---|
| "We have ChatGPT or Claude Team." | "Keep them for personal work. Lor is for work the team should share. The setup, the context and the review happen once, for everyone." |
| "We won't move our chat." | "You don't need to. Start with one channel and one job." |
| "I don't trust AI to message customers." | "It drafts. Nothing goes out until someone you choose approves it." |
| "Why not Grok Bot?" | "That is one person's agent. Nobody else sees the work or approves it." |
| "What happens to our data?" | Answer from current facts only (open models through AI Gateway). Do not improvise. |

**5. Close.** Offer a pilot, not a plan: "Pick one job. We set up the channel
together this week. After two weeks we check two things: did it save time, and
did the team use it?" Billing is off in prod, so pilots are free in exchange
for a weekly 15-minute feedback call.

## How this differs from what we have now

### Message

| Element | Now | New |
|---|---|---|
| Category | "The open source multiplayer AI workspace for teams" (`layout.tsx` title and meta, hero) | "AI agents your whole team can steer" |
| Core promise | Answers with citations from company memory. "Ask once. Get the answer with receipts." "Decisions stop evaporating." | Shared agents that do recurring work. Memory is one proof point |
| Unit of the product | One assistant you @mention anywhere | A channel is a shared agent: instructions, connectors, memory, sessions |
| What Lor does | Answers, plus "Takes action" in one bento card | Does a job, on demand or on a schedule |
| What the team does | Asks and reads answers | Sets up, steers, steps in, approves |
| Example | "What shipped last week", "a call made in May" | A #gtm loop |
| Lead differentiator | Open source, open models, self-host | Shared, steerable, approval-gated work. Open models move to the trust line |
| Buyer | CTOs and eng leads at 5 to 50 person dev startups (brand spec) | Founders and early teams, 3 to 20 people. GTM widens it past engineering |
| Team chat | A selling point: "The chat your team already knows" | Optional at the start. One channel, one job |
| Founder note | Memory story: answers lost in scrollback | Open: the private AI chats story fits the new problem better. Jacob's call |

`product-direction.md` already says "Most company-brain products stop at
retrieving information. Lor should use company memory to help teams act." The
new positioning makes the "act" half the headline. It does not change product
direction.

### Current copy that is wrong under any positioning

| Copy | Where | Problem |
|---|---|---|
| "Mention @Lor in any channel or thread and the answer lands right there, visible to everyone." | `apps/www/app/components/feature-chapters.tsx:113` | The workspace model: `@Lor` in channel chat starts a session. Lor never posts in channel chat |
| Open source, self-host, AGPL, "View on GitHub" | `layout.tsx` meta, hero points, `open-stack.tsx`, `closing-cta.tsx` | The repo is private |
| "New workspaces start with 2,000 free credits. No card required." and the $20 seat | `closing-cta.tsx`, `pricing.tsx` | Billing is off in prod and launch pricing is undecided |

### What carries over

Citations, memory, voice memory, connectors and open models all stay. They
become proof points under the new headline instead of the headline.

### www section map (when the copy changes)

| Section now | Becomes |
|---|---|
| Hero: "The multiplayer AI workspace." + 4 feature bullets | New headline + subhead + the #gtm scene in the app mock |
| Chapters: Ask, Connect, Remember | Problem section, then the four proof points |
| Bento: Always in context, Takes action, Voice counts too, The chat your team already knows | Example scenes per channel (#gtm, #eng, #product) |
| Open stack | Trust line, without open-source claims until the repo is public |
| Founder note | Open (see above) |
| Pricing, closing CTA | Unchanged until launch pricing is decided |

## Gaps for the #gtm demo

- An email-send connector (Gmail or similar), gated by approval.
- Attio write (create and update records).
- A lead-data source, or rely on web search for the first version.

## Next steps

1. Dogfood: set up #gtm in Lor with one job, find Lor's first 5
   design-partner teams. Record the demo video from it.
2. Test the pitch: send three one-paragraph pitches (private AI chats, a shared
   #gtm agent, meetings that remember) to 10 to 15 founders. Count "I need this"
   replies.
3. Lock the headline and this doc after those two steps. Then change the www
   copy.

## Open questions

- Final headline wording.
- Whether the founder note changes.
- Whether the target includes non-technical founders, or starts with technical
  founders only.
- Pilot terms after billing turns on.
