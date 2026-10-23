import type { ModelMessage } from "ai"
import { logger } from "./logger"

// Write-back re-reads the turn (its prompt, Lor's tool calls and the answer)
// to decide what to remember. A turn over the budget is sent as one shortened
// plain-text transcript instead: tool results clipped, the middle cut, so the
// request and the answer survive. Tokens are UTF-8 bytes over 3, a
// deliberately high estimate.
const BYTES_PER_TOKEN = 3
const ATTACHMENT_TOKENS = 1_500
const TOOL_RESULT_CHARS = 4_000

type Part = Record<string, unknown>

function partsOf(message: ModelMessage): Part[] {
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : (message.content as Part[])
}

const tokensOf = (text: string) =>
  Math.ceil(Buffer.byteLength(text, "utf8") / BYTES_PER_TOKEN)

function estimateTokens(messages: ModelMessage[]): number {
  return messages
    .flatMap(partsOf)
    .reduce(
      (sum, part) =>
        sum +
        (part.type === "image" || part.type === "file"
          ? ATTACHMENT_TOKENS
          : tokensOf(JSON.stringify(part) ?? "")),
      0
    )
}

const clip = (text: string, cap: number) =>
  text.length > cap ? `${text.slice(0, cap)}…[clipped]` : text

function render(message: ModelMessage): string {
  const body = partsOf(message)
    .map((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        return part.text
      }
      if (part.type === "image" || part.type === "file") return "[attachment]"
      if (part.type === "tool-call") {
        return `→ ${String(part.toolName)}(${JSON.stringify(part.input ?? {})})`
      }
      if (part.type === "tool-result") {
        const output = JSON.stringify(part.output ?? null) ?? ""
        return `← ${String(part.toolName)}: ${clip(output, TOOL_RESULT_CHARS)}`
      }
      return ""
    })
    .filter(Boolean)
    .join("\n")
  return body ? `[${message.role}]\n${body}` : ""
}

// Keeps both ends of `text` within `cap` characters.
function excerpt(text: string, cap: number): string {
  if (text.length <= cap) return text
  const half = Math.floor((cap - 50) / 2)
  return `${text.slice(0, half)}\n[…middle of the turn left out…]\n${text.slice(-half)}`
}

export function fitTurnForWriteBack(
  messages: ModelMessage[],
  maxTokens: number
): ModelMessage[] {
  const before = estimateTokens(messages)
  if (before <= maxTokens) return messages
  const transcript = messages.map(render).filter(Boolean).join("\n\n")
  let cap = maxTokens * BYTES_PER_TOKEN
  let body = excerpt(transcript, cap)
  // Multi-byte text weighs more than one byte per character.
  while (tokensOf(body) > maxTokens && cap > 1_000) {
    cap = Math.floor(cap / 2)
    body = excerpt(transcript, cap)
  }
  logger.warn(
    { beforeTokens: before, afterTokens: tokensOf(body), maxTokens },
    "Write-back turn shortened to fit its budget"
  )
  return [
    {
      role: "user",
      content: `[This turn was too long to re-read in full. Below is a shortened transcript: the request first, Lor's answer last, tool results clipped.]\n\n${body}`,
    },
  ]
}
