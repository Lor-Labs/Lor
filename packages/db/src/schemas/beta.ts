import { sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { workspace } from "./workspaces"

// Policy rows are append-only. Campaigns and trials retain their offer version.
export const betaPolicy = pgTable(
  "beta_policy",
  {
    version: text("version").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    cohortLimit: integer("cohort_limit").notNull(),
    memberLimit: integer("member_limit").notNull(),
    enrollmentDays: integer("enrollment_days").notNull(),
    trialDays: integer("trial_days").notNull(),
    retentionDays: integer("retention_days").notNull(),
    // One pooled grant: AI, sandbox and (when it ships) browser time draw
    // from the same credits.
    creditGrantMicroUsd: bigint("credit_grant_micro_usd", {
      mode: "number",
    }).notNull(),
    codeSandboxMemoryMb: integer("code_sandbox_memory_mb").notNull(),
  },
  (table) => [
    check(
      "beta_policy_limits_check",
      sql`${table.cohortLimit} > 0 AND ${table.memberLimit} > 0 AND ${table.enrollmentDays} > 0 AND ${table.trialDays} > 0 AND ${table.retentionDays} >= 0 AND ${table.codeSandboxMemoryMb} > 0`
    ),
    check(
      "beta_policy_grants_check",
      sql`${table.creditGrantMicroUsd} BETWEEN 0 AND 9007199254740991`
    ),
  ]
)

export const betaCampaign = pgTable(
  "beta_campaign",
  {
    key: text("key").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    policyVersion: text("policy_version")
      .notNull()
      .references(() => betaPolicy.version, { onDelete: "restrict" }),
    enrollmentStartsAt: timestamp("enrollment_starts_at", {
      withTimezone: true,
    }).notNull(),
    enrollmentEndsAt: timestamp("enrollment_ends_at", {
      withTimezone: true,
    }).notNull(),
    // Operator enrollment switch; never affects already-activated trials.
    paused: boolean("paused").default(true).notNull(),
    // Emergency stop (`pnpm beta halt`): no Lor-funded AI or sandbox use for
    // this campaign's trial teams until resumed. Subscribed and exempt
    // workspaces are unaffected.
    usageHaltedAt: timestamp("usage_halted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "beta_campaign_dates_check",
      sql`${table.enrollmentEndsAt} > ${table.enrollmentStartsAt}`
    ),
  ]
)

export const workspaceBetaTrial = pgTable(
  "workspace_beta_trial",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Keep the cohort place and audit history when a workspace is deleted.
    workspaceId: uuid("workspace_id").references(() => workspace.id, {
      onDelete: "set null",
    }),
    campaignKey: text("campaign_key")
      .notNull()
      .references(() => betaCampaign.key, { onDelete: "restrict" }),
    policyVersion: text("policy_version")
      .notNull()
      .references(() => betaPolicy.version, { onDelete: "restrict" }),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    readOnlyUntil: timestamp("read_only_until", {
      withTimezone: true,
    }).notNull(),
    memberLimit: integer("member_limit").notNull(),
    // Granted totals; Autumn owns the spendable credit balances.
    creditGrantMicroUsd: bigint("credit_grant_micro_usd", {
      mode: "number",
    }).notNull(),
    autumnGrantCreatedAt: timestamp("autumn_grant_created_at", {
      withTimezone: true,
    }),
    autumnGrantMicroUsd: bigint("autumn_grant_micro_usd", { mode: "number" }),
    autumnGrantExpiresAt: timestamp("autumn_grant_expires_at", {
      withTimezone: true,
    }),
    // Set while free + purchased credits are used up (synced from Autumn), so
    // sandbox access checks a column instead of calling Autumn.
    creditsEmptyAt: timestamp("credits_empty_at", { withTimezone: true }),
    // Set while the team holds an active seat subscription, synced from
    // Autumn. Subscribing ends beta mode: no beta limits apply.
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
    exhaustionEmailAttemptedAt: timestamp("exhaustion_email_attempted_at", {
      withTimezone: true,
    }),
    exhaustionEmailSentAt: timestamp("exhaustion_email_sent_at", {
      withTimezone: true,
    }),
    exhaustionEmail: jsonb("exhaustion_email").$type<{
      to: string
      name: string
      url: string
      expiresAt: string
    }>(),
  },
  (table) => [
    uniqueIndex("workspace_beta_trial_workspace_uidx").on(table.workspaceId),
    index("workspace_beta_trial_campaign_idx").on(table.campaignKey),
    index("workspace_beta_trial_expiry_idx").on(table.expiresAt),
    check(
      "workspace_beta_trial_dates_check",
      sql`${table.expiresAt} > ${table.activatedAt} AND ${table.readOnlyUntil} >= ${table.expiresAt}`
    ),
    check(
      "workspace_beta_trial_limits_check",
      sql`${table.memberLimit} > 0 AND ${table.creditGrantMicroUsd} BETWEEN 0 AND 9007199254740991`
    ),
  ]
)

export type BetaTrialTerms = {
  expiresAt: string
  readOnlyUntil: string
  memberLimit: number
  creditGrantMicroUsd: number
}

export type BetaTrialChanges = Partial<Omit<BetaTrialTerms, "readOnlyUntil">>

export const betaTrialAdjustment = pgTable(
  "beta_trial_adjustment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    trialId: uuid("trial_id")
      .notNull()
      .references(() => workspaceBetaTrial.id, { onDelete: "restrict" }),
    requestId: text("request_id").notNull(),
    operator: text("operator").notNull(),
    reason: text("reason").notNull(),
    changes: jsonb("changes").$type<BetaTrialChanges>().notNull(),
    before: jsonb("before").$type<BetaTrialTerms>().notNull(),
    after: jsonb("after").$type<BetaTrialTerms>().notNull(),
  },
  (table) => [
    uniqueIndex("beta_trial_adjustment_request_uidx").on(
      table.trialId,
      table.requestId
    ),
    check(
      "beta_trial_adjustment_audit_check",
      sql`length(trim(${table.requestId})) > 0 AND length(trim(${table.operator})) > 0 AND length(trim(${table.reason})) > 0`
    ),
  ]
)

// Internal workspaces (Lor's own team, demos) that keep normal access and
// billing when the hosted beta is on. Operator-set with `pnpm beta exempt`.
export const betaExemption = pgTable(
  "beta_exemption",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspace.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    operator: text("operator").notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [
    check(
      "beta_exemption_audit_check",
      sql`length(trim(${table.operator})) > 0 AND length(trim(${table.reason})) > 0`
    ),
  ]
)

export type BetaPolicy = typeof betaPolicy.$inferSelect
export type BetaCampaign = typeof betaCampaign.$inferSelect
export type WorkspaceBetaTrial = typeof workspaceBetaTrial.$inferSelect
