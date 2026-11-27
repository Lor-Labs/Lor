import { and, db, eq, schema } from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import {
  type CirclebackActionItem,
  type CirclebackMeeting,
  type CirclebackTranscriptSegment,
  circlebackAttendees,
  circlebackMeetingUrl,
  circlebackMinutes,
  circlebackRequest,
  circlebackTitle,
  formatCirclebackTranscript,
} from "./providers/circleback"

// Meetings and action items through a read-only Circleback key: what its
// owner can see. reference/circleback-connector.md.

const RESULTS_MAX = 20
const NOTES_EXCERPT = 400
const NOTES_MAX = 12_000
const TRANSCRIPT_DEFAULT = 20_000
const TRANSCRIPT_MAX = 60_000

const circlebackContext = z.object({ externalId: z.string() })

export async function resolveWorkspaceCircleback(
  workspaceId: string
): Promise<{ externalId: string } | null> {
  const conn = await db
    .select({ externalId: schema.integrationConnection.externalId })
    .from(schema.integrationConnection)
    .where(
      and(
        eq(schema.integrationConnection.workspaceId, workspaceId),
        eq(schema.integrationConnection.provider, "circleback"),
        eq(schema.integrationConnection.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return conn ? { externalId: conn.externalId } : null
}

const meetingIdInput = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe("the meeting's id from search_circleback_meetings")

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text

function meetingSummary(meeting: CirclebackMeeting) {
  return {
    id: meeting.id,
    title: circlebackTitle(meeting),
    url: circlebackMeetingUrl(meeting.id),
    createdAt: meeting.createdAt ?? null,
    durationMinutes: circlebackMinutes(meeting),
    attendees: circlebackAttendees(meeting).slice(0, 8),
    notes: meeting.notes ? clip(meeting.notes.trim(), NOTES_EXCERPT) : null,
  }
}

function actionItem(item: CirclebackActionItem) {
  return {
    id: item.id,
    title: item.title ?? null,
    description: item.description ?? null,
    owner: item.assignee?.name ?? item.assignee?.email ?? null,
    status: item.status ?? null,
    completedAt: item.completedAt ?? null,
    meetings: (item.meetings ?? []).map((m) => ({
      id: m.id,
      title: m.name ?? null,
      url: circlebackMeetingUrl(m.id),
    })),
  }
}

export const circlebackTools = {
  search_circleback_meetings: tool({
    description:
      "Search the team's Circleback meetings by keyword in their names, notes and transcripts, newest first. With no keyword it lists recent meetings, optionally between two dates. It reaches the meetings of the person whose key Lor uses and those shared with them; meetings from the Circleback webhook are also stored as sources, so search finds those too. Then read one with get_circleback_meeting.",
    inputSchema: z.object({
      keyword: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe("words to find in meeting names, notes and transcripts"),
      fromDate: z
        .string()
        .optional()
        .describe("with no keyword: meetings on or after this ISO date"),
      toDate: z
        .string()
        .optional()
        .describe("with no keyword: meetings on or before this ISO date"),
      cursor: z
        .string()
        .max(2048)
        .optional()
        .describe("the cursor from a previous call, for the next page"),
    }),
    contextSchema: circlebackContext,
    execute: async (input, { context }) => {
      const query = new URLSearchParams()
      if (input.cursor) query.set("cursor", input.cursor)
      let path: string
      if (input.keyword) {
        query.set("searchTerm", input.keyword)
        path = `/search?${query}`
      } else {
        query.set("ownership", "All")
        if (input.fromDate) query.set("createdAtGte", input.fromDate)
        if (input.toDate) query.set("createdAtLte", input.toDate)
        path = `/meetings?${query}`
      }
      const res = await circlebackRequest<CirclebackMeeting[]>(
        context.externalId,
        path
      )
      if (!res.ok) return { error: res.message }
      return {
        meetings: res.data.slice(0, RESULTS_MAX).map(meetingSummary),
        cursor: res.next,
      }
    },
  }),

  get_circleback_meeting: tool({
    description:
      "Read one Circleback meeting: its title, link, time, length, attendees with their titles and companies, tags, Circleback's notes and its action items. For what was said, use get_circleback_transcript.",
    inputSchema: z.object({ meetingId: meetingIdInput }),
    contextSchema: circlebackContext,
    execute: async ({ meetingId }, { context }) => {
      const res = await circlebackRequest<CirclebackMeeting>(
        context.externalId,
        `/meeting/${encodeURIComponent(meetingId)}`
      )
      if (!res.ok) return { error: res.message }
      const meeting = res.data
      return {
        id: meeting.id,
        title: circlebackTitle(meeting),
        url: circlebackMeetingUrl(meeting.id),
        createdAt: meeting.createdAt ?? null,
        durationMinutes: circlebackMinutes(meeting),
        attendees: (meeting.attendees ?? []).map((a) => ({
          name: a.name ?? null,
          email: a.email ?? null,
          title: a.title ?? null,
          company: a.companyName ?? null,
        })),
        tags: (meeting.tags ?? [])
          .map((tag) => (typeof tag === "string" ? tag : tag.name))
          .filter(Boolean),
        notes: clip(meeting.notes?.trim() ?? "", NOTES_MAX),
        actionItems: (meeting.actionItems ?? []).map(actionItem),
      }
    },
  }),

  get_circleback_transcript: tool({
    description:
      "Read what was said in a Circleback meeting, as speaker turns with their time into the meeting. Long meetings come back in parts: pass `fromSeconds` to start later, and raise `maxChars` for more.",
    inputSchema: z.object({
      meetingId: meetingIdInput,
      fromSeconds: z
        .number()
        .min(0)
        .optional()
        .describe("start at this many seconds into the meeting"),
      maxChars: z.number().int().min(1_000).max(TRANSCRIPT_MAX).optional(),
    }),
    contextSchema: circlebackContext,
    execute: async ({ meetingId, fromSeconds, maxChars }, { context }) => {
      const max = maxChars ?? TRANSCRIPT_DEFAULT
      const res = await circlebackRequest<CirclebackTranscriptSegment[]>(
        context.externalId,
        `/meeting/${encodeURIComponent(meetingId)}/transcript`
      )
      if (!res.ok) return { error: res.message }
      const segments = res.data.filter(
        (s) => fromSeconds === undefined || (s.timestamp ?? 0) >= fromSeconds
      )
      const text = formatCirclebackTranscript(segments, max)
      // The first segment the cut left out, to continue from.
      let chars = 0
      const next = segments.find((s) => {
        chars += (s.text?.length ?? 0) + 20
        return chars > max
      })
      return {
        id: meetingId,
        url: circlebackMeetingUrl(meetingId),
        transcript: text || "(no transcript)",
        ...(text.length >= max && typeof next?.timestamp === "number"
          ? {
              note: `Cut at ${max} characters; continue with fromSeconds ${Math.floor(next.timestamp)}`,
            }
          : {}),
      }
    },
  }),

  list_circleback_action_items: tool({
    description:
      "List action items from Circleback meetings, newest first, each with its owner, status and the meeting it came from. `owner` picks whose: the person whose key Lor uses (`me`), anyone in their Circleback workspace, people outside it, unassigned ones, or anyone.",
    inputSchema: z.object({
      owner: z
        .enum(["me", "workspace", "outside", "unassigned", "anyone"])
        .optional()
        .describe("whose action items; default anyone"),
      status: z
        .enum(["PENDING", "DONE"])
        .optional()
        .describe("open (PENDING) or done; default both"),
      cursor: z
        .string()
        .max(2048)
        .optional()
        .describe("the cursor from a previous call, for the next page"),
    }),
    contextSchema: circlebackContext,
    execute: async ({ owner, status, cursor }, { context }) => {
      const assigneeType = {
        me: "Me",
        workspace: "MyWorkspace",
        outside: "OutsideMyWorkspace",
        unassigned: "Unassigned",
        anyone: "Anyone",
      }[owner ?? "anyone"]
      const query = new URLSearchParams({ assigneeType })
      if (status) query.set("status", status)
      if (cursor) query.set("cursor", cursor)
      const res = await circlebackRequest<CirclebackActionItem[]>(
        context.externalId,
        `/action-items?${query}`
      )
      if (!res.ok) return { error: res.message }
      return {
        actionItems: res.data.slice(0, 50).map(actionItem),
        cursor: res.next,
      }
    },
  }),
}
