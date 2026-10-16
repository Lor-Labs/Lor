import { expo } from "@better-auth/expo"
import { redisStorage } from "@better-auth/redis-storage"
import { ensureCustomer, grantSignupPromo, syncSeats } from "@repo/billing"
import { and, db, eq, LOR_USER_ID, ne, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { pickWorkspaceAvatarColor } from "@repo/utils/avatar-colors"
import { escapeHtml } from "@repo/utils/html"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { betterAuth } from "better-auth/minimal"
import { admin, organization, twoFactor } from "better-auth/plugins"
import Redis from "ioredis"
import { Resend } from "resend"
import { invitationUrl, verifyInvitationSignature } from "./invitations"
import { logger } from "./logger"
import {
  ac,
  admin as adminRole,
  member as memberRole,
  owner as ownerRole,
} from "./permissions"
import { notifySignup } from "./signup-notifications"
import { seedWorkspaceTemplate } from "./workspace-template"

const redis = new Redis(env.REDIS_URL)
const resend = new Resend(env.RESEND_API_KEY)
// Email clients need an sRGB fallback for Lor's primary token:
// oklch(0.48 0.19 293) from packages/ui/src/styles/lor-tokens.css.
const EMAIL_PRIMARY_COLOR = "#663cbc"

async function nextWorkspaceAvatarColor(workspaceId: string, userId: string) {
  const memberships = await db
    .select({ avatarColor: schema.workspaceMember.avatarColor })
    .from(schema.workspaceMember)
    .where(
      and(
        eq(schema.workspaceMember.workspaceId, workspaceId),
        ne(schema.workspaceMember.userId, userId)
      )
    )

  return pickWorkspaceAvatarColor(
    memberships.map((membership) => membership.avatarColor),
    `${workspaceId}:${userId}`
  )
}

// Lor is a member of every workspace so it's mentionable and receives fanout.
async function addLorToWorkspace(workspaceId: string) {
  const avatarColor = await nextWorkspaceAvatarColor(workspaceId, LOR_USER_ID)
  await db.insert(schema.workspaceMember).values({
    workspaceId,
    userId: LOR_USER_ID,
    role: "member",
    avatarColor,
  })
}

// A minimal cold-start scaffold for Lor's brain so it has obvious places to
// file knowledge. Folders only; pages/structure still emerge from write-back.
const DEFAULT_BRAIN_FOLDERS = ["people", "projects", "decisions"]

async function seedBrainTaxonomy(workspaceId: string) {
  await db
    .insert(schema.brainNode)
    .values(
      DEFAULT_BRAIN_FOLDERS.map((name) => ({
        workspaceId,
        kind: "folder" as const,
        parentId: null,
        name,
      }))
    )
    .onConflictDoNothing()
}

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_API_URL,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: env.BETTER_AUTH_SECRET,
  secondaryStorage: redisStorage({ client: redis, keyPrefix: "lor:" }),
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "secondary-storage",
    customRules: {
      "/sign-in/*": { window: 10, max: 5 },
      "/sign-up/*": { window: 60, max: 5 },
      "/forgot-password/*": { window: 60, max: 3 },
      "/reset-password/*": { window: 60, max: 5 },
      "/two-factor/*": { window: 10, max: 3 },
      // Each invite sends an email to any address; keep Lor from being a
      // spam relay.
      "/organization/invite-member": { window: 60 * 60, max: 60 },
    },
  },
  user: {
    additionalFields: {
      // Unused since /onboarding replaced the modal; column drop is a later
      // cleanup (reference/onboarding.md, Step 10).
      onboardingCompleted: {
        type: "boolean",
        defaultValue: false,
        input: false,
        returned: true,
      },
      bio: {
        type: "string",
        returned: true,
        required: false,
      },
      status: {
        type: "string",
        returned: true,
        required: false,
      },
    },
  },
  trustedOrigins: [
    ...(env.NODE_ENV === "development"
      ? [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3001",
          "exp://",
        ]
      : []),
    "tauri://localhost",
    "lor://",
    "lor-dev://",
    ...env.TRUSTED_ORIGINS.split(",").filter(Boolean),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    async sendResetPassword({ user, url }) {
      resend.emails
        .send({
          from: env.EMAIL_FROM,
          to: user.email,
          subject: "Reset your Lor password",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
              <h2 style="margin: 0 0 8px; font-size: 24px; color: #1a1a1a;">Reset Your Password</h2>
              <p style="margin: 0 0 24px; color: #555; font-size: 16px; line-height: 1.5;">Click the button below to reset your password.</p>
              <a href="${url}" style="display: inline-block; background: ${EMAIL_PRIMARY_COLOR}; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Reset Password</a>
              <p style="color: #999; font-size: 13px; margin-top: 24px; line-height: 1.4;">If you didn't request a password reset, you can safely ignore this email.</p>
            </div>
          `,
        })
        .then(({ data, error }) => {
          if (error) {
            logger.error({ err: error }, "Failed to send reset password email")
          } else {
            logger.info({ emailId: data?.id }, "Reset password email sent")
          }
        })
    },
  },
  emailVerification: {
    sendOnSignIn: true,
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url, token }) {
      // Invite sign-ups start verified (databaseHooks below).
      if (user.emailVerified) return
      resend.emails
        .send({
          from: env.EMAIL_FROM,
          to: user.email,
          subject: "Verify your Lor email",
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
              <h2 style="margin: 0 0 8px; font-size: 24px; color: #1a1a1a;">Welcome to Lor</h2>
              <p style="margin: 0 0 24px; color: #555; font-size: 16px; line-height: 1.5;">Click the button below to verify your email address and get started.</p>
              <a href="${url}" style="display: inline-block; background: ${EMAIL_PRIMARY_COLOR}; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Verify Email</a>
              <p style="color: #999; font-size: 13px; margin-top: 24px; line-height: 1.4;">If you didn't create a Lor account, you can safely ignore this email.</p>
            </div>
          `,
        })
        .then(({ error }) => {
          if (error) {
            logger.error({ err: error }, "Failed to send verification email")
          }
        })
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return
      if (ctx.context.returned instanceof APIError) return
      // The endpoint has finished; notification failures cannot fail signup.
      void notifySignup(ctx.context.returned)
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // Signing up from a signed invite link proves the inbox, so the
        // account starts verified.
        before: async (user, ctx) => {
          if (ctx?.path !== "/sign-up/email") return
          const { invitationId, invitationSig } = ctx.body ?? {}
          if (
            typeof invitationId !== "string" ||
            typeof invitationSig !== "string" ||
            !verifyInvitationSignature(invitationId, invitationSig)
          ) {
            return
          }
          const invitation = await db
            .select({
              email: schema.invitation.email,
              status: schema.invitation.status,
              expiresAt: schema.invitation.expiresAt,
            })
            .from(schema.invitation)
            .where(eq(schema.invitation.id, invitationId))
            .limit(1)
            .then((rows) => rows[0])
          if (
            invitation?.status !== "pending" ||
            invitation.expiresAt <= new Date() ||
            invitation.email !== user.email
          ) {
            return
          }
          return { data: { ...user, emailVerified: true } }
        },
      },
    },
  },
  advanced: {
    cookiePrefix: "lor",
    database: {
      generateId: false,
    },
    useSecureCookies: env.NODE_ENV === "production",
    crossSubDomainCookies: {
      enabled: !!env.COOKIE_DOMAIN,
      domain: env.COOKIE_DOMAIN || undefined,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [
    organization({
      ac,
      // Workspaces are created only through POST /v1/workspaces, which mints
      // the URL key server-side (a system call, so this doesn't block it).
      allowUserToCreateOrganization: false,
      // better-auth rejects invite accepts past 100 members by default; link
      // and domain joins have no cap.
      membershipLimit: Number.MAX_SAFE_INTEGER,
      invitationExpiresIn: 7 * 24 * 60 * 60,
      requireEmailVerificationOnInvitation: true,
      async sendInvitationEmail({ id, email, organization, inviter }) {
        const workspaceName = escapeHtml(organization.name)
        const { error } = await resend.emails.send({
          from: env.EMAIL_FROM,
          to: email,
          subject: `${inviter.user.name} invited you to ${organization.name} on Lor`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 0;">
              <h2 style="margin: 0 0 8px; font-size: 24px; color: #1a1a1a;">Join ${workspaceName} on Lor</h2>
              <p style="margin: 0 0 24px; color: #555; font-size: 16px; line-height: 1.5;">${escapeHtml(inviter.user.name)} (${escapeHtml(inviter.user.email)}) invited you to the ${workspaceName} workspace on Lor.</p>
              <a href="${invitationUrl(id)}" style="display: inline-block; background: ${EMAIL_PRIMARY_COLOR}; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">Accept invite</a>
              <p style="color: #999; font-size: 13px; margin-top: 24px; line-height: 1.4;">This invite expires in 7 days. If you weren't expecting it, you can safely ignore this email.</p>
            </div>
          `,
        })
        if (error) {
          logger.error(
            { err: error, invitationId: id },
            "Failed to send invitation email"
          )
          // The invitation row exists; the inviter can resend it.
          throw new APIError("BAD_GATEWAY", {
            message: "Couldn't send the invite email",
          })
        }
      },
      roles: {
        owner: ownerRole,
        admin: adminRole,
        member: memberRole,
      },
      schema: {
        organization: {
          modelName: "workspace",
          additionalFields: {
            ownerId: {
              type: "string",
              fieldName: "ownerId",
              references: {
                field: "id",
                model: "user",
                onDelete: "restrict",
              },
              required: false,
              input: false,
              returned: true,
            },
            // Written only through /v1/workspaces routes (normalized there),
            // returned so organization.list() carries them to clients.
            description: {
              type: "string",
              required: false,
              input: false,
              returned: true,
            },
            website: {
              type: "string",
              required: false,
              input: false,
              returned: true,
            },
            joinDomain: {
              type: "string",
              required: false,
              input: false,
              returned: true,
            },
            setupCompletedAt: {
              type: "date",
              required: false,
              input: false,
              returned: true,
            },
          },
        },
        member: {
          modelName: "workspaceMember",
          fields: {
            organizationId: "workspaceId",
          },
          additionalFields: {
            avatarColor: {
              type: "string",
              fieldName: "avatarColor",
              required: true,
              input: false,
              returned: true,
            },
          },
        },
        invitation: {
          fields: {
            organizationId: "workspaceId",
          },
        },
        session: {
          fields: {
            activeOrganizationId: "activeWorkspaceId",
          },
        },
        organizationRole: {
          modelName: "workspaceRole",
          fields: {
            organizationId: "workspaceId",
          },
        },
      },
      organizationHooks: {
        beforeCreateOrganization: async ({ organization, user }) => {
          return { data: { ...organization, ownerId: user.id } }
        },
        beforeUpdateOrganization: async ({ organization, member }) => {
          if (organization.slug === undefined) return
          const current = await db
            .select({ slug: schema.workspace.slug })
            .from(schema.workspace)
            .where(eq(schema.workspace.id, member.organizationId))
            .limit(1)
            .then((rows) => rows[0])
          if (organization.slug !== current?.slug) {
            throw new APIError("BAD_REQUEST", {
              message: "Workspace keys cannot be changed",
            })
          }
        },
        beforeAddMember: async ({ member }) => {
          const avatarColor = await nextWorkspaceAvatarColor(
            member.organizationId,
            member.userId
          )
          return { data: { ...member, avatarColor } }
        },
        // Ownership lives in workspace.ownerId, so "owner" is never an
        // invitable role, and a member holds exactly one role.
        beforeCreateInvitation: async ({ invitation }) => {
          const roles = invitation.role.split(",")
          if (roles.length !== 1 || roles[0] === "owner") {
            throw new APIError("BAD_REQUEST", {
              message: "Invite with one role other than owner",
            })
          }
        },
        // Accept inserts the member with no duplicate check, so someone who
        // joined by link or domain first would hit the unique index.
        beforeAcceptInvitation: async ({ invitation, user }) => {
          const existing = await db
            .select({ id: schema.workspaceMember.id })
            .from(schema.workspaceMember)
            .where(
              and(
                eq(
                  schema.workspaceMember.workspaceId,
                  invitation.organizationId
                ),
                eq(schema.workspaceMember.userId, user.id)
              )
            )
            .limit(1)
          if (existing.length > 0) {
            throw new APIError("BAD_REQUEST", {
              message: "You're already a member of this workspace",
            })
          }
        },
        // Accept inserts the member directly, so beforeAddMember never runs.
        afterAcceptInvitation: async ({ member }) => {
          try {
            const avatarColor = await nextWorkspaceAvatarColor(
              member.organizationId,
              member.userId
            )
            await db
              .update(schema.workspaceMember)
              .set({ avatarColor })
              .where(eq(schema.workspaceMember.id, member.id))
          } catch (error) {
            logger.error(
              { err: error, workspaceId: member.organizationId },
              "Failed to set avatar color for invited member"
            )
          }
          void syncSeats(member.organizationId)
        },
        afterCreateOrganization: async ({ organization }) => {
          try {
            await seedWorkspaceTemplate(organization.id)
          } catch (error) {
            logger.error(
              { err: error, workspaceId: organization.id },
              "Failed to seed default channels for workspace"
            )
          }

          try {
            await addLorToWorkspace(organization.id)
          } catch (error) {
            logger.error(
              { err: error, workspaceId: organization.id },
              "Failed to add Lor to workspace"
            )
          }

          try {
            await seedBrainTaxonomy(organization.id)
          } catch (error) {
            logger.error(
              { err: error, workspaceId: organization.id },
              "Failed to seed brain taxonomy for workspace"
            )
          }

          // No-ops when billing is disabled; every later Autumn call also
          // falls back to get-or-create, so a failure here self-heals.
          await ensureCustomer(organization.id, organization.name)
          await grantSignupPromo(organization.id)
        },
      },
      dynamicAccessControl: {
        enabled: true,
        maximumRolesPerOrganization: 32,
      },
    }),
    admin(),
    twoFactor(),
    expo(),
  ],
})

export type Session = typeof auth.$Infer.Session
export type ActiveWorkspace = typeof auth.$Infer.ActiveOrganization
export type ActiveWorkspaceMember = ActiveWorkspace["members"][number]
