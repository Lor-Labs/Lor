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

// The branch Lor names for a session's work: lor/<label slug>-<session id
// prefix>, so Lor's branches stand out and each traces back to its session.
// Server and web both name a new session's branch, so they must agree.
export function lorBranchName(
  label: string,
  sessionId: string,
  fallback: string
): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "")
  const suffix = sessionId.slice(0, 6)
  const named = `lor/${slug || fallback}-${suffix}`
  return isValidNewBranchName(named) ? named : `lor/${fallback}-${suffix}`
}

// Installation IDs are also database keys: reject numeric aliases and rounding.
export function parseGithubInstallationId(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && String(id) === value ? id : null
}
