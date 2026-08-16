// Placeholder references in custom-tool templates ({{args.x}} /
// {{secrets.KEY}}). The editor derives the tool's argument rows from these —
// the template is the single source of truth for what varies.

export type TemplateRefs = { args: string[]; secrets: string[] }

const REF_REGEX = /\{\{\s*(args|secrets)\.([A-Za-z0-9_]+)\s*\}\}/g

export function scanTemplateRefs(templates: (string | null)[]): TemplateRefs {
  const args: string[] = []
  const secrets: string[] = []
  for (const template of templates) {
    if (!template) continue
    for (const match of template.matchAll(REF_REGEX)) {
      const kind = match[1]
      const name = match[2]
      if (!name) continue
      const bucket = kind === "args" ? args : secrets
      if (!bucket.includes(name)) bucket.push(name)
    }
  }
  return { args, secrets }
}
