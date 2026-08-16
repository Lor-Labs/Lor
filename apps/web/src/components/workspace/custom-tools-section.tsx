import {
  ArrowDown01Icon,
  Delete02Icon,
  PlusSignIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/ui/components/empty"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { PasswordInput } from "@/components/auth/password-input"
import {
  type PlaceholderItem,
  TemplateInput,
} from "@/components/workspace/template-input"
import { apiClient } from "@/lib/api-client"
import { extractCurlSecrets, parseCurl } from "@/lib/parse-curl"
import {
  formatTemplateJson,
  scanTemplateRefs,
  templateJsonIssue,
  templateJsonLint,
} from "@/lib/tool-templates"

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
type Method = (typeof METHODS)[number]

const ARG_TYPES = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "True/false" },
] as const
type ArgType = (typeof ARG_TYPES)[number]["value"]

type CustomToolRow = {
  id: string
  name: string
  description: string
  argsSchema: Record<string, unknown>
  method: Method
  urlTemplate: string
  headers: Record<string, string>
  bodyTemplate: string | null
  secretNames: string[]
  status: "active" | "archived"
  createdAt: string
  updatedAt: string
}

type Pair = { name: string; value: string }

type ArgRow = {
  name: string
  type: ArgType
  required: boolean
  description: string
}

type Draft = {
  name: string
  description: string
  method: Method
  urlTemplate: string
  headers: Pair[]
  bodyTemplate: string
  // Arguments editor: simple rows by default, raw JSON Schema as the escape
  // hatch (and the fallback when an existing schema is too rich for rows).
  argsMode: "simple" | "json"
  argRows: ArgRow[]
  argsText: string
  // Secrets are write-only: existing ones render as masked rows that can be
  // deleted or given a replacement value (key rotation); new values ride the
  // next save.
  keptSecretNames: string[]
  // Replacement values for kept secrets, keyed by row while editing.
  updatedSecrets: Pair[]
  newSecrets: Pair[]
}

function emptyDraft(): Draft {
  return {
    name: "",
    description: "",
    method: "GET",
    urlTemplate: "",
    headers: [],
    bodyTemplate: "",
    argsMode: "simple",
    argRows: [],
    argsText: "",
    keptSecretNames: [],
    updatedSecrets: [],
    newSecrets: [],
  }
}

function rowsToSchema(rows: ArgRow[]): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(
      rows.map((r) => [
        r.name.trim(),
        {
          type: r.type,
          ...(r.description.trim()
            ? { description: r.description.trim() }
            : {}),
        },
      ])
    ),
    required: rows.filter((r) => r.required).map((r) => r.name.trim()),
  }
}

// Inverse of rowsToSchema — null when the schema uses features the simple
// editor can't express (nesting, enums, arrays…), which flips to JSON mode.
function schemaToRows(schema: Record<string, unknown>): ArgRow[] | null {
  if (schema.type !== "object") return null
  const allowedKeys = new Set(["type", "properties", "required"])
  if (Object.keys(schema).some((k) => !allowedKeys.has(k))) return null
  const properties = schema.properties ?? {}
  if (typeof properties !== "object" || Array.isArray(properties)) return null
  const required = Array.isArray(schema.required) ? schema.required : []
  const rows: ArgRow[] = []
  for (const [name, def] of Object.entries(
    properties as Record<string, unknown>
  )) {
    if (!def || typeof def !== "object" || Array.isArray(def)) return null
    const prop = def as Record<string, unknown>
    if (Object.keys(prop).some((k) => k !== "type" && k !== "description")) {
      return null
    }
    const type = prop.type
    if (type !== "string" && type !== "number" && type !== "boolean") {
      return null
    }
    rows.push({
      name,
      type,
      required: required.includes(name),
      description: typeof prop.description === "string" ? prop.description : "",
    })
  }
  return rows
}

function draftFromTool(tool: CustomToolRow): Draft {
  const rows = schemaToRows(tool.argsSchema)
  return {
    name: tool.name,
    description: tool.description,
    method: tool.method,
    urlTemplate: tool.urlTemplate,
    headers: Object.entries(tool.headers).map(([name, value]) => ({
      name,
      value,
    })),
    bodyTemplate: tool.bodyTemplate ?? "",
    argsMode: rows ? "simple" : "json",
    argRows: rows ?? [],
    argsText: JSON.stringify(tool.argsSchema, null, 2),
    keptSecretNames: tool.secretNames,
    updatedSecrets: [],
    newSecrets: [],
  }
}

const ARG_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/

function draftTemplates(d: Draft): (string | null)[] {
  return [d.urlTemplate, d.bodyTemplate, ...d.headers.map((h) => h.value)]
}

// The templates are the source of truth for arguments: any {{args.x}} that
// appears materializes a row automatically (simple mode only — JSON mode is
// hand-managed). Rows are never auto-removed; unused ones get a marker.
function syncDraftArgs(d: Draft): Draft {
  if (d.argsMode !== "simple") return d
  const refs = scanTemplateRefs(draftTemplates(d))
  const known = new Set(d.argRows.map((r) => r.name.trim()))
  const missing = refs.args.filter((name) => !known.has(name))
  if (missing.length === 0) return d
  return {
    ...d,
    argRows: [
      ...d.argRows,
      ...missing.map((name) => ({
        name,
        type: "string" as const,
        required: true,
        description: "",
      })),
    ],
  }
}

// Draft → API payload; returns an error message instead when invalid.
function draftPayload(draft: Draft):
  | {
      name: string
      description: string
      argsSchema: Record<string, unknown>
      method: Method
      urlTemplate: string
      headers: Record<string, string>
      bodyTemplate: string | null
    }
  | { error: string } {
  if (!draft.name.trim()) return { error: "Name is required" }
  if (!draft.description.trim()) return { error: "Description is required" }
  if (!draft.urlTemplate.trim()) return { error: "URL is required" }

  let argsSchema: Record<string, unknown>
  if (draft.argsMode === "simple") {
    const rows = draft.argRows.filter((r) => r.name.trim())
    for (const row of rows) {
      if (!ARG_NAME_REGEX.test(row.name.trim())) {
        return { error: `"${row.name}" isn't a valid argument name` }
      }
    }
    const names = rows.map((r) => r.name.trim())
    if (new Set(names).size !== names.length) {
      return { error: "Argument names must be unique" }
    }
    argsSchema = rowsToSchema(rows)
  } else {
    try {
      const parsed: unknown = JSON.parse(draft.argsText)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "Args schema must be a JSON object" }
      }
      argsSchema = parsed as Record<string, unknown>
    } catch {
      return { error: "Args schema is not valid JSON" }
    }
    if (argsSchema.type !== "object") {
      return { error: 'Args schema needs "type": "object"' }
    }
  }

  const headers: Record<string, string> = {}
  for (const pair of draft.headers) {
    if (pair.name.trim()) headers[pair.name.trim()] = pair.value
  }
  // Same rule the API enforces: with a JSON (or defaulted) Content-Type, the
  // body must parse — placeholders count as values. A non-JSON Content-Type
  // header (form-encoded, GraphQL, XML) is the explicit opt-out.
  const bodyTemplate = draft.bodyTemplate.trim() ? draft.bodyTemplate : null
  if (bodyTemplate) {
    const contentType = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "content-type"
    )?.[1]
    const mustBeJson =
      !contentType || contentType.toLowerCase().includes("json")
    const issue = mustBeJson ? templateJsonIssue(bodyTemplate) : null
    if (issue) {
      return {
        error: `The request body must be valid JSON (${issue}) — or set a non-JSON Content-Type header`,
      }
    }
  }
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    argsSchema,
    method: draft.method,
    urlTemplate: draft.urlTemplate.trim(),
    headers,
    bodyTemplate,
  }
}

function newSecretsPayload(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of draft.newSecrets) {
    if (pair.name.trim() && pair.value) out[pair.name.trim()] = pair.value
  }
  return out
}

// Key/value editor rows shared by headers and secrets. `template` swaps the
// value input for the {{ }}-autocompleting field (headers reference args and
// secrets; secret values never do).
function PairRows({
  pairs,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  addLabel,
  secret,
  template,
}: {
  pairs: Pair[]
  onChange: (pairs: Pair[]) => void
  namePlaceholder: string
  valuePlaceholder: string
  addLabel: string
  secret?: boolean
  template?: {
    argNames: string[]
    secretNames: string[]
    onCreatePlaceholder: (item: PlaceholderItem) => void
  }
}) {
  return (
    <div className="space-y-1.5">
      {pairs.map((pair, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          key={i}
          className="flex items-center gap-1.5"
        >
          <Input
            value={pair.name}
            placeholder={namePlaceholder}
            className="h-8 w-44 shrink-0 text-xs"
            onChange={(e) =>
              onChange(
                pairs.map((p, j) =>
                  j === i ? { ...p, name: e.target.value } : p
                )
              )
            }
          />
          {template ? (
            <TemplateInput
              value={pair.value}
              placeholder={valuePlaceholder}
              argNames={template.argNames}
              secretNames={template.secretNames}
              onCreatePlaceholder={template.onCreatePlaceholder}
              onChange={(value) =>
                onChange(pairs.map((p, j) => (j === i ? { ...p, value } : p)))
              }
            />
          ) : secret ? (
            // Peekable ONLY before save — values are write-only once stored
            // (encrypted at rest; the API never returns them).
            <div className="min-w-0 flex-1">
              <PasswordInput
                value={pair.value}
                placeholder={valuePlaceholder}
                className="h-8 text-xs"
                onChange={(e) =>
                  onChange(
                    pairs.map((p, j) =>
                      j === i ? { ...p, value: e.target.value } : p
                    )
                  )
                }
              />
            </div>
          ) : (
            <Input
              value={pair.value}
              placeholder={valuePlaceholder}
              className="h-8 flex-1 text-xs"
              onChange={(e) =>
                onChange(
                  pairs.map((p, j) =>
                    j === i ? { ...p, value: e.target.value } : p
                  )
                )
              }
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Remove row"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={() => onChange([...pairs, { name: "", value: "" }])}
      >
        <HugeiconsIcon
          icon={PlusSignIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        {addLabel}
      </Button>
    </div>
  )
}

function ArgumentRows({
  rows,
  onChange,
  unusedNames,
}: {
  rows: ArgRow[]
  onChange: (rows: ArgRow[]) => void
  unusedNames: ReadonlySet<string>
}) {
  const update = (i: number, patch: Partial<ArgRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          key={i}
          className="flex items-center gap-1.5"
        >
          <div className="relative w-32 shrink-0">
            <Input
              value={row.name}
              placeholder="orderId"
              className="h-8 font-mono text-xs"
              onChange={(e) => update(i, { name: e.target.value })}
            />
            {unusedNames.has(row.name.trim()) && (
              <span
                className="absolute -top-1.5 -right-1.5 rounded bg-warning/15 px-1 text-[9px] text-warning-foreground"
                title="No template references this argument and it isn't sent in a default JSON body"
              >
                unused
              </span>
            )}
          </div>
          <Select
            items={[...ARG_TYPES]}
            value={row.type}
            onValueChange={(value) => update(i, { type: value as ArgType })}
          >
            <SelectTrigger size="sm" className="w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARG_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={row.description}
            placeholder="What goes here? (hint for Merlin)"
            className="h-8 flex-1 text-xs"
            onChange={(e) => update(i, { description: e.target.value })}
          />
          <div className="flex shrink-0 items-center gap-1">
            <Checkbox
              id={`arg-required-${i}`}
              checked={row.required}
              onCheckedChange={(checked) =>
                update(i, { required: checked === true })
              }
            />
            <Label
              htmlFor={`arg-required-${i}`}
              className="cursor-pointer text-[11px] font-normal text-muted-foreground"
            >
              Required
            </Label>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Remove argument"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground"
        onClick={() =>
          onChange([
            ...rows,
            { name: "", type: "string", required: true, description: "" },
          ])
        }
      >
        <HugeiconsIcon
          icon={PlusSignIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        Add argument
      </Button>
    </div>
  )
}

// The automatic body, written in template notation — shown as the preview
// and used as the starting point when someone customizes the shape.
function defaultBodyTemplate(argNames: string[]): string {
  if (argNames.length === 0) return "{}"
  return `{${argNames.map((n) => `"${n}": {{args.${n}}}`).join(", ")}}`
}

// Muted preview with the {{args.x}} parts tinted, so the automatic body reads
// the same way the editable template does.
function BodyPreview({ template }: { template: string }) {
  const parts = template.split(/(\{\{\s*args\.[A-Za-z0-9_]+\s*\}\})/g)
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
      {parts.map((part, i) =>
        /^\{\{\s*args\./.test(part) ? (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: static split
            key={i}
            className="font-medium text-primary/80"
          >
            {part}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split
          <span key={i}>{part}</span>
        )
      )}
    </div>
  )
}

// Live parse status + one-click pretty-print for the raw args-schema JSON
// editor (a plain textarea — no decorations available there).
function JsonStatusRow({
  value,
  issue,
  onFormat,
}: {
  value: string
  issue: string | null
  onFormat: (formatted: string) => void
}) {
  if (!value.trim()) return null
  const formatted = issue === null ? formatTemplateJson(value) : null
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      {issue === null ? (
        <span className="text-success">✓ Valid JSON</span>
      ) : (
        <span className="min-w-0 text-warning-foreground">
          ⚠ Doesn't parse as JSON ({issue})
        </span>
      )}
      {formatted !== null && formatted !== value && (
        <button
          type="button"
          className="shrink-0 cursor-pointer text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onFormat(formatted)}
        >
          Format
        </button>
      )}
    </div>
  )
}

function ToolEditor({
  draft,
  setDraft,
  busy,
  onSave,
  onCancel,
  saveLabel,
  isNew,
}: {
  draft: Draft
  setDraft: (update: (d: Draft) => Draft) => void
  busy: boolean
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  // The cURL import is a bootstrap for new tools; editing works on the
  // already-structured fields.
  isNew?: boolean
}) {
  const [curlText, setCurlText] = useState("")
  const [showBody, setShowBody] = useState(draft.bodyTemplate.trim() !== "")
  const hasBody = draft.method !== "GET" && draft.method !== "DELETE"

  // Every draft change re-syncs arguments from the templates (idempotent).
  const updateDraft = (update: (d: Draft) => Draft) =>
    setDraft((d) => syncDraftArgs(update(d)))

  const refs = scanTemplateRefs(draftTemplates(draft))
  const argNames =
    draft.argsMode === "simple"
      ? draft.argRows.map((r) => r.name.trim()).filter(Boolean)
      : refs.args
  const definedSecretNames = [
    ...draft.keptSecretNames,
    ...draft.newSecrets.map((s) => s.name.trim()).filter(Boolean),
  ]
  const undefinedSecrets = refs.secrets.filter(
    (name) => !definedSecretNames.includes(name)
  )
  // With a default JSON body, every argument is implicitly sent; otherwise an
  // argument is unused unless some template references it.
  const bodyImplicit = hasBody && draft.bodyTemplate.trim() === ""
  const unusedNames: ReadonlySet<string> = new Set(
    bodyImplicit ? [] : argNames.filter((n) => !refs.args.includes(n))
  )

  // Shared "create new" handler for every {{ popup: new args materialize via
  // the template sync; new secrets get an empty value row to fill in below.
  const handleCreatePlaceholder = (item: PlaceholderItem) => {
    if (item.kind !== "secrets") return
    updateDraft((d) =>
      d.newSecrets.some((s) => s.name.trim() === item.name) ||
      d.keptSecretNames.includes(item.name)
        ? d
        : {
            ...d,
            newSecrets: [...d.newSecrets, { name: item.name, value: "" }],
          }
    )
  }

  const importCurl = () => {
    const parsed = parseCurl(curlText)
    if (!parsed) {
      toast.error("Couldn't find a URL in that cURL command")
      return
    }
    // Credentials in headers become {{secrets.…}} references with prefilled
    // (renamable) value rows — real keys must never live in the template.
    const extracted = extractCurlSecrets(parsed.headers)
    updateDraft((d) => ({
      ...d,
      method: parsed.method,
      urlTemplate: parsed.url,
      headers: Object.entries(extracted.headers).map(([name, value]) => ({
        name,
        value,
      })),
      bodyTemplate: parsed.body ?? "",
      newSecrets: [
        ...d.newSecrets,
        ...extracted.secrets.filter(
          (s) =>
            !d.newSecrets.some((existing) => existing.name === s.name) &&
            !d.keptSecretNames.includes(s.name)
        ),
      ],
    }))
    if (parsed.body) setShowBody(true)
    setCurlText("")
    toast.success(
      extracted.secrets.length > 0
        ? `Imported — moved ${extracted.secrets.length} credential${extracted.secrets.length === 1 ? "" : "s"} into secrets (rename them if you like)`
        : "Imported — replace real credentials with {{secrets.…}}"
    )
  }

  const switchToJson = () =>
    setDraft((d) => ({
      ...d,
      argsMode: "json",
      argsText: JSON.stringify(
        rowsToSchema(d.argRows.filter((r) => r.name.trim())),
        null,
        2
      ),
    }))

  const switchToSimple = () => {
    try {
      const parsed: unknown = JSON.parse(draft.argsText)
      const rows =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? schemaToRows(parsed as Record<string, unknown>)
          : null
      if (!rows) {
        toast.error(
          "This schema uses features the simple editor can't show — keep editing as JSON"
        )
        return
      }
      setDraft((d) => ({ ...d, argsMode: "simple", argRows: rows }))
    } catch {
      toast.error("Fix the JSON before switching back")
    }
  }

  return (
    <div className="space-y-4">
      {isNew && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Import from cURL
          </div>
          <Textarea
            value={curlText}
            onChange={(e) => setCurlText(e.target.value)}
            placeholder="Paste a curl command to prefill the method, URL, headers, and body"
            className="min-h-14 font-mono text-xs"
            rows={2}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!curlText.trim()}
            onClick={importCurl}
          >
            Import
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Name</Label>
          <Input
            value={draft.name}
            placeholder="query_orders"
            className="h-8 font-mono text-xs"
            maxLength={64}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
              }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Method</Label>
          <Select
            items={METHODS.map((m) => ({ value: m, label: m }))}
            value={draft.method}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, method: value as Method }))
            }
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Description — when should Merlin use this?
        </Label>
        <Textarea
          value={draft.description}
          placeholder="Look up an order by id in our billing system. Use when someone asks about an order's status or amount."
          className="min-h-14 text-xs"
          rows={2}
          maxLength={1000}
          onChange={(e) =>
            setDraft((d) => ({ ...d, description: e.target.value }))
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">URL</Label>
        <TemplateInput
          value={draft.urlTemplate}
          onChange={(urlTemplate) =>
            updateDraft((d) => ({ ...d, urlTemplate }))
          }
          argNames={argNames}
          secretNames={definedSecretNames}
          onCreatePlaceholder={handleCreatePlaceholder}
          placeholder="https://api.acme.com/orders/{{args.orderId}}"
        />
        <p className="text-[11px] text-muted-foreground">
          Type <code>{"{{"}</code> to insert an argument or secret — the parts
          of the request that vary. New ones appear below automatically.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Headers</Label>
        <PairRows
          pairs={draft.headers}
          onChange={(headers) => updateDraft((d) => ({ ...d, headers }))}
          namePlaceholder="Authorization"
          valuePlaceholder="Bearer {{secrets.API_KEY}}"
          addLabel="Add header"
          template={{
            argNames,
            secretNames: definedSecretNames,
            onCreatePlaceholder: handleCreatePlaceholder,
          }}
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">
            Arguments — the inputs Merlin fills in
          </Label>
          {draft.argsMode === "simple" ? (
            <button
              type="button"
              className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={switchToJson}
            >
              Edit as JSON
            </button>
          ) : (
            <button
              type="button"
              className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={switchToSimple}
            >
              Use simple editor
            </button>
          )}
        </div>
        {draft.argsMode === "simple" ? (
          <ArgumentRows
            rows={draft.argRows}
            onChange={(argRows) => setDraft((d) => ({ ...d, argRows }))}
            unusedNames={unusedNames}
          />
        ) : (
          <>
            <Textarea
              value={draft.argsText}
              className="min-h-24 font-mono text-xs"
              rows={5}
              onChange={(e) =>
                setDraft((d) => ({ ...d, argsText: e.target.value }))
              }
            />
            <JsonStatusRow
              value={draft.argsText}
              issue={templateJsonIssue(draft.argsText)}
              onFormat={(argsText) => setDraft((d) => ({ ...d, argsText }))}
            />
          </>
        )}
      </div>

      {hasBody &&
        (showBody ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Request body — custom shape</Label>
              <div className="flex items-center gap-3">
                {(() => {
                  const formatted =
                    templateJsonIssue(draft.bodyTemplate) === null
                      ? formatTemplateJson(draft.bodyTemplate)
                      : null
                  return formatted !== null &&
                    formatted !== draft.bodyTemplate ? (
                    <button
                      type="button"
                      className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                      onClick={() =>
                        updateDraft((d) => ({ ...d, bodyTemplate: formatted }))
                      }
                    >
                      Format
                    </button>
                  ) : null
                })()}
                <button
                  type="button"
                  className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    updateDraft((d) => ({ ...d, bodyTemplate: "" }))
                    setShowBody(false)
                  }}
                >
                  Use the automatic body instead
                </button>
              </div>
            </div>
            <TemplateInput
              value={draft.bodyTemplate}
              onChange={(bodyTemplate) =>
                updateDraft((d) => ({ ...d, bodyTemplate }))
              }
              argNames={argNames}
              secretNames={definedSecretNames}
              onCreatePlaceholder={handleCreatePlaceholder}
              placeholder={'{"query": {{args.query}}, "source": "lor"}'}
              multiline
              className="min-h-24 bg-muted/30"
              lint={templateJsonLint}
            />
            <p className="text-[11px] text-muted-foreground">
              This replaces the automatic body — write the exact JSON your API
              expects, with <code>{"{{args.…}}"}</code> where Merlin's values
              go. Arguments not referenced here won't be sent.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Request body</Label>
              <button
                type="button"
                className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  // Start from the automatic body, not a blank box —
                  // customizing means editing the default, not authoring JSON
                  // from scratch.
                  updateDraft((d) => ({
                    ...d,
                    bodyTemplate: defaultBodyTemplate(argNames),
                  }))
                  setShowBody(true)
                }}
              >
                My API needs a different JSON shape
              </button>
            </div>
            <BodyPreview template={defaultBodyTemplate(argNames)} />
            <p className="text-[11px] text-muted-foreground">
              Built automatically from the arguments above — sent as the
              request's JSON when Merlin calls the tool.
            </p>
          </div>
        ))}

      <div className="space-y-1.5">
        <Label className="text-xs">Secrets</Label>
        {undefinedSecrets.length > 0 && (
          <p className="text-[11px] text-destructive-foreground">
            The request references{" "}
            {undefinedSecrets.map((n) => `{{secrets.${n}}}`).join(", ")} — add{" "}
            {undefinedSecrets.length === 1 ? "its value" : "their values"} here.
          </p>
        )}
        {draft.keptSecretNames.map((name) => {
          const update = draft.updatedSecrets.find((u) => u.name === name)
          return (
            <div key={name} className="flex items-center gap-1.5">
              <Input
                value={name}
                disabled
                className="h-8 w-44 shrink-0 font-mono text-xs"
              />
              {update ? (
                <>
                  <div className="min-w-0 flex-1">
                    <PasswordInput
                      // biome-ignore lint/a11y/noAutofocus: row enters edit mode on click
                      autoFocus
                      value={update.value}
                      placeholder="New value — replaces the stored one on save"
                      className="h-8 text-xs"
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          updatedSecrets: d.updatedSecrets.map((u) =>
                            u.name === name
                              ? { ...u, value: e.target.value }
                              : u
                          ),
                        }))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs text-muted-foreground"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        updatedSecrets: d.updatedSecrets.filter(
                          (u) => u.name !== name
                        ),
                      }))
                    }
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Input
                    value="••••••••••••••"
                    disabled
                    readOnly
                    className="h-8 min-w-0 flex-1 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs text-muted-foreground"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        updatedSecrets: [
                          ...d.updatedSecrets,
                          { name, value: "" },
                        ],
                      }))
                    }
                  >
                    Update
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Delete secret ${name}`}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    keptSecretNames: d.keptSecretNames.filter(
                      (n) => n !== name
                    ),
                    updatedSecrets: d.updatedSecrets.filter(
                      (u) => u.name !== name
                    ),
                  }))
                }
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              </Button>
            </div>
          )
        })}
        <PairRows
          pairs={draft.newSecrets}
          onChange={(newSecrets) => setDraft((d) => ({ ...d, newSecrets }))}
          namePlaceholder="API_KEY"
          valuePlaceholder="Value (stored encrypted, never shown again)"
          addLabel="Add secret"
          secret
        />
      </div>

      <div className="flex items-center gap-2 border-border border-t pt-3">
        <Button type="button" size="sm" disabled={busy} onClick={onSave}>
          {busy ? "Saving..." : saveLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function CustomToolsSection({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [editingId, setEditingId] = useState<string | null>(null)

  const queryKey = ["custom-tools", workspaceSlug]
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "custom-tools"
      ].$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load custom tools")
      return res.json()
    },
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = draftPayload(draft)
      if ("error" in payload) throw new Error(payload.error)
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "custom-tools"
      ].$post({
        param: { workspaceSlug },
        json: { ...payload, secrets: newSecretsPayload(draft) },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Failed to create tool")
      }
      return res.json()
    },
    onSuccess: () => {
      invalidate()
      setCreating(false)
      setDraft(emptyDraft())
    },
    onError: (err) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: async (tool: CustomToolRow) => {
      const payload = draftPayload(draft)
      if ("error" in payload) throw new Error(payload.error)
      // Secrets diff: removed rows → null, replacement values (key rotation)
      // and new rows → encrypted values. An Update row left empty is a no-op
      // — the stored value survives.
      const secrets: Record<string, string | null> = {}
      for (const name of tool.secretNames) {
        if (!draft.keptSecretNames.includes(name)) secrets[name] = null
      }
      for (const update of draft.updatedSecrets) {
        if (update.value && draft.keptSecretNames.includes(update.name)) {
          secrets[update.name] = update.value
        }
      }
      for (const [name, value] of Object.entries(newSecretsPayload(draft))) {
        secrets[name] = value
      }
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "custom-tools"
      ][":toolId"].$patch({
        param: { workspaceSlug, toolId: tool.id },
        json: { ...payload, secrets },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Failed to update tool")
      }
      return res.json()
    },
    onSuccess: () => {
      invalidate()
      setEditingId(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const archiveMutation = useMutation({
    mutationFn: async (toolId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "custom-tools"
      ][":toolId"].$delete({ param: { workspaceSlug, toolId } })
      if (!res.ok) throw new Error("Failed to archive tool")
    },
    onSuccess: () => {
      invalidate()
      setEditingId(null)
    },
    onError: () => toast.error("Failed to archive tool"),
  })

  const tools = (data?.tools ?? []) as CustomToolRow[]
  const active = tools.filter((t) => t.status === "active")
  const archived = tools.filter((t) => t.status === "archived")

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">Custom tools</div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            HTTP tools Merlin can call. Channels opt in via the Custom Tools
            capability on their agent profile.
          </p>
        </div>
        {!creating && (
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => {
              setDraft(emptyDraft())
              setEditingId(null)
              setCreating(true)
            }}
          >
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-3.5"
              strokeWidth={2}
            />
            New Tool
          </Button>
        )}
      </div>

      {creating && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <ToolEditor
            draft={draft}
            setDraft={(update) => setDraft(update)}
            busy={createMutation.isPending}
            saveLabel="Create Tool"
            onSave={() => createMutation.mutate()}
            onCancel={() => setCreating(false)}
            isNew
          />
        </div>
      )}

      {isPending ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : active.length === 0 && !creating ? (
        <Empty className="py-8 md:py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon" className="mb-3">
              <HugeiconsIcon icon={Wrench01Icon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle className="text-sm">No custom tools yet</EmptyTitle>
            <EmptyDescription className="text-xs">
              Give Merlin your internal APIs — paste a cURL command to start.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-2">
          {active.map((tool) => {
            const isEditing = editingId === tool.id
            return (
              <li
                key={tool.id}
                className="rounded-lg border border-border bg-muted/20"
              >
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-3 p-3 text-left"
                  onClick={() => {
                    if (isEditing) {
                      setEditingId(null)
                      return
                    }
                    setCreating(false)
                    setDraft(draftFromTool(tool))
                    setEditingId(tool.id)
                  }}
                >
                  <Badge
                    variant="outline"
                    size="sm"
                    className="shrink-0 px-1.5 font-mono font-normal"
                  >
                    {tool.method}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">
                      {tool.name}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {tool.description}
                    </div>
                  </div>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isEditing && "rotate-180"
                    )}
                    strokeWidth={2}
                  />
                </button>
                {isEditing && (
                  <div className="border-border border-t p-4">
                    <ToolEditor
                      draft={draft}
                      setDraft={(update) => setDraft(update)}
                      busy={updateMutation.isPending}
                      saveLabel="Save Changes"
                      onSave={() => updateMutation.mutate(tool)}
                      onCancel={() => setEditingId(null)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-destructive hover:text-destructive"
                      disabled={archiveMutation.isPending}
                      onClick={() => archiveMutation.mutate(tool.id)}
                    >
                      Archive Tool
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {archived.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Archived
          </div>
          <ul className="space-y-1">
            {archived.map((tool) => (
              <li
                key={tool.id}
                className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="font-mono">{tool.name}</span>
                <span className="truncate">{tool.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
