// Installation IDs are also database keys: reject numeric aliases and rounding.
export function parseGithubInstallationId(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && String(id) === value ? id : null
}
