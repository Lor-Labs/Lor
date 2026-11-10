import { lorBranchPlaceName } from "./lor-branch-names"

// A name for a branch a code session creates: git check-ref-format's rules,
// within the characters code sessions allow in branch names.
export function isValidNewBranchName(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,200}$/.test(name) &&
    !name.startsWith("-") &&
    !name.includes("..") &&
    !name.endsWith(".") &&
    name
      .split("/")
      .every(
        (part) =>
          part !== "" && !part.startsWith(".") && !part.endsWith(".lock")
      )
  )
}

// The branch Lor names for a session's work: lor/<place name>-<session id
// prefix>, so Lor's branches stand out, read as a place rather than a slice of
// the prompt, and each traces back to its session. Server and web both name a
// new session's branch, so they must agree: the place name comes from the
// session id alone (see ./lor-branch-names).
export function lorBranchName(sessionId: string): string {
  const suffix = sessionId.slice(0, 6)
  const named = `lor/${lorBranchPlaceName(sessionId).toLowerCase()}-${suffix}`
  return isValidNewBranchName(named) ? named : `lor/session-${suffix}`
}

// Installation IDs are also database keys: reject numeric aliases and rounding.
export function parseGithubInstallationId(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && String(id) === value ? id : null
}
