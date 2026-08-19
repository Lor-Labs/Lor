import type { ConnectorKey, Message } from "@/lib/api-types"
import { connectorAccentColor } from "@/lib/connector-ui"

type Embed = Message["embeds"][number]

const LEGACY_NOTIFICATION =
  /^\*\*([^*]+)\*\*\s+\[([^\]]+)]\((https?:\/\/[^)]+)\)([\s\S]*)$/

function githubEventLabel(event: string): string {
  if (event.startsWith("Draft PR")) return "Draft pull request opened"
  if (event === "PR opened") return "Pull request opened"
  if (event === "PR merged") return "Pull request merged"
  return event
}

function legacyGithubEmbed(content: string): Embed | null {
  const match = LEGACY_NOTIFICATION.exec(content)
  if (!match) return null
  const [
    ,
    rawEvent = "GitHub activity",
    linkedLabel = "",
    url = "",
    tail = "",
  ] = match
  const event = githubEventLabel(rawEvent)
  const actorMatch = /\s+—\s+by\s+(.+)$/.exec(tail)
  const actor = actorMatch?.[1]?.trim()
  const isGithubLogin = Boolean(actor && /^[A-Za-z0-9-]{1,39}$/.test(actor))
  const detail = (actorMatch ? tail.slice(0, actorMatch.index) : tail).trim()

  if (event === "Release published") {
    const repository = detail.replace(/^—\s*/, "")
    return {
      type: "rich",
      url,
      eventLabel: event,
      title: `${repository} · ${linkedLabel}`,
      siteName: "GitHub",
      color: "#24292f",
    }
  }

  const hashIndex = linkedLabel.lastIndexOf("#")
  if (hashIndex < 1) return null
  const repository = linkedLabel.slice(0, hashIndex)
  const reference = linkedLabel.slice(hashIndex + 1)
  return {
    type: "rich",
    url,
    ...(actor
      ? {
          author: {
            name: actor,
            ...(isGithubLogin
              ? {
                  url: `https://github.com/${actor}`,
                  iconUrl: `https://github.com/${actor}.png?size=40`,
                }
              : {}),
          },
        }
      : {}),
    eventLabel: event,
    title: `${repository}#${reference}${detail ? ` · ${detail}` : ""}`,
    siteName: "GitHub",
    color: "#24292f",
  }
}

function legacyLinearEmbed(content: string): Embed | null {
  const match = LEGACY_NOTIFICATION.exec(content)
  if (!match) return null
  const [, event = "Linear activity", linkedLabel = "", url = ""] = match
  const issueMatch = /^([A-Z][A-Z0-9]+-\d+)\s+([\s\S]+)$/.exec(linkedLabel)
  if (!issueMatch) return null
  const [, identifier = "", title = linkedLabel] = issueMatch
  return {
    type: "rich",
    url,
    eventLabel: event,
    title: `${identifier} · ${title}`,
    siteName: "Linear",
    color: "#5e6ad2",
  }
}

export function connectorMessageEmbed(
  connector: ConnectorKey,
  content: string,
  displayName: string
): Embed {
  const parsed =
    connector === "github"
      ? legacyGithubEmbed(content)
      : connector === "linear"
        ? legacyLinearEmbed(content)
        : null
  return (
    parsed ?? {
      type: "rich",
      description: content,
      siteName: displayName,
      color: connectorAccentColor(connector),
    }
  )
}
