import type { Embed } from "@repo/db/schema"

const GITHUB_BRAND = "#24292f"
const LINEAR_BRAND = "#5e6ad2"

function clipBody(body?: string | null): string | undefined {
  const normalized = body?.trim()
  if (!normalized) return undefined
  return normalized.length > 1400
    ? `${normalized.slice(0, 1400).trimEnd()}…`
    : normalized
}

export function githubNotificationEmbed(input: {
  event: string
  title: string
  url: string
  repository: string
  reference?: string
  body?: string | null
  actor?: {
    name: string
    url?: string | null
    avatarUrl?: string | null
  } | null
}): Embed {
  const description = clipBody(input.body)
  return {
    type: "rich",
    url: input.url,
    eventLabel: input.event,
    ...(input.actor
      ? {
          author: {
            name: input.actor.name,
            ...(input.actor.url ? { url: input.actor.url } : {}),
            ...(input.actor.avatarUrl
              ? { iconUrl: input.actor.avatarUrl }
              : {}),
          },
        }
      : {}),
    title: `${input.repository}${
      input.reference ? `#${input.reference}` : ""
    } · ${input.title}`,
    ...(description ? { description } : {}),
    siteName: "GitHub",
    color: GITHUB_BRAND,
  }
}

export function linearNotificationEmbed(input: {
  event: string
  title: string
  url?: string | null
  identifier?: string | null
  body?: string | null
  actor?: {
    name: string
    url?: string | null
    avatarUrl?: string | null
  } | null
}): Embed {
  const description = clipBody(input.body)
  return {
    type: "rich",
    ...(input.url ? { url: input.url } : {}),
    ...(input.actor
      ? {
          author: {
            name: input.actor.name,
            ...(input.actor.url ? { url: input.actor.url } : {}),
            ...(input.actor.avatarUrl
              ? { iconUrl: input.actor.avatarUrl }
              : {}),
          },
        }
      : {}),
    eventLabel: input.event,
    title: `${input.identifier ? `${input.identifier} · ` : ""}${input.title}`,
    ...(description ? { description } : {}),
    siteName: "Linear",
    color: LINEAR_BRAND,
  }
}
