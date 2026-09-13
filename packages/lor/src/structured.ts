import { generateText, tool } from "ai"
import type { z } from "zod"
import { lorSmallModel, smallGatewayOptions } from "./models"

/**
 * Ask the small model for schema-validated data without relying on a provider's
 * native JSON response-format implementation. Tool calling is supported by the
 * open-model routes we use and gives the SDK a portable validation boundary.
 */
export async function generateSmallObject<T>({
  schema,
  prompt,
  abortSignal,
}: {
  schema: z.ZodType<T>
  prompt: string
  abortSignal?: AbortSignal
}) {
  const result = await generateText({
    model: lorSmallModel,
    reasoning: "low",
    prompt: `${prompt}\n\nCall submit_result exactly once with your answer. Do not answer in prose.`,
    tools: {
      submit_result: tool({
        description: "Submit the final structured answer.",
        inputSchema: schema,
        strict: true,
      }),
    },
    toolChoice: { type: "tool", toolName: "submit_result" },
    providerOptions: {
      gateway: smallGatewayOptions,
    },
    abortSignal,
  })

  const submission = result.toolCalls.find(
    (call) => call.toolName === "submit_result"
  )
  if (!submission) {
    throw new Error("Small model did not submit a structured result")
  }

  return {
    object: schema.parse(submission.input),
    usage: result.usage,
    response: result.response,
  }
}
