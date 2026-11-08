import type { JSONContent } from "@tiptap/react"

// Unsent composer drafts per person per conversation, on this device, so
// navigating away and back (or reloading) keeps what was typed. Text and
// mentions only; attachments are not kept.
const PREFIX = "lor-draft:"
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const SAVE_DELAY_MS = 300

type StoredDraft = { doc: JSONContent; at: number }

const storageKey = (userId: string, draftKey: string) =>
  `${PREFIX}${userId}:${draftKey}`

export function readComposerDraft(
  userId: string,
  draftKey: string
): JSONContent | null {
  try {
    const stored: StoredDraft | null = JSON.parse(
      localStorage.getItem(storageKey(userId, draftKey)) ?? "null"
    )
    return stored?.doc ?? null
  } catch {
    return null
  }
}

function writeComposerDraft(
  userId: string,
  draftKey: string,
  doc: JSONContent | null
) {
  try {
    const key = storageKey(userId, draftKey)
    if (doc) {
      localStorage.setItem(key, JSON.stringify({ doc, at: Date.now() }))
    } else {
      localStorage.removeItem(key)
    }
  } catch {}
}

// Debounced draft saving: typing saves once it pauses, so a keystroke never
// serializes the document. `flush` saves a pending change at once (blur, page
// hide, a conversation switch, unmount) so the last keystrokes are kept.
export function composerDraftWriter(
  userId: string,
  draftKey: string,
  read: () => JSONContent | null
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    writeComposerDraft(userId, draftKey, read())
  }
  return {
    schedule: () => {
      clearTimeout(timer)
      timer = setTimeout(flush, SAVE_DELAY_MS)
    },
    flush,
    // After a send: the pending save goes too, not only the stored draft.
    clear: () => {
      clearTimeout(timer)
      timer = undefined
      writeComposerDraft(userId, draftKey, null)
    },
  }
}

export type ComposerDraftWriter = ReturnType<typeof composerDraftWriter>

// Drafts left untouched for a month are dropped, so abandoned ones don't pile
// up in local storage.
function pruneComposerDrafts() {
  try {
    const now = Date.now()
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key?.startsWith(PREFIX)) continue
      try {
        const stored: StoredDraft | null = JSON.parse(
          localStorage.getItem(key) ?? "null"
        )
        if (!stored || now - stored.at > MAX_AGE_MS) {
          localStorage.removeItem(key)
        }
      } catch {
        localStorage.removeItem(key)
      }
    }
  } catch {}
}

pruneComposerDrafts()
