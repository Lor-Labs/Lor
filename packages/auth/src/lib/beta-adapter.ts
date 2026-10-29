import {
  assertBetaMemberCapacity,
  BetaAdmissionError,
  createWithBetaTrial,
  hostedBetaConfig,
} from "@repo/billing/beta"
import { db, eq, schema } from "@repo/db"
import { pickWorkspaceAvatarColor } from "@repo/utils/avatar-colors"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"

function organizationId(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("id" in result) ||
    typeof result.id !== "string"
  )
    throw new Error("Organization insert did not return its id")
  return result.id
}

const config = { provider: "pg", schema } as const

// Auth hooks run outside transactions; enforce admission at the actual insert.
export const betaAdapter: ReturnType<typeof drizzleAdapter> = (options) => {
  const adapter = drizzleAdapter(db, config)(options)
  const create: typeof adapter.create = async <
    T extends Record<string, unknown>,
    R = T,
  >(input: {
    model: string
    data: Omit<T, "id">
    select?: string[]
    forceAllowId?: boolean
  }): Promise<R> => {
    if (!hostedBetaConfig().enabled) return adapter.create<T, R>(input)
    try {
      if (input.model === "organization") {
        return await createWithBetaTrial(async (tx) => {
          const result = await drizzleAdapter(
            tx,
            config
          )(options).create<T, R>(input)
          const id = organizationId(result)
          const ownerId = input.data.ownerId
          if (typeof ownerId !== "string")
            throw new Error("Organization owner is missing")
          await tx.insert(schema.workspaceMember).values({
            workspaceId: id,
            userId: ownerId,
            role: "owner",
            avatarColor: pickWorkspaceAvatarColor([], `${id}:${ownerId}`),
          })
          return result
        }, organizationId)
      }
      if (input.model === "member") {
        const { organizationId, userId } = input.data
        if (typeof organizationId !== "string" || typeof userId !== "string")
          throw new Error("Missing membership identity")
        return await db.transaction(async (tx) => {
          await assertBetaMemberCapacity(tx, organizationId, userId)
          const txAdapter = drizzleAdapter(tx, config)(options)
          // The owner membership was committed with the workspace and trial.
          if (input.data.role === "owner") {
            const workspace = await tx
              .select({ ownerId: schema.workspace.ownerId })
              .from(schema.workspace)
              .where(eq(schema.workspace.id, organizationId))
              .then((rows) => rows[0])
            if (workspace?.ownerId === userId) {
              const existing = await txAdapter.findOne<R>({
                model: "member",
                where: [
                  { field: "organizationId", value: organizationId },
                  { field: "userId", value: userId },
                ],
              })
              if (existing) return existing
            }
          }
          return txAdapter.create<T, R>(input)
        })
      }
      return adapter.create<T, R>(input)
    } catch (error) {
      if (error instanceof BetaAdmissionError)
        throw new APIError("FORBIDDEN", { message: error.message })
      throw error
    }
  }
  return { ...adapter, create }
}
