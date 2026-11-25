import { z } from "@hono/zod-openapi"

export const chatWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
    example: "my-workspace",
  }),
})

export const chatParamsSchema = chatWorkspaceParamsSchema.extend({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
      example: "00000000-0000-0000-0000-000000000000",
    }),
})

const chatPersonSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  image: z.string().nullable(),
  avatarColor: z.string().nullable(),
})

// A chat in a person's list: the channel, who is in it, its last message
// and what is theirs about it (reference/agents-and-chats.md, decisions 33,
// 35 and 36).
export const chatSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  // Private: only its members can see it.
  private: z.boolean(),
  createdAt: z.string().datetime(),
  // The agents in it, in the order they were added.
  agentIds: z.array(z.string().uuid()),
  // The first few people in it, the caller last, and how many in all.
  people: z.array(chatPersonSchema),
  peopleCount: z.number().int(),
  pinnedAt: z.string().datetime().nullable(),
  lastMessage: z
    .object({
      id: z.string().uuid(),
      createdAt: z.string().datetime(),
      // Plain text: mentions as names, no markdown.
      preview: z.string(),
      authorId: z.string().uuid(),
      authorName: z.string(),
      // The agent that wrote it, when one did.
      agentId: z.string().uuid().nullable(),
    })
    .nullable(),
})

export const listChatsResponseSchema = z.object({
  chats: z.array(chatSchema),
})

export const updateChatRequestSchema = z
  .object({
    pinned: z.boolean().optional(),
    // Hidden for the caller only; a new message brings the chat back.
    hidden: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.pinned !== undefined || value.hidden !== undefined, {
    message: "Nothing to change",
  })

export const updateChatResponseSchema = z.object({
  success: z.literal(true),
  pinnedAt: z.string().datetime().nullable(),
  hiddenAt: z.string().datetime().nullable(),
})
