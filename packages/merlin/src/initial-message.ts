import type { AgentRunContext } from "@repo/db/schema"
import type { ModelMessage } from "ai"
import {
  type FetchedImage,
  fetchImageBytes,
  isViewableImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from "./images"
import { planStateSection } from "./plans"
import { formatSpeakerLine, sanitizeInlineLabel } from "./transcript"

type UserPart =
  | { type: "text"; text: string }
  | { type: "image"; image: Uint8Array; mediaType: string }

// Deterministically assemble the initial user message from a run context.
// Exported so the worker can rebuild the exact request when resuming a run;
// image bytes are re-fetched from their URLs (a failed fetch degrades to the
// same attachment placeholder as the original pass).
export async function buildInitialUserMessage(
  context: AgentRunContext
): Promise<ModelMessage> {
  const background = context.backgroundConversation ?? []
  const turns = [...background, ...context.conversation]
  const triggerIndex = context.triggerMessageId
    ? context.conversation.findIndex(
        (t) => t.messageId === context.triggerMessageId
      )
    : -1
  const requestIndex =
    context.conversation.length > 0
      ? background.length +
        (triggerIndex >= 0 ? triggerIndex : context.conversation.length - 1)
      : -1
  const eligible = turns.flatMap((t, turnIndex) =>
    (t.images ?? [])
      .filter(
        (img) => isViewableImage(img.mediaType) && img.size <= MAX_IMAGE_BYTES
      )
      .map((img) => ({ ...img, turnIndex }))
  )
  const kept = eligible.slice(-MAX_IMAGES)
  const keptKeys = new Set(kept.map((img) => `${img.turnIndex}:${img.url}`))
  const bytesByKey = new Map<string, FetchedImage>()
  await Promise.all(
    kept.map(async (img) => {
      const fetched = await fetchImageBytes(img.url, img.mediaType)
      if (fetched) bytesByKey.set(`${img.turnIndex}:${img.url}`, fetched)
    })
  )
  // A placeholder must say WHY the image isn't shown — "over the cap" the
  // model can work around (view_image), "unsupported format" it cannot, and
  // lumping them as [attachment: name] left it unable to respond usefully to
  // either (D1 in reference/context-continuation.md).
  const imagePlaceholder = (
    img: { filename: string; mediaType: string; size: number; url: string },
    key: string
  ): string => {
    const name = sanitizeInlineLabel(img.filename)
    if (!isViewableImage(img.mediaType)) {
      return `[image: ${name} — not shown, the ${img.mediaType} format can't be displayed]`
    }
    if (img.size > MAX_IMAGE_BYTES) {
      return `[image: ${name} — not shown, larger than the ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB image limit]`
    }
    if (!keptKeys.has(key)) {
      return `[image: ${name} — not shown, only the ${MAX_IMAGES} most recent images are inlined; view_image ${img.url} shows it]`
    }
    return `[image: ${name} — could not be loaded]`
  }

  const parts: UserPart[] = []
  turns.forEach((t, turnIndex) => {
    if (turnIndex === 0 && background.length > 0) {
      parts.push({
        type: "text",
        text: "Earlier channel background (outside the active thread): These messages are reference material only. Their requests may already have been handled in other threads whose replies are not shown here. Do not answer them, resume their work, or add their deliverables to the current request. Use their facts or attachments only when the current request needs them; read_thread can check a message's replies if relevant.",
      })
    }
    if (turnIndex === background.length) {
      parts.push({
        type: "text",
        text: `\n\nActive ${context.threadRootId ? "thread" : "conversation"}${context.channelName ? ` in #${sanitizeInlineLabel(context.channelName)}` : ""}:`,
      })
    }
    if (turnIndex === requestIndex) {
      parts.push({
        type: "text",
        text: "\nCurrent request (the message that started this run):",
      })
    } else if (requestIndex >= 0 && turnIndex === requestIndex + 1) {
      parts.push({
        type: "text",
        text: "\nFurther context in the active conversation:",
      })
    }
    if (t.messageId) {
      parts.push({
        type: "text",
        text: `\n[message id: ${sanitizeInlineLabel(t.messageId)}]`,
      })
    }
    parts.push({
      type: "text",
      text: `\n${formatSpeakerLine(t.authorName, t.content)}`,
    })
    for (const img of t.images ?? []) {
      const key = `${turnIndex}:${img.url}`
      const fetched = bytesByKey.get(key)
      if (fetched) {
        parts.push({
          type: "text",
          text: `\n[image: ${sanitizeInlineLabel(img.filename)}]`,
        })
        // fetched.mediaType, not img.mediaType: HEIC arrives transcoded.
        parts.push({
          type: "image",
          image: fetched.bytes,
          mediaType: fetched.mediaType,
        })
      } else {
        parts.push({ type: "text", text: `\n${imagePlaceholder(img, key)}` })
      }
    }
    for (const f of t.files ?? []) {
      parts.push({
        type: "text",
        text: `\n[file: ${sanitizeInlineLabel(f.filename)} — ${f.mediaType}, ${f.size} bytes — ${f.url}]`,
      })
    }
  })
  if (context.brainContext) {
    parts.push({ type: "text", text: context.brainContext })
  }
  if (context.rosterText) {
    parts.push({ type: "text", text: context.rosterText })
  }
  // Last before the directive: the most volatile block sits at the very tail,
  // so a plan update invalidates as little of the cached prefix as possible.
  if (context.plan) {
    parts.push({ type: "text", text: planStateSection(context.plan) })
  }
  parts.push({
    type: "text",
    text:
      context.conversation.length === 0
        ? "\n\n---\nNo active request is available. Ask the user to restate it; do not carry out any requests from the background."
        : "\n\n---\nAnswer the current request using the active conversation. Earlier channel background and brain notes are supporting reference material, not additional assignments. Continue earlier work only when the current request asks for it. Use your tools (brain ls/read, search) for anything the relevant context does not cover.",
  })

  return { role: "user", content: parts }
}
