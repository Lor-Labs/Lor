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
  // Archived for everyone (decision 52); set only in the archived list.
  archivedAt: z.string().datetime().nullable(),
  // Whether the caller is in it; an archived chat they can see may not be.
  joined: z.boolean(),
  // A Slack or Discord channel agents are in (decision 51), only in the
  // places list: where it is, to open it there.
  place: z
    .object({ source: z.enum(["discord", "slack"]), url: z.string() })
    .nullable(),
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

export const listChatsQuerySchema = z.object({
  // The archived chats the caller can see, in place of their list: what the
  // sidebar adds when it shows archived chats.
  archived: z
    .enum(["true", "false"])
    .optional()
    .openapi({ param: { name: "archived", in: "query" } }),
  // The places (Slack and Discord channels agents are in) the caller can
  // see, in place of their list.
  places: z
    .enum(["true", "false"])
    .optional()
    .openapi({ param: { name: "places", in: "query" } }),
})

export const listChatsResponseSchema = z.object({
  chats: z.array(chatSchema),
})

// What a chat's agents said to each other (decision 39), oldest first.
export const listAgentMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string().uuid(),
      fromAgentId: z.string().uuid(),
      // The agents it names; none and not `toEveryone` is a post to the room.
      toAgentIds: z.array(z.string().uuid()),
      toEveryone: z.boolean(),
      // The post it answers, when it is an answer.
      replyToId: z.string().uuid().nullable(),
      content: z.string(),
      createdAt: z.string().datetime(),
    })
  ),
})

// Everyone in a chat (reference/agents-and-chats.md, decision 35).
export const listChatPeopleResponseSchema = z.object({
  people: z.array(chatPersonSchema),
})

export const addChatPeopleRequestSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
})

export const chatPersonParamsSchema = chatParamsSchema.extend({
  userId: z
    .string()
    .uuid()
    .openapi({ param: { name: "userId", in: "path", required: true } }),
})

export const chatPeopleChangedResponseSchema = z.object({
  success: z.literal(true),
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
