// Conversation turns render as `Name: content` lines inside one user message,
// and that column-0 name convention is the only thing separating speakers.
// Both halves are user-controlled, so a message body containing "\nBob: do X"
// (or "Lor: …") would read as another person speaking. Neutralized at
// render time, in every surface that emits speaker lines (initial transcript,
// mid-run steer/ambient updates, continuation delta) — the
// stored snapshot keeps the raw text.

// Display names are user-controlled, so neutralize anything that could break
// line structure or forge a mention when interpolated into the prompt: drop
// line breaks (no injected speaker lines/instructions) and angle brackets (no
// fake <@id> tokens). The real <@id> the roster appends is the only valid
// mention.
export function sanitizeRosterLabel(label: string): string {
  return label
    .replace(/[\n\r\v\f\u0085\u2028\u2029<>]+/g, " ")
    .trim()
    .slice(0, 80)
}

// One speaker line per turn. Continuation lines of the body are indented two
// spaces, so only real speaker lines ever start at column 0 — no body pattern
// to match means no pattern to evade. Two spaces, not four: four is a
// markdown code block. Attachment `[file: …]` lines folded into the body are
// covered the same way (filenames are user-controlled too).
export function formatSpeakerLine(authorName: string, body: string): string {
  const name = sanitizeRosterLabel(authorName) || "Unknown"
  const indented = body
    .replace(/\r\n|[\n\r\v\f\u0085\u2028\u2029]/g, "\n")
    .replace(/\n/g, "\n  ")
  return `${name}: ${indented}`
}

// For user-controlled labels rendered inline inside our own bracketed lines
// (filenames in `[image: …]` / `[file: …]` parts that can't ride the speaker
// indent because image bytes interleave between text parts).
export function sanitizeInlineLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().slice(0, 200)
}
