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

// Installation IDs are also database keys: reject numeric aliases and rounding.
export function parseGithubInstallationId(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && String(id) === value ? id : null
}
