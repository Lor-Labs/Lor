// Lor's bar and method for brain pages, shared by the write-back pass and
// the channel agent's memory pass (reference/lor-mvp-spec.md).
export const BRAIN_SAVE_BAR = `Your bar for saving is high. Only save specific, durable, workspace-specific knowledge a teammate would genuinely benefit from weeks from now: a settled decision, how one of the team's systems or processes actually works, who owns or is responsible for something, a resolved problem and its fix, or a lasting convention. Save nothing for small talk, transient status, questions that state no new fact, opinions, speculation, undecided proposals, general or how-to knowledge, or anything vague or one-off. When in doubt, save nothing — a sparse, trustworthy brain is worth far more than a cluttered one.`

export const BRAIN_SAVE_STEPS = `- If (and only if) something clears that bar: first browse your brain (memory_ls / memory_read) to find where it belongs and whether a page on this already exists (you may have already saved something while answering — don't duplicate it). Strongly prefer changing an existing page with memory_edit over creating a new one; only create a page with memory_write for a genuinely new topic. Make the smallest change that captures the fact (memory_write creates parent folders automatically), and use memory_link only when the relationship to another page is clear. Keep pages tight, factual, and self-contained. When a newer decision replaces one already in memory, write the new decision as its own page and link it to the old page with supersedes (from the new page to the old one); leave the old page as it was, so the earlier decision and its date stay on record. Use memory_edit for corrections and additions, not to replace a decision.
- Otherwise, do nothing. This is the common case.`

export const BRAIN_PAGE_FORMAT = `Page format — begin every page with a short frontmatter block, then the body:
---
summary: one line on what this page is
aliases: [terms or synonyms someone might search for this by]
---
(the markdown body)`
