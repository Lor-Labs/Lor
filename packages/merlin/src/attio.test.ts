import { beforeEach, describe, expect, it, vi } from "vitest"
import { attioTools } from "./attio"
import { attioRequest } from "./providers/attio"

vi.mock("./providers/attio", () => ({ attioRequest: vi.fn() }))

const context = {
  toolCallId: "test-call",
  messages: [],
  context: { externalId: "attio-workspace" },
}

describe("Attio tools", () => {
  beforeEach(() => {
    vi.mocked(attioRequest).mockReset()
  })

  it("treats malformed search and query data as empty results", async () => {
    vi.mocked(attioRequest).mockResolvedValue({ data: {} })

    const search = await attioTools.search_attio.execute?.(
      { query: "Acme", objects: ["companies"] },
      context
    )
    const query = await attioTools.query_attio.execute?.(
      { mode: "records", target: "companies" },
      context
    )

    expect(search).toEqual({ results: [] })
    expect(query).toEqual({ mode: "records", target: "companies", results: [] })
  })

  it("reports catalog section failures without hiding successful sections", async () => {
    vi.mocked(attioRequest).mockImplementation((_externalId, path) => {
      if (path === "/objects")
        return Promise.resolve({ data: [{ api_slug: "people" }] })
      if (path === "/workspace_members") return Promise.resolve({ data: [] })
      return Promise.resolve(null)
    })

    const result = await attioTools.query_attio.execute?.(
      { mode: "catalog" },
      context
    )

    expect(result).toEqual({
      objects: [{ api_slug: "people" }],
      lists: { error: "Attio lists request failed" },
      workspaceMembers: [],
    })
  })

  it("caps transcripts across recordings and stops scheduling more work", async () => {
    const meetingIds = [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]
    const recordingIds = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000004",
    ]

    vi.mocked(attioRequest).mockImplementation((_externalId, path) => {
      if (path.startsWith("/meetings?") && !path.includes("call_recordings")) {
        return Promise.resolve({
          data: meetingIds.map((meeting_id) => ({ id: { meeting_id } })),
        })
      }
      const meetingIndex = meetingIds.findIndex((id) =>
        path.endsWith(`/meetings/${id}/call_recordings`)
      )
      if (meetingIndex >= 0) {
        return Promise.resolve({
          data: recordingIds
            .slice(meetingIndex * 2, meetingIndex * 2 + 2)
            .map((call_recording_id) => ({ id: { call_recording_id } })),
        })
      }
      if (path.includes("/transcript")) {
        return Promise.resolve({
          data: { raw_transcript: "x".repeat(12_000) },
          pagination: { next_cursor: null },
        })
      }
      return Promise.resolve({ data: [] })
    })

    const result = await attioTools.fetch_attio_activity.execute?.(
      {
        object: "companies",
        recordId: "20000000-0000-4000-8000-000000000001",
        includeTranscripts: true,
      },
      context
    )
    if (
      !result ||
      typeof result !== "object" ||
      Symbol.asyncIterator in result
    ) {
      throw new Error("Expected an Attio activity result")
    }
    const transcripts = (
      result as { transcripts: Array<{ rawTranscript: string | null }> }
    ).transcripts
    const transcriptPaths = vi
      .mocked(attioRequest)
      .mock.calls.map((call) => call[1])
      .filter((path) => path.includes("/transcript"))

    expect(
      transcripts.filter((transcript) => transcript.rawTranscript !== null)
    ).toHaveLength(2)
    expect(transcriptPaths).toHaveLength(3)
    expect(
      transcriptPaths.some((path) => path.includes(recordingIds[3] ?? ""))
    ).toBe(false)
  })
})
