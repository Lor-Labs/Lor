import { generateText, tool } from "ai"
import { z } from "zod"
import { lorGatewayModel } from "../../models"
import type { Check } from "./tasks"

// Grades rubric items and plays the simulated teammate. Kept outside the
// candidate pool so no model grades its own work.
export const JUDGE_MODEL =
  process.env.EVAL_JUDGE_MODEL ?? "anthropic/claude-sonnet-5.5"

async function submit<T>(schema: z.ZodType<T>, prompt: string): Promise<T> {
  const result = await generateText({
    model: lorGatewayModel(JUDGE_MODEL),
    prompt: `${prompt}\n\nCall submit exactly once.`,
    tools: {
      submit: tool({ description: "Submit your answer.", inputSchema: schema }),
    },
    toolChoice: { type: "tool", toolName: "submit" },
  })
  const call = result.toolCalls.find((c) => c.toolName === "submit")
  if (!call) throw new Error("judge did not submit")
  return schema.parse(call.input)
}

const verdictSchema = z.object({
  verdicts: z.array(
    z.object({
      criterion: z.number().int(),
      pass: z.boolean(),
      reason: z.string(),
    })
  ),
})

export async function judge(
  criteria: string[],
  material: string
): Promise<Check[]> {
  const { verdicts } = await submit(
    verdictSchema,
    `You grade work an AI agent did in a team workspace. Be strict: a criterion passes only if the material clearly satisfies it.\n\nCriteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nMaterial:\n${material || "(empty)"}`
  )
  return criteria.map((label, i) => {
    const v = verdicts.find((x) => x.criterion === i + 1)
    return {
      label: `judge: ${label}`,
      pass: v?.pass ?? false,
      ...(v ? { reason: v.reason } : {}),
    }
  })
}

export type SimulatedUser = {
  persona: string
  facts: string[]
  maxTurns: number
}

// τ²-style user: answers only what was asked, from facts only it holds.
export async function nextUserTurn(
  user: SimulatedUser,
  transcript: { author: string; text: string }[]
): Promise<string | null> {
  const { reply } = await submit(
    z.object({ reply: z.string() }),
    `You play ${user.persona} in a team chat, talking to Lor, the team's AI agent. Facts only you know:\n${user.facts.map((f) => `- ${f}`).join("\n")}\n\nAnswer only what Lor asked, in one or two short sentences, using only these facts. If Lor asked about something the facts don't cover, say you don't know. If Lor asked nothing or the task looks done, reply exactly DONE.\n\nConversation so far:\n${transcript.map((t) => `${t.author}: ${t.text}`).join("\n\n")}`
  )
  const text = reply.trim()
  return text === "DONE" ? null : text
}
