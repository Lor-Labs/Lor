import { createRoute, z } from "@hono/zod-openapi"
import { and, asc, db, eq, inArray, schema } from "@repo/db"
import { workspaceInferenceKeyId } from "@repo/db/queries/inference"
import {
  getHarnessSettings,
  getPersonalHarnessSettings,
  harnessAccountOwner,
  orderHarnessAccounts,
} from "@repo/db/queries/personal-accounts"
import { keyFunding } from "@repo/lor/byok"
import { isLorCreditModel } from "@repo/lor/model-catalog"
import { assertHarnessEnabled } from "@repo/utils/features"
import { HTTPException } from "hono/http-exception"
import {
  connectHarnessAccount,
  disconnectHarnessAccount,
  replaceClaudeToken,
} from "@/lib/harness-accounts"
import { createRouter } from "@/lib/helpers/app/create-app"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  assertWorkspaceAuthority,
  hasWorkspaceAuthority,
} from "@/lib/permissions"
import { workspaceAuthMiddleware } from "@/middleware/workspace-auth"

const provider = z.enum(["claude", "chatgpt"])
const params = z.object({ workspaceSlug: z.string() })
// The agent whose own run settings are read or changed
// (reference/agents-and-chats.md): each agent has its own.
const agentQuery = z.object({ agentId: z.string().uuid().optional() })
// Postgres returns lowercase UUIDs; the saved order must match them.
const accountUuid = z.string().uuid().toLowerCase()
const preference = z.object({
  accountId: accountUuid.nullable(),
  accountOrder: z
    .array(accountUuid)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate accounts")
    .optional(),
  autoFallback: z.boolean(),
})
const personalSettings = z.object({
  defaultHarness: z.enum(["auto", "pi", "claude_code", "codex"]),
})
const settings = z.object({
  defaultHarness: z.enum(["pi", "claude_code", "codex"]),
  apiModel: z.string().min(1).max(200).nullable(),
  claudeApiBilling: z.enum(["lor", "byok"]),
  codexApiBilling: z.enum(["lor", "byok"]),
  claudeAccountId: z.string().uuid().nullable(),
  codexAccountId: z.string().uuid().nullable(),
  claudeUseSubscriptions: z.boolean(),
  codexUseSubscriptions: z.boolean(),
  claudeAutoFallback: z.boolean(),
  codexAutoFallback: z.boolean(),
})
const account = z.object({
  id: z.string(),
  provider,
  label: z.string().nullable(),
  login: z.string(),
  email: z.string().nullable(),
  plan: z.string().nullable(),
  unavailableUntil: z.string().nullable(),
  connectedAt: z.string(),
})
const response = z.object({
  canManage: z.boolean(),
  personal: z.array(account),
  personalSettings,
  accounts: z.array(account),
  preferences: z.object({ claude: preference, chatgpt: preference }),
  settings: settings.nullable(),
})
const ok = {
  200: jsonContent({
    schema: response,
    description: "AI account settings (no credentials)",
  }),
}
const common = {
  tags: ["AI Accounts"],
  middleware: [workspaceAuthMiddleware],
}
const path = "/workspaces/{workspaceSlug}/ai-accounts"

const list = createRoute({
  ...common,
  path,
  method: "get",
  request: { params, query: agentQuery },
  responses: ok,
})
const savePreference = createRoute({
  ...common,
  path: `${path}/preferences/{provider}`,
  method: "put",
  request: {
    params: params.extend({ provider }),
    body: {
      ...jsonContent({
        schema: preference,
        description: "Your default in this workspace",
      }),
      required: true,
    },
  },
  responses: ok,
})
const saveSettings = createRoute({
  ...common,
  path: `${path}/autonomous`,
  method: "put",
  request: {
    params,
    query: z.object({ agentId: z.string().uuid() }),
    body: {
      ...jsonContent({
        schema: settings.partial(),
        description: "Changed run settings of one agent",
      }),
      required: true,
    },
  },
  responses: ok,
})
const savePersonalSettings = createRoute({
  ...common,
  path: `${path}/personal-agent`,
  method: "put",
  request: {
    params,
    body: {
      ...jsonContent({
        schema: personalSettings,
        description: "Your agent for direct requests in this workspace",
      }),
      required: true,
    },
  },
  responses: ok,
})
const connect = createRoute({
  ...common,
  path: `${path}/accounts/{provider}`,
  method: "post",
  request: {
    params: params.extend({ provider }),
    body: {
      ...jsonContent({
        schema: z.object({
          credential: z.string().min(1).max(20_000),
          label: z.string().trim().min(1).max(80),
        }),
        description: "Connect a dedicated Lor account",
      }),
      required: true,
    },
  },
  responses: {
    200: jsonContent({
      schema: z.object({ success: z.literal(true) }),
      description: "Connected",
    }),
  },
})
const replaceClaude = createRoute({
  ...common,
  path: `${path}/accounts/claude/{accountId}`,
  method: "put",
  request: {
    params: params.extend({ accountId: z.string().uuid() }),
    body: {
      ...jsonContent({
        schema: z.object({ credential: z.string().min(1).max(2_000) }),
        description: "Replace a dedicated Claude account's token",
      }),
      required: true,
    },
  },
  responses: {
    200: jsonContent({
      schema: z.object({ success: z.literal(true) }),
      description: "Token replaced",
    }),
  },
})
const disconnect = createRoute({
  ...common,
  path: `${path}/accounts/{provider}/{accountId}`,
  method: "delete",
  request: {
    params: params.extend({ provider, accountId: z.string().uuid() }),
    query: agentQuery,
  },
  responses: ok,
})

// An agent of this workspace, or a 404: run settings are per agent.
async function assertAgent(workspaceId: string, agentId: string) {
  const [row] = await db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(
      and(
        eq(schema.agent.id, agentId),
        eq(schema.agent.workspaceId, workspaceId)
      )
    )
  if (!row) throw new HTTPException(404, { message: "Agent not found" })
}

async function snapshot(
  workspaceId: string,
  userId: string,
  canManage: boolean,
  // Whose run settings to include. The accounts are the workspace's.
  agentId?: string
) {
  if (agentId) await assertAgent(workspaceId, agentId)
  const [personal, accounts, preferences, saved, personalPolicy] =
    await Promise.all([
      db
        .select()
        .from(schema.personalAccount)
        .where(eq(schema.personalAccount.userId, userId))
        .orderBy(
          asc(schema.personalAccount.createdAt),
          asc(schema.personalAccount.id)
        ),
      canManage
        ? db
            .select()
            .from(schema.personalAccount)
            .where(eq(schema.personalAccount.workspaceId, workspaceId))
            .orderBy(
              asc(schema.personalAccount.createdAt),
              asc(schema.personalAccount.id)
            )
        : [],
      db
        .select()
        .from(schema.harnessAccountPreference)
        .where(
          and(
            eq(schema.harnessAccountPreference.workspaceId, workspaceId),
            eq(schema.harnessAccountPreference.userId, userId)
          )
        ),
      canManage && agentId ? getHarnessSettings({ agentId }) : null,
      getPersonalHarnessSettings(workspaceId, userId),
    ])
  const masked = (rows: typeof personal) =>
    rows.flatMap((row) =>
      row.provider === "github"
        ? []
        : [
            {
              id: row.id,
              provider: row.provider,
              label: row.label,
              login: row.login,
              email: row.email,
              plan: row.name,
              unavailableUntil: row.unavailableUntil?.toISOString() ?? null,
              connectedAt: row.createdAt.toISOString(),
            },
          ]
    )
  const pick = (p: "claude" | "chatgpt") => {
    const pref = preferences.find((row) => row.provider === p)
    return {
      accountId: pref?.accountId ?? null,
      accountOrder: orderHarnessAccounts(
        personal.filter((row) => row.provider === p),
        pref
      ).map((row) => row.id),
      autoFallback: pref?.autoFallback ?? true,
    }
  }
  return {
    canManage,
    personal: masked(personal),
    personalSettings: personalPolicy,
    accounts: masked(accounts),
    preferences: { claude: pick("claude"), chatgpt: pick("chatgpt") },
    settings: saved,
  }
}

async function assertAccount(
  workspaceId: string,
  userId: string | null,
  p: "claude" | "chatgpt",
  accountId: string | null
) {
  if (!accountId) return
  const [row] = await db
    .select({ id: schema.personalAccount.id })
    .from(schema.personalAccount)
    .where(
      and(
        harnessAccountOwner({ workspaceId, userId }),
        eq(schema.personalAccount.provider, p),
        eq(schema.personalAccount.id, accountId)
      )
    )
  if (!row)
    throw new HTTPException(400, {
      message:
        "Choose an account owned by this person or workspace and matching this provider.",
    })
}

const router = createRouter()
  .openapi(list, async (c) => {
    c.header("Cache-Control", "no-store")
    return c.json(
      await snapshot(
        c.var.workspace.id,
        c.var.user.id,
        hasWorkspaceAuthority(c.var.authority, { billing: ["manage"] }),
        c.req.valid("query").agentId
      ),
      200
    )
  })
  .openapi(savePersonalSettings, async (c) => {
    const values = c.req.valid("json")
    if (values.defaultHarness !== "auto")
      assertHarnessEnabled(values.defaultHarness)
    await db
      .insert(schema.personalHarnessSettings)
      .values({
        workspaceId: c.var.workspace.id,
        userId: c.var.user.id,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          schema.personalHarnessSettings.workspaceId,
          schema.personalHarnessSettings.userId,
        ],
        set: values,
      })
    return c.json(
      await snapshot(
        c.var.workspace.id,
        c.var.user.id,
        hasWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
      ),
      200
    )
  })
  .openapi(savePreference, async (c) => {
    const { provider } = c.req.valid("param")
    const input = c.req.valid("json")
    const values = {
      ...input,
      accountId: input.accountOrder
        ? (input.accountOrder[0] ?? null)
        : input.accountId,
    }
    await assertAccount(
      c.var.workspace.id,
      c.var.user.id,
      provider,
      values.accountId
    )
    if (values.accountOrder?.length) {
      const owned = await db
        .select({ id: schema.personalAccount.id })
        .from(schema.personalAccount)
        .where(
          and(
            eq(schema.personalAccount.userId, c.var.user.id),
            eq(schema.personalAccount.provider, provider),
            inArray(schema.personalAccount.id, values.accountOrder)
          )
        )
      if (owned.length !== values.accountOrder.length)
        throw new HTTPException(400, {
          message: "Only order your own accounts of this provider.",
        })
    }
    await db
      .insert(schema.harnessAccountPreference)
      .values({
        workspaceId: c.var.workspace.id,
        userId: c.var.user.id,
        provider,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          schema.harnessAccountPreference.workspaceId,
          schema.harnessAccountPreference.userId,
          schema.harnessAccountPreference.provider,
        ],
        set: values,
      })
    return c.json(
      await snapshot(
        c.var.workspace.id,
        c.var.user.id,
        hasWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
      ),
      200
    )
  })
  .openapi(saveSettings, async (c) => {
    assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
    // A patch of changed fields, so concurrent admin edits don't revert each other.
    const patch = c.req.valid("json")
    const { agentId } = c.req.valid("query")
    await assertAgent(c.var.workspace.id, agentId)
    const previous = await getHarnessSettings({ agentId })
    const values = { ...previous, ...patch }
    const activated = (harness: typeof values.defaultHarness) =>
      values.defaultHarness === harness && previous.defaultHarness !== harness
    const changed = (key: keyof typeof patch) =>
      key in patch && patch[key] !== previous[key]
    assertHarnessEnabled(values.defaultHarness)
    await assertAccount(
      c.var.workspace.id,
      null,
      "claude",
      values.claudeAccountId
    )
    await assertAccount(
      c.var.workspace.id,
      null,
      "chatgpt",
      values.codexAccountId
    )
    // A disconnect can null the account under enabled subscriptions (FK set
    // null), so only writes that touch the pair must leave it valid.
    if (
      (values.claudeUseSubscriptions &&
        !values.claudeAccountId &&
        (changed("claudeUseSubscriptions") || changed("claudeAccountId"))) ||
      (values.codexUseSubscriptions &&
        !values.codexAccountId &&
        (changed("codexUseSubscriptions") || changed("codexAccountId")))
    )
      throw new HTTPException(400, {
        message:
          "Choose one of the workspace's accounts before enabling subscription billing.",
      })
    // Check funding only when a choice changes or becomes active, so an admin
    // can still switch away from a route whose key was removed.
    if (
      values.apiModel &&
      (values.apiModel !== previous.apiModel || activated("pi")) &&
      !isLorCreditModel(values.apiModel) &&
      !(await keyFunding(c.var.workspace.id, values.apiModel))
    )
      throw new HTTPException(400, {
        message: "Choose an available API model and billing source.",
      })
    for (const [provider, harness, billing, subscription, was] of [
      [
        "anthropic",
        "claude_code",
        values.claudeApiBilling,
        values.claudeUseSubscriptions,
        [previous.claudeApiBilling, previous.claudeUseSubscriptions],
      ],
      [
        "openai",
        "codex",
        values.codexApiBilling,
        values.codexUseSubscriptions,
        [previous.codexApiBilling, previous.codexUseSubscriptions],
      ],
    ] as const) {
      if (
        !subscription &&
        billing === "byok" &&
        (billing !== was[0] || was[1] || activated(harness)) &&
        !(await workspaceInferenceKeyId(c.var.workspace.id, provider))
      )
        throw new HTTPException(400, {
          message: `Add your ${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key in Billing first.`,
        })
    }
    // The model is the agent's own column; the rest is its settings row.
    const { apiModel, ...row } = patch
    const { apiModel: _model, ...saved } = values
    await db.transaction(async (tx) => {
      if (apiModel !== undefined)
        await tx
          .update(schema.agent)
          .set({ model: apiModel })
          .where(eq(schema.agent.id, agentId))
      if (Object.keys(row).length)
        await tx
          .insert(schema.agentHarnessSettings)
          .values({ agentId, ...saved })
          .onConflictDoUpdate({
            target: schema.agentHarnessSettings.agentId,
            set: row,
          })
    })
    return c.json(
      await snapshot(c.var.workspace.id, c.var.user.id, true, agentId),
      200
    )
  })
  .openapi(connect, async (c) => {
    assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
    await connectHarnessAccount(
      { workspaceId: c.var.workspace.id, userId: null },
      c.req.valid("param").provider,
      c.req.valid("json")
    )
    return c.json({ success: true as const }, 200)
  })
  .openapi(replaceClaude, async (c) => {
    assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
    await replaceClaudeToken(
      { workspaceId: c.var.workspace.id, userId: null },
      c.req.valid("param").accountId,
      c.req.valid("json").credential
    )
    return c.json({ success: true as const }, 200)
  })
  .openapi(disconnect, async (c) => {
    assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
    const { provider, accountId } = c.req.valid("param")
    await disconnectHarnessAccount(
      { workspaceId: c.var.workspace.id, userId: null },
      provider,
      accountId
    )
    return c.json(
      await snapshot(
        c.var.workspace.id,
        c.var.user.id,
        true,
        c.req.valid("query").agentId
      ),
      200
    )
  })

export default router
