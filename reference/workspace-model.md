# Workspace model: human chat, Lor sessions

**Status:** Design locked with Jacob on 2026-10-08: the fundamentals and the
pass over existing features. Building from `workspace-model-runbook.md` on the
`app-redesign-sessions` branch. Prototype: `/prototype` in the web app
(`apps/web/src/components/prototype/`).

## Problem

- Users cannot tell where to prompt Lor and where to talk to teammates.
- The app reads as Slack or Discord.
- Lor's work gets lost in a channel's message history.
- Lor's reply rules are invisible. Lor replies on `@Lor`, inside a 2-minute
  reply window, and in threads where it has posted until someone mentions a
  teammate (`apps/realtime/src/services/lor-session.ts`). The placement router
  then picks channel or thread.

## Why sessions

Talking to Lor is handing off work that runs in its own place. It is not
chatting with a coworker in Slack. People already work this way in ChatGPT,
Claude, Cursor and Claude Code: one session per piece of work. A session is one
context with clear edges. Sessions run side by side, and a failed one costs
nothing. Lor's difference is that sessions are multiplayer and live in shared
places.

## Locked

1. **Channel chat is people talking to people.** Lor never posts in channel
   chat, and prompts to Lor do not post there either. A person can share a
   session result into the chat as one message. Why: no AI slop in the team
   stream, a burst of prompts does not flood it, and Lor's work no longer gets
   lost in history.
2. **Lor works in sessions.** A session is one place where Lor works on one
   thing, and you can come back to it. It has a title, its own context
   (session history plus the channel's instructions, connectors and memory),
   its own computer (sandbox and files), a visible state and its own screen.
   It stays searchable after it is done.
3. **Sessions sit next to the chat, not inside it.**
   - Start: "New session" is separate from the chat composer. "Ask Lor about
     this" on a chat message opens a new session with that message attached.
     It posts nothing in the chat.
   - Open: the session takes the main area. Lor's answers read as documents.
     A rail holds the plan, files and live computer.
   - Find: sessions are listed under their channel in the sidebar with a
     state. Archived sessions leave that list and stay in search and in the
     channel's full session list.
4. **A channel is a shared project plus a team chat.** The project holds
   instructions, connectors, files, memory and sessions. The chat is people.
5. **Anyone who can see a session can type in it.** People can also talk to
   each other inside a session. Messages to people stay in the session
   history, so Lor reads them as context on its next turn.
6. **The composer shows where a message goes before it is sent.** It changes
   to a Lor state (for example, it shows the model picker) when the message
   goes to Lor, and animates between states. Planned change (2026-10-21,
   `planned/code-channels.md` §2): chat sessions show no model picker and use
   the workspace default; people with a connected personal subscription see a
   harness picker; code sessions show harness and model pickers.
7. **`@Lor` in channel chat starts a new session.** Nothing posts in the
   chat. The user stays on the channel after sending, and the session appears
   under the channel in the sidebar. Users can send many in a row, so sessions
   run in parallel. `@Lor @Sam` also adds Sam to the session and pings him.
8. **The session gets the message plus the recent conversation it belongs
   to.** The session's Details panel links to these messages ("#general ·
   6 messages") in a Context section, so everyone can see what Lor was given.
   (Jacob moved it there on 2026-10-09 from a block at the top of the
   transcript, and preferred a link to quoting the messages.) Lor searches for
   more with its existing tools. Safe because the session and the channel
   have the same audience.
9. **Cost does not limit the design.** Parallel sessions are billed usage.
10. **Session states reuse today's thread and plan indicators.** Spinner =
    running. Blue dot = unread. Alert icon = needs something (an approval,
    an answer to a question, other input).
11. **Archive closes a session for everyone.** One person archives it, and it
    leaves every sidebar. People who have it open see a notice ("Ana archived
    this session") with an Unarchive action. Archived sessions stay in search
    and in the channel's full session list.
12. **The sidebar is the attention surface. There is no inbox view.**
    - Each session row shows its own state.
    - Each channel shows at most 3 of your sessions, ordered alert, then
      running, then unread, then the rest. A "N more" row shows the strongest
      state of the hidden ones and expands the list in place.
    - Hovering the channel's # (not the row) turns it into a chevron that
      collapses the channel's sessions. A collapsed channel row shows the
      strongest state of its sessions: alert, then spinner, then dot.
    - Starting a session in a collapsed channel expands that channel.
    - "Needs you" always notifies. "Done" notifies the session's subscribers.
      Running never notifies.
    - Who is needed: a question from Lor goes to the starter (anyone in the
      session can answer). An approval goes to the people the approval
      policies allow to approve. A mention goes to the person mentioned.
    - A cross-channel "Your sessions" list can come later if sidebars get
      too long to scan.
13. **The sidebar shows only the sessions you are subscribed to.** See
    "Subscriptions" in the pass below. The channel's full session list shows
    everyone's sessions, so teammates can browse and join each other's work.
14. **Session messages are routed by a fixed rule, decided per message. No
    model is involved.**
    - A plain message goes to Lor.
    - Mentioning a person pings them, and Lor does not run.
    - Mentioning Lor and a person pings the person, and Lor runs.
    - Replying to a person's message counts as mentioning them.
    - The destination pill in the composer can be switched by hand to send to
      the people in the session without starting Lor or pinging anyone.
15. **Archive details.** These were recommended and Jacob did not object.
    - Anyone who can type in a session can archive it.
    - An archived session is read-only. An "Archived by Ana · Unarchive" bar
      replaces the composer.
    - Archiving while Lor is running asks for confirmation, then stops the
      run.
    - Unarchiving brings the session back for everyone.

16. **Places.**
    - Every session belongs to exactly one channel.
    - No Home in the MVP. The app opens where you were last (today's
      behavior). New users land in `#general`.
    - "New session" (a sidebar button and ⌘N) opens an empty session in the
      main area: a centered prompt box with the current channel selected,
      changeable before sending. Planned (2026-10-21): a `Chat | Code` switch
      in that box, with a repository picker in Code mode
      (`planned/code-channels.md` §2).
    - The channel page is the chat. A "Sessions" button in the channel header
      opens the channel's full session list as a new right-panel view type,
      with active and archived filters.
    - Projects keep grouping channels. A project's overview can list the
      sessions across its channels.
    - Voice channels keep their model (`voice-channels.md`): call chat is
      human-only, `@Lor` does nothing there, and Lor works in its own window.
      `@Lor` in a call chat does not start a session for now.
    - DMs do not change: people only, no Lor, separate route.
    - Risk for later: project → channel → session makes the sidebar three
      levels deep. Projects may need to render as section headers.

17. **No private sessions in the MVP.** Every session is visible to its
    channel. An opt-in private mode can come later without breaking this
    model (`planned/private-lor-questions.md`).
18. **The UI word is "session".** The collisions are in code only: the voice
    UI already says "calls", the reply window in `lor-session.ts` goes away
    with this model, and code-channel sessions are the same concept.

The fundamentals are complete as of 2026-10-08.

## Pass over existing features

Features that put Lor or machine content in channel chat today.

### Quick changes (accepted 2026-10-08)

- **Placement router and Lor channel replies:** delete. `@Lor` in chat starts
  a session.
- **2-minute reply window and thread mute (`lor-session.ts`):** delete. The
  session routing rule replaces them.
- **`plan_card` in chat:** stop posting it. The plan lives in the session's
  right rail.
- **Approval cards:** live in the session. The approvers get a "needs you"
  alert.
- **`proposal_card`:** posts in the session where Lor proposed the change,
  not in the channel. The approvers get a "needs you" alert. Approval and
  rejection stay in the session, and Lor continues there.
- **`propose_loop` card:** shows in the session where the user asked for the
  loop.
- **Lor intro message in `#general` (`onboarding.md` Step 2):** delete. The
  empty New session view teaches what Lor does. Jacob wants to redo how
  onboarding introduces Lor after this (noted in `onboarding.md`).
- **Onboarding hints (Step 8 built, Step 9 not built):** rewrite the `@Lor`
  copy to teach "@Lor starts a session" and ⌘N.
- **Mobile:** mirror every change above.

### Decisions (locked 2026-10-08)

1. **Headless Lor runs (loops and connector triggers).** Today loops can
   post in the channel (`post_channel_message`), post a `loop_fire` chip on
   each run, and post an auto-pause note.
   - Locked: a loop is one recurring session, so Lor sees past runs as
     context. Each fire adds a turn. Loop runs already share one scope
     (`scopeKey = loop.id`). Planned exception (2026-10-21): code Loops start
     a new code session per fire, for review (`planned/code-channels.md` §2).
   - Locked: each connector-trigger event starts a new session. Act effects
     run in a session.
   - Locked: `post_channel_message` goes away, with no exception for loops.
     A person shares a result into the chat if the team should see it.
   - Locked: only the creator is subscribed to a loop's session by default.
     Mentioning people when setting up a loop subscribes them, and the
     creator can choose "everyone in the channel". That puts the loop's
     session in each member's sidebar without posting in the chat. See
     item 4 for the subscription model.
   - Locked: archiving a loop's session is a dismissal. The loop keeps
     running, and its next run brings the session back. Only pausing,
     cancelling or deleting the loop stops it.
2. **Connector and webhook posts.** Locked: they stay in the chat. They are
   factual event feeds a person set up on purpose, not AI-written text. The
   rule: "Channel chat holds what people write, plus event feeds people set
   up. Lor never writes there."
3. **Call summaries (`call_summary`).** Locked: the summary moves out of the
   call chat into a Summary tab, placed before Chat and Transcript in the
   call's right panel (`thread-panel.tsx`). The tab opens by default for
   ended calls, and each row in the past-calls list shows the summary title.
4. **Subscriptions (absorbs LOR-97).** Gap found 2026-10-08: one mention
   would keep a session in your sidebar until someone archives it for
   everyone. One concept for sessions, loops and human threads in channel
   chat:
   - You are subscribed if you started it, were mentioned, sent a message,
     acted in it (approved, answered Lor's question), or someone added you.
     Opening it never subscribes you.
   - Your sidebar and notifications follow your subscriptions.
   - The session header shows a subscriber avatar stack, a
     Subscribe/Unsubscribe button, and a Linear-style "Change subscribers…"
     dropdown (⌘⇧S). Anyone in the session can add or remove subscribers.
     Being added notifies you like a mention.
   - Unsubscribing removes the session from your sidebar and stops its
     notifications. Nobody else is affected. A new mention subscribes you
     again.
   - Human threads in channel chat use the same model.
     `ThreadSubscriberStack` shows participants today, and there is no
     explicit subscription table yet.
   - Notifications are subscribed-only in the MVP. The global
     `lorThreadNotifications` setting (`all_activity` | `subscribed_only`,
     default `all_activity` today) goes away.
   - Deferred: a per-channel "Subscribe me to all new sessions" option, off
     by default, in the channel notification menu. Jacob agrees with it but
     does not need it now.
5. **Lor reactions (`react_to_message`).** Lor can react to any message by
   id today. Locked: reactions only on messages inside a session, so Lor has
   no presence in channel chat.

The pass over existing features is complete as of 2026-10-08.

## Rejected

| Option | Why not |
|---|---|
| ChatGPT-style UI for every channel | Removes the team chat |
| Thread-first channels for all chat (Zulip, Twist) | Makes casual chat heavy; not needed once Lor's work moves out of chat |
| Lor replies in chat, a card links to the session | This is today's plan card plus thread side panel |
| Private-first Home composer | Pulls usage into single-player mode and starves shared memory |
| `@Lor` prompt posts in chat with a link to its session | Floods the chat when people send many prompts; prompts are written for Lor, not teammates |
| Personal archive (hides a session from your sidebar only) | Jacob wants one person to be able to close out the work for everyone |
| A separate inbox view for sessions | The sidebar already groups sessions under channels; revisit only if it gets too long to scan |
| A decision model (Jev, Clef) routes each session message | Brings back the placement-router problem; the composer would flip while typing; wrong calls cost trust. A model may suggest a mention, never reroute |
| Call Lor's work "threads" (2026-10-08) | Collides with human reply threads, which stay. Only works if human threads are dropped for quoted replies; Jacob kept both |
| One driver per session, or only the starter types | Less multiplayer. Jacob confirmed on 2026-10-21 that code sessions also let everyone type; one Lor turn runs at a time |
