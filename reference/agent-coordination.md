# Agent coordination log

**Status:** v1 built 2026-11-08. Builds on overlap notes
(`packages/lor/src/session-overlap.ts`).

## Problem

Code sessions run in separate sandboxes. Overlap notes tell an agent about
another session only after both have edited the same files, and people never
see that the agents coordinated.

## v1

- **Announce before editing.** Code sessions get `announce_changes(paths,
  summary)`. The code session prompt asks the agent to call it before it
  changes files. The result lists other sessions on the same repo that are
  editing those paths or announced them in the past day, so the agent reads
  their changes (`read_session_changes`) before its first edit.
- **One shared log, append-only.** `agent_coordination_entry` holds every
  announcement (`intent`) and every overlap note (`overlap`), per workspace and
  repository. Nothing updates or deletes rows; they go only when their session
  or workspace is deleted.
- **People can read it.** Code sessions' Details panel has a Coordination
  section (`GET /sessions/{id}/coordination`): the session's own entries,
  entries that name it, and other sessions' entries on files it announced or
  is editing.
- **Same audience rules as overlap notes.** Agents only hear about sessions
  their run may read (`privateAudienceFilter`). The panel drops entries from
  sessions in channels the viewer can't see.
- Best-effort like overlap notes: a failed log write or read never fails the
  turn.

## Later

- Agents messaging each other directly, and agreeing who takes a file.
- A repository-wide log view, not only per session.
- Realtime updates for the panel (it polls every 15 seconds today).
