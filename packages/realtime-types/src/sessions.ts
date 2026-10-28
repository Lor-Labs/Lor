import type { UncommittedLines } from "./events"
import { MARKDOWN_USER_MENTION_REGEX, USER_MENTION_REGEX } from "./mentions"

// A session row's sidebar +/−; null until first counted.
export function uncommittedLinesOf(row: {
  uncommittedAdditions: number | null
  uncommittedDeletions: number | null
}): UncommittedLines | null {
  return row.uncommittedAdditions === null || row.uncommittedDeletions === null
    ? null
    : {
        additions: row.uncommittedAdditions,
        deletions: row.uncommittedDeletions,
      }
}

const TITLE_WORDS = 6

// A new session's first title: its prompt's first words. The server names
// the row with it and web shows it before the server confirms, so both must
// agree; Lor's generated title replaces it after the first reply.
export function sessionTitleFromPrompt(content: string) {
  const words = content
    .replace(USER_MENTION_REGEX, "")
    .replace(MARKDOWN_USER_MENTION_REGEX, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return "New session"
  const title = words.slice(0, TITLE_WORDS).join(" ")
  const capitalized = title.charAt(0).toUpperCase() + title.slice(1)
  return words.length > TITLE_WORDS ? `${capitalized}…` : capitalized
}
