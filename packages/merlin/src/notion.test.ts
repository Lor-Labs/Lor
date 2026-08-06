import { beforeEach, describe, expect, it, vi } from "vitest"
import { notionTools } from "./notion"
import { notionCall } from "./providers/notion"

vi.mock("./providers/notion", () => ({ notionCall: vi.fn() }))

const context = {
  toolCallId: "test-call",
  messages: [],
  context: { externalId: "notion-bot" },
}

const title = (plainText: string) => ({
  Name: {
    type: "title",
    title: [{ plain_text: plainText }],
  },
})

describe("Notion tools", () => {
  beforeEach(() => {
    vi.mocked(notionCall).mockReset()
  })

  it("maps title search results into usable page references", async () => {
    vi.mocked(notionCall).mockResolvedValue({
      results: [
        {
          id: "page-1",
          object: "page",
          url: "https://www.notion.so/page-1",
          last_edited_time: "2026-08-05T00:00:00.000Z",
          properties: title("Product roadmap"),
        },
      ],
    })

    const result = await notionTools.search_notion.execute?.(
      { query: "roadmap", kind: "all", limit: 10 },
      context
    )

    expect(result).toEqual({
      results: [
        {
          id: "page-1",
          kind: "page",
          title: "Product roadmap",
          url: "https://www.notion.so/page-1",
          lastEditedTime: "2026-08-05T00:00:00.000Z",
          parent: null,
        },
      ],
    })
  })

  it("returns page Markdown while surfacing an independent comments failure", async () => {
    vi.mocked(notionCall)
      .mockResolvedValueOnce({
        id: "page-1",
        object: "page",
        url: "https://www.notion.so/page-1",
        properties: title("Launch notes"),
      })
      .mockResolvedValueOnce({
        markdown: "# Launch notes\n\nDecision details",
        truncated: false,
      })
      .mockResolvedValueOnce(null)

    const result = await notionTools.fetch_notion_page.execute?.(
      { pageId: "page-1", includeTranscript: false },
      context
    )

    expect(result).toMatchObject({
      id: "page-1",
      title: "Launch notes",
      markdown: "# Launch notes\n\nDecision details",
      markdownTruncated: false,
      comments: { error: "Notion comments request failed" },
    })
  })

  it("returns data-source schema and compact row references", async () => {
    vi.mocked(notionCall)
      .mockResolvedValueOnce({
        id: "source-1",
        object: "data_source",
        url: "https://www.notion.so/source-1",
        title: [{ plain_text: "Projects" }],
        properties: { Status: { type: "status" } },
      })
      .mockResolvedValueOnce({
        results: [
          {
            id: "row-1",
            object: "page",
            url: "https://www.notion.so/row-1",
            properties: title("Website launch"),
          },
        ],
        has_more: false,
      })

    const result = await notionTools.query_notion_data_source.execute?.(
      { dataSourceId: "source-1", limit: 20 },
      context
    )

    expect(result).toMatchObject({
      dataSource: { id: "source-1", title: "Projects" },
      results: [{ id: "row-1", title: "Website launch" }],
      hasMore: false,
    })
  })

  it("never returns user email addresses", async () => {
    vi.mocked(notionCall).mockResolvedValue({
      results: [
        {
          id: "user-1",
          name: "Ada Lovelace",
          type: "person",
          avatar_url: "https://example.com/ada.png",
          person: { email: "ada@example.com" },
        },
      ],
    })

    const result = await notionTools.list_notion_users.execute?.(
      { query: "Ada", limit: 50 },
      context
    )

    expect(result).toEqual({
      users: [
        {
          id: "user-1",
          name: "Ada Lovelace",
          type: "person",
          avatarUrl: "https://example.com/ada.png",
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain("ada@example.com")
  })
})
