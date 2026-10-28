import { relations } from "drizzle-orm"
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { user } from "./users"

// One model a harness offered the person, as its SDK reports it (Claude
// Code's supportedModels) or the provider's models API lists it, with the
// effort levels and fast mode it takes.
export type ReportedHarnessModel = {
  value: string
  displayName: string
  resolvedModel?: string
  description?: string
  supportedEffortLevels: string[]
  supportsFastMode: boolean
  // The harness's own default model (Codex marks one).
  isDefault?: boolean
}

// A person's own account at a provider ("Your accounts" in user settings),
// never shared with the workspace: used only for turns the person starts and
// actions they take, like committing and pushing as themselves in a code
// session. Workspace-wide connections live in integration_connection.
export const personalAccountProviderEnum = pgEnum("personal_account_provider", [
  "github",
  // A Claude subscription for the person's own Claude Code turns: the token
  // `claude setup-token` prints (code-sessions-runbook.md chunk 7).
  "claude",
])

export const personalAccount = pgTable(
  "personal_account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: personalAccountProviderEnum("provider").notNull(),
    // The provider's user id (GitHub's numeric id). Claude: a fingerprint of
    // the token, which carries no account identity.
    externalId: text("external_id").notNull(),
    // Claude: the token's last four characters, to tell tokens apart.
    login: text("login").notNull(),
    name: text("name"),
    // The primary verified email, for commit authorship; null when the
    // provider didn't share it.
    email: text("email"),
    avatarUrl: text("avatar_url"),
    // Encrypted at rest (AES-256-GCM, INTEGRATION_ENCRYPTION_KEY). GitHub App
    // user tokens expire after 8 hours; the refresh token rotates on use.
    // Claude setup tokens last a year and have no refresh token.
    accessToken: text("access_token").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    // Claude: the models the person's Claude Code offered on their last turn
    // (their plan decides the list), for the composer's picker. Before a
    // first turn, a starting list from Anthropic's models API. Cleared when
    // another token is connected.
    models: jsonb("models").$type<ReportedHarnessModel[]>(),
  },
  (table) => [
    uniqueIndex("personal_account_user_provider_uidx").on(
      table.userId,
      table.provider
    ),
  ]
)

export const personalAccountRelations = relations(
  personalAccount,
  ({ one }) => ({
    user: one(user, {
      fields: [personalAccount.userId],
      references: [user.id],
    }),
  })
)

export type PersonalAccountProvider =
  (typeof personalAccountProviderEnum.enumValues)[number]
