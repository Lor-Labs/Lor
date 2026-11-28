import { experimental_decide as decide } from "ai"
import { aiRuntimeContext, aiTelemetry } from "./ai-observability"
import { logger } from "./logger"
import { LOR_INBOX_CLASSIFIER_MODEL, lorInboxClassifierModel } from "./models"

// Is a chat message that names no agent still meant for one of the chat's
// agents? (LOR-171). A person reading a chat knows at once from what came
// before, what they are working on, their role and who is talking; Jev
// (TypeSafe's decision model on the AI Gateway) answers the same question
// per agent, so the agent is woken now and not at its 15-minute check-in.
// A wrong yes costs one quiet turn: the agent reads the message and may say
// nothing. A wrong no leaves the message for the check-in, as before.

const TIMEOUT_MS = 5_000
// Bootstrap value, sampled 2026-11-25 on a few chats (see
// reference/agents-and-chats.md): not calibrated on real traffic.
export const INBOX_ADDRESSED_MIN = 0.5
const RECENT_CHARS = 400
const BRIEF_CHARS = 400

export type InboxAddressInput = {
  chatName: string
  // Earlier messages in the chat, oldest first.
  recent: { author: string; isAgent: boolean; text: string }[]
  message: { author: string; isAgent: boolean; text: string }
  agents: {
    id: string
    name: string
    role: string | null
    // What the team told it to look after.
    brief: string | null
    // What it has open in this chat (its running sessions).
    working: string[]
  }[]
}

export type InboxAddressDecision = {
  // The agents the message reads as meant for.
  agentIds: string[]
  scores: Record<string, number>
  model: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  wallMs: number
  // Jev answered: the request cost money.
  responded: boolean
  error: string | null
}

const short = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

const who = (line: { author: string; isAgent: boolean }) =>
  `[${line.author}${line.isAgent ? ", an AI agent" : ""}]`

function state(input: InboxAddressInput) {
  const agents = input.agents
    .map((agent) => {
      const parts = [
        `- ${agent.name}${agent.role ? `, the team's ${agent.role} agent` : ""}.`,
        agent.brief ? `Looks after: ${short(agent.brief, BRIEF_CHARS)}` : null,
        agent.working.length > 0
          ? `Working on now: ${agent.working.join("; ")}.`
          : null,
      ]
      return parts.filter(Boolean).join(" ")
    })
    .join("\n")
  const recent =
    input.recent.length > 0
      ? `Earlier in the chat:\n${input.recent
          .map((line) => `${who(line)} ${short(line.text, RECENT_CHARS)}`)
          .join("\n")}\n\n`
      : ""
  return `"${input.chatName}" is a team group chat with people and AI agents in it. An agent that is named with @ is woken at once. This message names no agent.\n\nThe agents in the chat:\n${agents}\n\n${recent}Latest message, from ${who(input.message)}:\n${short(input.message.text, 2000)}`
}

// One Jev call for a message, a question per agent. Fails open to "nobody":
// the message then waits for each agent's check-in, as it always did.
export async function decideInboxAddress(
  input: InboxAddressInput
): Promise<InboxAddressDecision> {
  const start = performance.now()
  const keys = new Map(input.agents.map((agent, i) => [`agent${i}`, agent]))
  const questions = Object.fromEntries(
    [...keys].map(([key, agent]) => [
      key,
      {
        type: "boolean" as const,
        instructions: `Is the latest message meant for ${agent.name} to answer or act on now? Yes when it asks for something in ${agent.name}'s role or work, continues an exchange ${agent.name} is part of, or answers a question ${agent.name} asked. No when it is people talking to each other, is for someone else, only mentions ${agent.name} or its work in passing, is an update that needs no answer, or closes an exchange (thanks, ok).`,
      },
    ])
  )
  let response:
    | Awaited<ReturnType<typeof lorInboxClassifierModel.doDecide>>
    | undefined
  const scores: Record<string, number> = {}
  let error: string | null = null
  try {
    const result = await decide({
      // Usage is read before the SDK throws on a refusal or a malformed
      // answer: those requests cost money too.
      model: {
        specificationVersion: lorInboxClassifierModel.specificationVersion,
        provider: lorInboxClassifierModel.provider,
        modelId: lorInboxClassifierModel.modelId,
        supportedQuestionTypes: lorInboxClassifierModel.supportedQuestionTypes,
        doDecide: async (options) => {
          response = await lorInboxClassifierModel.doDecide(options)
          return response
        },
      },
      questions,
      state: state(input),
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      runtimeContext: aiRuntimeContext(),
      telemetry: aiTelemetry("inbox.address"),
    })
    for (const [key, agent] of keys) {
      const answer = result.answers[key]
      if (answer?.type === "boolean") scores[agent.id] = answer.probability
    }
  } catch (err) {
    error = err instanceof Error ? err.name : "ClassifierError"
    logger.warn({ error }, "Inbox address classifier failed; message waits")
  }
  const rawCost = response?.providerMetadata?.gateway?.cost
  const cost = rawCost == null ? Number.NaN : Number(rawCost)
  return {
    agentIds: Object.entries(scores)
      .filter(([, score]) => score >= INBOX_ADDRESSED_MIN)
      .map(([id]) => id),
    scores,
    model: response?.response?.modelId ?? LOR_INBOX_CLASSIFIER_MODEL,
    inputTokens: response?.usage?.inputTokens,
    outputTokens: response?.usage?.outputTokens,
    costUsd: Number.isFinite(cost) && cost >= 0 ? cost : undefined,
    wallMs: Math.round(performance.now() - start),
    responded: response !== undefined,
    error,
  }
}
