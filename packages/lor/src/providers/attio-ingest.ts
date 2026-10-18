import { attioSearchResult } from "../attio"
import {
  attioIngestRead,
  formatAttioTranscript,
  parseAttioCallRecording,
} from "./attio"
import type { SourceFetch, SourceFetcher } from "./types"

// Attio notes and call recordings, as text for `source`. A ref is the stored
// key. reference/planned/context-engine-phase-2.md.

const NOTE_PREFIX = "note#"
const RECORDING_PREFIX = "call_recording#"

export const attioNoteKey = (noteId: string) => `${NOTE_PREFIX}${noteId}`
export const attioRecordingKey = (meetingId: string, recordingId: string) =>
  `${RECORDING_PREFIX}${meetingId}/${recordingId}`

// Below storeSourceItem's body cap, leaving room for the metadata line.
const TRANSCRIPT_MAX = 190_000

const str = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null
const enc = encodeURIComponent

type AttioNote = {
  title?: unknown
  content_markdown?: unknown
  content_plaintext?: unknown
  parent_object?: unknown
  parent_record_id?: unknown
  created_at?: unknown
}

async function parentRecord(
  externalId: string,
  object: string | null,
  recordId: string | null
) {
  if (!(object && recordId)) return null
  const res = await attioIngestRead<{ data?: unknown }>(
    externalId,
    `/objects/${enc(object)}/records/${enc(recordId)}`
  )
  if (res === "missing" || !res.data) return null
  const record = attioSearchResult(res.data)
  return { title: record.title, url: record.url }
}

async function fetchNote(
  externalId: string,
  key: string
): Promise<SourceFetch> {
  const noteId = key.slice(NOTE_PREFIX.length)
  if (!(key.startsWith(NOTE_PREFIX) && noteId)) return { item: null, gone: [] }
  const res = await attioIngestRead<{ data?: AttioNote }>(
    externalId,
    `/notes/${enc(noteId)}`
  )
  if (res === "missing") return { item: null, gone: [key] }
  const note = res.data
  if (!note) throw new Error("Attio note response had no data")

  const record = await parentRecord(
    externalId,
    str(note.parent_object),
    str(note.parent_record_id)
  )
  const createdAt = str(note.created_at)
  const meta = [
    "Attio note",
    record ? `on ${record.title}` : null,
    createdAt ? `written ${createdAt.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return {
    item: {
      kind: "note",
      externalId: key,
      url: record?.url ?? null,
      title: str(note.title) ?? "Untitled note",
      author: null,
      state: null,
      body: [
        meta,
        str(note.content_markdown) ??
          str(note.content_plaintext) ??
          "(empty note)",
      ].join("\n\n"),
      sourceCreatedAt: createdAt ? new Date(createdAt) : null,
      // Notes carry no update time; every fetch is current.
      sourceUpdatedAt: null,
    },
    gone: [],
  }
}

async function fetchCallRecording(
  externalId: string,
  key: string
): Promise<SourceFetch> {
  const [meetingId, recordingId] = key.startsWith(RECORDING_PREFIX)
    ? key.slice(RECORDING_PREFIX.length).split("/")
    : []
  if (!(meetingId && recordingId)) return { item: null, gone: [] }
  const res = await attioIngestRead<{ data?: unknown }>(
    externalId,
    `/meetings/${enc(meetingId)}/call_recordings/${enc(recordingId)}`
  )
  if (res === "missing") return { item: null, gone: [key] }
  const recording = parseAttioCallRecording(res.data)
  if (!recording) throw new Error("Attio call recording response had no data")
  if (recording.status === "failed") return { item: null, gone: [key] }
  // Not transcribed yet: the job's retry backoff is the wait.
  if (recording.status !== "completed" || !recording.segments?.length) {
    throw new Error("Attio call recording is not transcribed yet")
  }

  const meeting = await attioIngestRead<{ data?: { title?: unknown } }>(
    externalId,
    `/meetings/${enc(meetingId)}`
  )
  const title =
    (meeting !== "missing" && str(meeting.data?.title)) || "Call recording"
  const minutes = Math.max(
    1,
    Math.round((recording.segments.at(-1)?.endTime ?? 0) / 60)
  )
  const speakers = [
    ...new Set(recording.segments.map((s) => s.speaker)),
  ].filter((name) => name && name !== "Unknown")
  const meta = [
    `Call recording · ${minutes} min`,
    speakers.length > 0 ? `speakers: ${speakers.join(", ")}` : null,
    recording.createdAt ? `recorded ${recording.createdAt.slice(0, 10)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return {
    item: {
      kind: "call_recording",
      externalId: key,
      url: recording.webUrl,
      title,
      author: null,
      state: null,
      body: [
        meta,
        formatAttioTranscript(recording.segments, TRANSCRIPT_MAX),
      ].join("\n\n"),
      sourceCreatedAt: recording.createdAt
        ? new Date(recording.createdAt)
        : null,
      sourceUpdatedAt: null,
    },
    gone: [],
  }
}

export const fetchAttioSourceItem: SourceFetcher = (connection, kind, ref) => {
  if (kind === "note") return fetchNote(connection.externalId, ref)
  if (kind === "call_recording") {
    return fetchCallRecording(connection.externalId, ref)
  }
  return Promise.resolve({ item: null, gone: [] })
}
