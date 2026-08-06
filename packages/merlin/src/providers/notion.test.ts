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
      options: { auth?: string } | undefined
      constructor(options?: { auth?: string }) {
        this.options = options
      }
      oauth = { token: sdk.oauthToken }
      search = sdk.search
      users = { list: sdk.usersList, me: sdk.usersMe }
      comments = { list: sdk.commentsList }
    },
  }
})

// One active connection row + the update sets written against it, so the
// refresh flow's reads observe prior writes.
const dbState = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock("@repo/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(dbState.row ? [dbState.row] : []),
      }),
    }),
  })
  const update = () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => {
        dbState.updates.push(values)
        if (dbState.row) Object.assign(dbState.row, values)
        return Promise.resolve()
      },
    }),
  })
  const tx = { execute: () => Promise.resolve(), select, update }
  return {
    db: {
      select,
      update,
      transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
    and: () => undefined,
    eq: () => undefined,
    sql: () => undefined,
    schema: {
      integrationConnection: {
        id: "id",
        provider: "provider",
        externalId: "external_id",
        status: "status",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        tokenExpiresAt: "token_expires_at",
        scope: "scope",
      },
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

import { APIErrorCode, APIResponseError } from "@notionhq/client"
import {
  connectNotion,
  NOTION_REQUIRED_CAPABILITIES,
  notionCall,
} from "./notion"

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

const unauthorized = () =>
  new APIResponseError({
    code: APIErrorCode.Unauthorized,
    status: 401,
    message: "API token is invalid.",
    headers: {},
    rawBodyText: "",
    additional_data: undefined,
    request_id: undefined,
  })

describe("notionCall token refresh", () => {
  const externalId = "bot-id"

  const seedConnection = (overrides: Record<string, unknown> = {}) => {
    dbState.row = {
      id: "conn-1",
      accessToken: "encrypted:old-token",
      refreshToken: "encrypted:old-refresh",
      ...overrides,
    }
  }

  // The auth each operation attempt was issued with, in call order.
  const attempts: (string | undefined)[] = []
  const operation = (results: (unknown | Error)[]) =>
    vi.fn(async (client: unknown) => {
      attempts.push((client as { options?: { auth?: string } }).options?.auth)
      const next = results.shift()
      if (next instanceof Error) throw next
      return next
    })

  beforeEach(() => {
    vi.clearAllMocks()
    dbState.row = null
    dbState.updates.length = 0
    attempts.length = 0
  })

  it("rotates the token pair under the lock and retries once", async () => {
    seedConnection()
    sdk.oauthToken.mockResolvedValue({
      ...tokenResponse,
      access_token: "new-token",
      refresh_token: "new-refresh",
    })
    const op = operation([unauthorized(), { ok: true }])

    await expect(notionCall(externalId, op)).resolves.toEqual({ ok: true })

    expect(attempts).toEqual(["old-token", "new-token"])
    expect(sdk.oauthToken).toHaveBeenCalledTimes(1)
    expect(sdk.oauthToken).toHaveBeenCalledWith({
      grant_type: "refresh_token",
      refresh_token: "old-refresh",
      client_id: "client-id",
      client_secret: "client-secret",
    })
    expect(dbState.updates).toContainEqual({
      accessToken: "encrypted:new-token",
      refreshToken: "encrypted:new-refresh",
    })
  })

  it("reuses a token another caller already rotated without spending a refresh", async () => {
    seedConnection()
    const op = vi.fn(async (client: unknown) => {
      const auth = (client as { options?: { auth?: string } }).options?.auth
      attempts.push(auth)
      if (attempts.length === 1) {
        // Simulate a concurrent caller rotating the pair before this refresh
        // acquires the lock.
        seedConnection({ accessToken: "encrypted:rotated-elsewhere" })
        throw unauthorized()
      }
      return "second"
    })

    await expect(notionCall(externalId, op)).resolves.toBe("second")

    expect(attempts).toEqual(["old-token", "rotated-elsewhere"])
    expect(sdk.oauthToken).not.toHaveBeenCalled()
    expect(dbState.updates).toEqual([])
  })

  it("revokes the connection after a permanent refresh failure", async () => {
    seedConnection({ refreshToken: null })
    const op = operation([unauthorized()])

    await expect(notionCall(externalId, op)).resolves.toBeNull()

    expect(op).toHaveBeenCalledTimes(1)
    expect(dbState.updates).toContainEqual({
      status: "revoked",
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scope: null,
    })
  })

  it("preserves the stored refresh token when the response omits one", async () => {
    seedConnection()
    sdk.oauthToken.mockResolvedValue({
      ...tokenResponse,
      access_token: "new-token",
      refresh_token: null,
    })
    const op = operation([unauthorized(), "done"])

    await expect(notionCall(externalId, op)).resolves.toBe("done")

    expect(dbState.updates).toContainEqual({
      accessToken: "encrypted:new-token",
      refreshToken: "encrypted:old-refresh",
    })
  })
})
