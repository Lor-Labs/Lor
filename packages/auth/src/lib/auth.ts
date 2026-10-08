import { expo } from "@better-auth/expo"
import { redisStorage } from "@better-auth/redis-storage"
import { ensureCustomer } from "@repo/billing"
import { db, eq, LOR_USER_ID, schema } from "@repo/db"
import { env } from "@repo/env/server"
import { pickWorkspaceAvatarColor } from "@repo/utils/avatar-colors"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { betterAuth } from "better-auth/minimal"
import { admin, organization, twoFactor } from "better-auth/plugins"
import Redis from "ioredis"
import { Resend } from "resend"
import { logger } from "./logger"
import {
  ac,
  admin as adminRole,
  member as memberRole,
  owner as ownerRole,
} from "./permissions"

const redis = new Redis(env.REDIS_URL)
const resend = new Resend(env.RESEND_API_KEY)
// Email clients need an sRGB fallback for Lor's primary token:
// oklch(0.48 0.19 293) from packages/ui/src/styles/lor-tokens.css.
const EMAIL_PRIMARY_COLOR = "#663cbc"

const defaultWorkspaceChannels = {
  uncategorized: [
    { name: "general", type: "text" as const },
    { name: "introductions", type: "text" as const },
    { name: "rules", type: "text" as const },
  ],
  categories: [
    {
      name: "Community",
      channels: [
        { name: "help", type: "text" as const },
        { name: "off-topic", type: "text" as const },
      ],
    },
  ],
}

async function seedDefaultWorkspaceChannels(workspaceId: string) {
  await db.transaction(async (tx) => {
    let topLevelPosition = 0

    const uncategorizedRows = defaultWorkspaceChannels.uncategorized.map(
      (ch, index) => ({
        name: ch.name,
        type: ch.type,
        workspaceId,
        position: topLevelPosition + index,
      })
    )

    if (uncategorizedRows.length > 0) {
      await tx.insert(schema.channel).values(uncategorizedRows)
    }
    topLevelPosition += uncategorizedRows.length

    for (const categoryConfig of defaultWorkspaceChannels.categories) {
      const createdCategory = await tx
        .insert(schema.channel)
        .values({
          name: categoryConfig.name,
          type: "category",
          workspaceId,
          position: topLevelPosition++,
        })
        .returning({ id: schema.channel.id })
        .then((rows) => rows[0])

      if (!createdCategory) continue

      const childRows = categoryConfig.channels.map((ch, channelIndex) => ({
        name: ch.name,
        type: ch.type,
        workspaceId,
        parentId: createdCategory.id,
        position: channelIndex,
      }))

      if (childRows.length > 0) {
        await tx.insert(schema.channel).values(childRows)
      }
    }
  })
}

async function nextWorkspaceAvatarColor(workspaceId: string, userId: string) {
  const memberships = await db
    .select({ avatarColor: schema.workspaceMember.avatarColor })
    .from(schema.workspaceMember)
    .where(eq(schema.workspaceMember.workspaceId, workspaceId))

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
    },
  },
  user: {
    additionalFields: {
      onboardingCompleted: {
        type: "boolean",
        defaultValue: false,
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
        beforeUpdateOrganization: async ({ organization }) => {
          if (organization.slug !== undefined) {
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
        afterCreateOrganization: async ({ organization, user }) => {
          try {
            await seedDefaultWorkspaceChannels(organization.id)
          } catch (error) {
            logger.error(
              { err: error, workspaceId: organization.id },
              "Failed to seed default channels for workspace"
            )
            return
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

          try {
            await db
              .update(schema.user)
              .set({ onboardingCompleted: true })
              .where(eq(schema.user.id, user.id))
          } catch (error) {
            logger.error(
              { err: error, userId: user.id },
              "Failed to mark onboarding as completed"
            )
          }

          // No-ops when billing is disabled; every later Autumn call also
          // falls back to get-or-create, so a failure here self-heals.
          await ensureCustomer(organization.id, organization.name)
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
