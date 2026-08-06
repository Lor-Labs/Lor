import { beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
  oauthToken: vi.fn(),
  search: vi.fn(),
  usersList: vi.fn(),
  usersMe: vi.fn(),
  commentsList: vi.fn(),
}))

vi.mock("@notionhq/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@notionhq/client")>()
  return {
    ...actual,
    Client: class {
      oauth = { token: sdk.oauthToken }
      search = sdk.search
      users = { list: sdk.usersList, me: sdk.usersMe }
      comments = { list: sdk.commentsList }
    },
  }
})

vi.mock("@repo/env/server", () => ({
  env: {
    NOTION_CLIENT_ID: "client-id",
    NOTION_CLIENT_SECRET: "client-secret",
    INTEGRATION_ENCRYPTION_KEY: "0".repeat(64),
  },
}))

vi.mock("@repo/utils/crypto", () => ({
  encryptSecret: (value: string) => `encrypted:${value}`,
  decryptSecret: (value: string) => value.replace(/^encrypted:/, ""),
}))

vi.mock("../logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

import { connectNotion, NOTION_REQUIRED_CAPABILITIES } from "./notion"

const tokenResponse = {
  access_token: "access-token",
  token_type: "bearer" as const,
  refresh_token: "refresh-token",
  bot_id: "bot-id",
  workspace_id: "workspace-id",
  workspace_name: "Acme",
  workspace_icon: null,
  owner: { type: "workspace" as const, workspace: true as const },
  duplicated_template_id: null,
}

describe("Notion OAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdk.oauthToken.mockResolvedValue(tokenResponse)
    sdk.search.mockResolvedValue({
      results: [{ object: "page", id: "page-id" }],
    })
    sdk.commentsList.mockResolvedValue({ results: [] })
    sdk.usersList.mockResolvedValue({
      results: [
        {
          id: "user-id",
          type: "person",
          person: {},
        },
      ],
    })
  })

  it("stores bot and workspace ids with an encrypted rotating token pair", async () => {
    const result = await connectNotion(
      "authorization-code",
      "https://app.lor.chat/integrations/notion/callback"
    )

    expect(result).toEqual({
      externalId: "bot-id",
      providerWorkspaceId: "workspace-id",
      accountLabel: "Acme",
      accessToken: "encrypted:access-token",
      refreshToken: "encrypted:refresh-token",
      scope: "read_content read_comments read_user_without_email",
    })
    expect(sdk.oauthToken).toHaveBeenCalledWith({
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: "https://app.lor.chat/integrations/notion/callback",
      client_id: "client-id",
      client_secret: "client-secret",
    })
  })

  it("rejects an authorization that exposes user email addresses", async () => {
    sdk.usersList.mockResolvedValue({
      results: [
        {
          id: "user-id",
          type: "person",
          person: { email: "ada@example.com" },
        },
      ],
    })

    await expect(
      connectNotion("authorization-code", "https://example.com/callback")
    ).resolves.toBeNull()
  })

  it("rejects an authorization without read-comments capability", async () => {
    sdk.commentsList.mockRejectedValue(new Error("restricted resource"))

    await expect(
      connectNotion("authorization-code", "https://example.com/callback")
    ).resolves.toBeNull()
  })

  it("declares only the three required read capabilities", () => {
    expect(NOTION_REQUIRED_CAPABILITIES).toEqual([
      "Read content",
      "Read comments",
      "User information without email addresses",
    ])
  })
})
