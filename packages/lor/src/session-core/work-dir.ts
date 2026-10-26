// The conversation's work folder: the harness default `<pwd>/pi-<sessionId>`
// (sessionWorkDir in @ai-sdk/harness 1.0.158), never a shared fixed folder.
// Its own module so hosts can find a session's files without loading Pi.
export function piWorkDir(sandboxPwd: string, sessionId: string): string {
  return `${sandboxPwd}/pi-${encodeURIComponent(sessionId)}`
}
