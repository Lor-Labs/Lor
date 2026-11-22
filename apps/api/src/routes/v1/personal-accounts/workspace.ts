import { createRoute, z } from "@hono/zod-openapi"
import { and, asc, db, eq, schema } from "@repo/db"
import { workspaceInferenceKeyId } from "@repo/db/queries/inference"
import {
  getWorkspaceHarnessSettings,
  harnessAccountOwner,
} from "@repo/db/queries/personal-accounts"
import { keyFunding } from "@repo/lor/byok"
import { isLorCreditModel } from "@repo/lor/model-catalog"
import { assertHarnessEnabled } from "@repo/utils/features"
import { HTTPException } from "hono/http-exception"
import {
  connectHarnessAccount,
  disconnectHarnessAccount,
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
const preference = z.object({
  accountId: z.string().uuid().nullable(),
  autoFallback: z.boolean(),
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
  request: { params },
  responses: ok,
})
const savePreference = createRoute({
  ...common,
  path: `${path}/preferences/{provider}`,
  method: "put",
  request: {
    params: params.extend({ provider }),
    body: jsonContent({
      schema: preference,
      description: "Your default in this workspace",
    }),
  },
  responses: ok,
})
const saveSettings = createRoute({
  ...common,
  path: `${path}/autonomous`,
  method: "put",
  request: {
    params,
    body: jsonContent({
      schema: settings,
      description: "Autonomous run settings",
    }),
  },
  responses: ok,
})
const connect = createRoute({
  ...common,
  path: `${path}/accounts/{provider}`,
  method: "post",
  request: {
    params: params.extend({ provider }),
    body: jsonContent({
      schema: z.object({
        credential: z.string().min(1).max(20_000),
        label: z.string().trim().min(1).max(80),
      }),
      description: "Connect a dedicated Lor account",
    }),
  },
  responses: ok,
})
const disconnect = createRoute({
  ...common,
  path: `${path}/accounts/{provider}/{accountId}`,
  method: "delete",
  request: {
    params: params.extend({ provider, accountId: z.string().uuid() }),
  },
  responses: ok,
})

async function snapshot(
  workspaceId: string,
  userId: string,
  canManage: boolean
) {
  const [personal, accounts, preferences, saved] = await Promise.all([
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
    canManage ? getWorkspaceHarnessSettings(workspaceId) : null,
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
      autoFallback: pref?.autoFallback ?? true,
    }
  }
  return {
    canManage,
    personal: masked(personal),
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
        hasWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
      ),
      200
    )
  })
  .openapi(savePreference, async (c) => {
    const { provider } = c.req.valid("param")
    const values = c.req.valid("json")
    await assertAccount(
      c.var.workspace.id,
      c.var.user.id,
      provider,
      values.accountId
    )
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
    const values = c.req.valid("json")
    const previous = await getWorkspaceHarnessSettings(c.var.workspace.id)
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
    if (
      (values.claudeUseSubscriptions &&
        !values.claudeAccountId &&
        !previous.claudeUseSubscriptions) ||
      (values.codexUseSubscriptions &&
        !values.codexAccountId &&
        !previous.codexUseSubscriptions)
    )
      throw new HTTPException(400, {
        message:
          "Choose a dedicated Lor account before enabling subscription billing.",
      })
    if (
      values.apiModel &&
      !isLorCreditModel(values.apiModel) &&
      !(await keyFunding(c.var.workspace.id, values.apiModel))
    )
      throw new HTTPException(400, {
        message: "Choose an available API model and billing source.",
      })
    for (const [provider, billing, subscription] of [
      ["anthropic", values.claudeApiBilling, values.claudeUseSubscriptions],
      ["openai", values.codexApiBilling, values.codexUseSubscriptions],
    ] as const) {
      if (
        !subscription &&
        billing === "byok" &&
        !(await workspaceInferenceKeyId(c.var.workspace.id, provider))
      )
        throw new HTTPException(400, {
          message: `Add your ${provider === "anthropic" ? "Anthropic" : "OpenAI"} API key in Billing first.`,
        })
    }
    await db
      .insert(schema.workspaceHarnessSettings)
      .values({ workspaceId: c.var.workspace.id, ...values })
      .onConflictDoUpdate({
        target: schema.workspaceHarnessSettings.workspaceId,
        set: values,
      })
    return c.json(await snapshot(c.var.workspace.id, c.var.user.id, true), 200)
  })
  .openapi(connect, async (c) => {
    assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
    await connectHarnessAccount(
      { workspaceId: c.var.workspace.id, userId: null },
      c.req.valid("param").provider,
      c.req.valid("json")
    )
    return c.json(await snapshot(c.var.workspace.id, c.var.user.id, true), 200)
  })
  .openapi(disconnect, async (c) => {
    assertWorkspaceAuthority(c.var.authority, { billing: ["manage"] })
    const { provider, accountId } = c.req.valid("param")
    await disconnectHarnessAccount(
      { workspaceId: c.var.workspace.id, userId: null },
      provider,
      accountId
    )
    return c.json(await snapshot(c.var.workspace.id, c.var.user.id, true), 200)
  })

export default router
