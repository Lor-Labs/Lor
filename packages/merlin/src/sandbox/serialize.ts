// Parallel tool calls in one step must not share a persistent sandbox (or its
// Pi session) concurrently — serialize per sandbox key. Cross-process overlap
// can't happen: a conversation scope has at most one active run. Each caller
// gets its own map so code and workbench sandboxes under the same scope key
// never queue behind each other.
export function createSessionSerializer() {
  const sessions = new Map<string, Promise<unknown>>()
  return function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = sessions.get(key) ?? Promise.resolve()
    const run = prev.then(fn)
    const settled = run.then(
      () => {},
      () => {}
    )
    sessions.set(key, settled)
    void settled.then(() => {
      if (sessions.get(key) === settled) sessions.delete(key)
    })
    return run
  }
}
