// Linear's "Copy as prompt" puts the issue after its prompt line as:
//   <issue identifier="LOR-119">
//   <title>…</title>
//   <description>…</description>
//   <team name="Lor"/>
//   <project name="MVP">…</project>
//   </issue>
// Messages store the block as pasted (Lor reads all of it); the composer and
// message views show it as a Linear issue card.
const ISSUE_BLOCK_SOURCE =
  /<issue identifier="([A-Za-z0-9]+-\d+)">[\s\S]*?<\/issue>/.source

export type LinearIssueBlock = {
  identifier: string
  title: string
  description: string
  team: string | null
  project: string | null
  raw: string
}

export type LinearIssuePart =
  | { kind: "text"; text: string }
  | { kind: "issue"; issue: LinearIssueBlock }

function tagText(raw: string, tag: string): string {
  return (
    raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? ""
  )
}

function tagName(raw: string, tag: string): string | null {
  return raw.match(new RegExp(`<${tag} name="([^"]*)"`))?.[1]?.trim() || null
}

// <linear-image quality="preview">{"type":"image","attrs":{"src":…,"title":
// "Screenshot ….png",…}}</linear-image>. The src is a signed upload link that
// expires within a day, so the card names the image instead of loading it.
function imageName(json: string): string {
  try {
    const title = JSON.parse(json)?.attrs?.title
    return typeof title === "string" && title.trim()
      ? `*Image: ${title.trim()}*`
      : "*(image)*"
  } catch {
    return "*(image)*"
  }
}

export function parseLinearIssue(raw: string): LinearIssueBlock | null {
  const identifier = raw.match(new RegExp(`^${ISSUE_BLOCK_SOURCE}$`))?.[1]
  if (!identifier) return null
  return {
    identifier,
    title: tagText(raw, "title"),
    description: tagText(raw, "description").replace(
      /<linear-image\b[^>]*>([\s\S]*?)<\/linear-image>/g,
      (_match, json: string) => imageName(json)
    ),
    team: tagName(raw, "team"),
    project: tagName(raw, "project"),
    raw,
  }
}

export function hasLinearIssue(text: string): boolean {
  return new RegExp(ISSUE_BLOCK_SOURCE).test(text)
}

// The text around each issue block, and the blocks, in order.
export function splitLinearIssues(text: string): LinearIssuePart[] {
  const parts: LinearIssuePart[] = []
  let last = 0
  for (const match of text.matchAll(new RegExp(ISSUE_BLOCK_SOURCE, "g"))) {
    const issue = parseLinearIssue(match[0])
    if (!issue) continue
    if (match.index > last) {
      parts.push({ kind: "text", text: text.slice(last, match.index) })
    }
    parts.push({ kind: "issue", issue })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) })
  return parts
}

// One line for previews and search: "LOR-119 Make copy and paste UI better".
export function linearIssuesToText(text: string): string {
  return text.replace(new RegExp(ISSUE_BLOCK_SOURCE, "g"), (raw) => {
    const issue = parseLinearIssue(raw)
    return issue ? `${issue.identifier} ${issue.title}`.trim() : raw
  })
}
