import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import {
  fetchGranolaNote,
  fetchGranolaTranscript,
  formatGranolaTranscript,
  type GranolaNote,
  granolaMeetingAt,
  granolaMinutes,
  granolaRequest,
  granolaTranscriptResume,
} from "./providers/granola"

// Meeting notes from a Granola workspace API key: search, read one meeting,
// read its transcript. reference/granola-connector.md.

const SEARCH_LIMIT_DEFAULT = 10
const SEARCH_LIMIT_MAX = 30
const SUMMARY_MAX = 12_000
const TRANSCRIPT_DEFAULT = 20_000
const TRANSCRIPT_MAX = 60_000
const NOTE_ID = /^not_[a-z0-9]{14}$/i

const granolaContext = z.object({ externalId: z.string() })

export async function resolveWorkspaceGranola(
  workspaceId: string
): Promise<{ externalId: string } | null> {
  const conn = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "granola"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return conn ? { externalId: conn.externalId } : null
}

const noteIdInput = z
  .string()
  .trim()
  .regex(NOTE_ID, "a Granola note id, like not_1d3tmYTlCICgjy")
  .describe("the meeting's note id (not_…) from search_granola_meetings")

type SearchHit = {
  id: string
  title: string | null
  owner?: { name: string | null; email: string }
  meeting_at?: string
  passages?: {
    text: string
    start_time: string | null
    matched_keywords?: string[]
  }[]
}

type SearchOutput = {
  notes: SearchHit[]
  hasMore: boolean
  cursor: string | null
  completion_status?: "more_available" | "exhausted" | "incomplete"
}

function meetingTitle(note: Pick<GranolaNote, "title" | "calendar_event">) {
  return (
    note.title?.trim() ||
    note.calendar_event?.event_title?.trim() ||
    "Untitled meeting"
  )
}

export const granolaTools = {
  search_granola_meetings: tool({
    description:
      "Search the team's Granola meeting notes, newest first. `keywords` match note titles and summaries; with `inTranscript` they match what was said instead, and each result carries short excerpts with start times. `participant` matches an invitee's name, email, company or domain. With no keywords and no participant it lists recent meetings. Then read one with get_granola_meeting.",
    inputSchema: z.object({
      keywords: z
        .array(z.string().trim().min(1).max(100))
        .max(20)
        .optional()
        .describe(
          "each entry matches when all its words appear; a meeting needs one matching entry. List synonyms as separate entries"
        ),
      inTranscript: z
        .boolean()
        .optional()
        .describe("search what was said instead of the notes; needs keywords"),
      participant: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe("a name, email, company or domain, e.g. acme.com"),
      fromDate: z
        .string()
        .optional()
        .describe("meetings starting on or after this ISO date or time"),
      toDate: z
        .string()
        .optional()
        .describe("meetings starting on or before this ISO date or time"),
      limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional(),
      cursor: z
        .string()
        .max(2048)
        .optional()
        .describe("the cursor from a previous call, for the next page"),
    }),
    contextSchema: granolaContext,
    execute: async (input, { context }) => {
      if (input.inTranscript && !input.keywords?.length && !input.cursor) {
        return { error: "Searching transcripts needs keywords" }
      }
      const body = input.cursor
        ? {
            cursor: input.cursor,
            page_size: input.limit ?? SEARCH_LIMIT_DEFAULT,
          }
        : {
            ...(input.keywords?.length ? { keywords: input.keywords } : {}),
            ...(input.participant ? { participant: input.participant } : {}),
            ...(input.fromDate ? { from_date: input.fromDate } : {}),
            ...(input.toDate ? { to_date: input.toDate } : {}),
            page_size: input.limit ?? SEARCH_LIMIT_DEFAULT,
          }
      const res = await granolaRequest<SearchOutput>(
        context.externalId,
        input.inTranscript ? "/notes/transcripts/search" : "/notes/search",
        { method: "POST", body }
      )
      if (!res.ok) return { error: res.message }
      return {
        meetings: res.data.notes.map((note) => ({
          id: note.id,
          title: note.title?.trim() || "Untitled meeting",
          url: null,
          meetingAt: note.meeting_at ?? null,
          notesBy: note.owner?.name ?? note.owner?.email ?? null,
          ...(note.passages?.length
            ? {
                passages: note.passages.map((p) => ({
                  text: p.text,
                  startTime: p.start_time,
                })),
              }
            : {}),
        })),
        cursor: res.data.hasMore ? res.data.cursor : null,
        ...(res.data.completion_status === "incomplete"
          ? {
              note: "The search stopped before finishing; narrow it with dates or a participant",
            }
          : {}),
      }
    },
  }),

  get_granola_meeting: tool({
    description:
      "Read one Granola meeting: its title, link, when it was, who attended, the calendar event, its folders and the AI notes (summary). For what was said, use get_granola_transcript.",
    inputSchema: z.object({ noteId: noteIdInput }),
    contextSchema: granolaContext,
    execute: async ({ noteId }, { context }) => {
      const res = await fetchGranolaNote(context.externalId, noteId, false, 0)
      if (!res.ok) return { error: res.message }
      const note = res.data
      const summary =
        note.summary_markdown?.trim() || note.summary_text?.trim() || ""
      return {
        id: note.id,
        title: meetingTitle(note),
        url: note.web_url ?? null,
        meetingAt: granolaMeetingAt(note),
        durationMinutes: granolaMinutes(note),
        notesBy: note.owner?.name ?? note.owner?.email ?? null,
        attendees: (note.attendees ?? []).map((a) => ({
          name: a.name,
          email: a.email,
        })),
        calendarEvent: note.calendar_event
          ? {
              title: note.calendar_event.event_title ?? null,
              organiser: note.calendar_event.organiser ?? null,
              invitees: (note.calendar_event.invitees ?? []).map(
                (i) => i.email
              ),
              start: note.calendar_event.scheduled_start_time ?? null,
              end: note.calendar_event.scheduled_end_time ?? null,
            }
          : null,
        folders: (note.folder_membership ?? []).map((f) => f.name),
        summary:
          summary.length > SUMMARY_MAX
            ? `${summary.slice(0, SUMMARY_MAX)}…`
            : summary,
      }
    },
  }),

  get_granola_transcript: tool({
    description:
      "Read what was said in a Granola meeting, as speaker turns. Long meetings come back in parts: pass `fromTime` (an excerpt's start time from search_granola_meetings) to start there, and raise `maxChars` for more.",
    inputSchema: z.object({
      noteId: noteIdInput,
      fromTime: z
        .string()
        .optional()
        .describe("start at the first line ending after this ISO time"),
      maxChars: z.number().int().min(1_000).max(TRANSCRIPT_MAX).optional(),
    }),
    contextSchema: granolaContext,
    execute: async ({ noteId, fromTime, maxChars }, { context }) => {
      const max = maxChars ?? TRANSCRIPT_DEFAULT
      const [note, transcript] = await Promise.all([
        fetchGranolaNote(context.externalId, noteId, false, 0),
        fetchGranolaTranscript(context.externalId, noteId, max, fromTime),
      ])
      if (!transcript.ok) return { error: transcript.message }
      const owner = note.ok
        ? (note.data.owner?.name ?? note.data.owner?.email ?? null)
        : null
      const text = formatGranolaTranscript(transcript.data, owner, max)
      const resume = granolaTranscriptResume(transcript.data, owner, max)
      return {
        id: noteId,
        title: note.ok ? meetingTitle(note.data) : null,
        url: note.ok ? (note.data.web_url ?? null) : null,
        transcript: text || "(no transcript)",
        ...(resume
          ? {
              note: `Cut at ${max} characters; continue with fromTime ${resume}`,
            }
          : {}),
      }
    },
  }),
}
