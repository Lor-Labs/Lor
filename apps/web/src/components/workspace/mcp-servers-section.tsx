import {
  ArrowDown01Icon,
  CloudServerIcon,
  PlusSignIcon,
  RotateClockwiseIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@repo/ui/components/alert"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Badge } from "@repo/ui/components/badge"
import { Button } from "@repo/ui/components/button"
import { Checkbox } from "@repo/ui/components/checkbox"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Spinner } from "@repo/ui/components/spinner"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { PasswordInput } from "@/components/auth/password-input"
import {
  type PlaceholderItem,
  TemplateInput,
} from "@/components/workspace/template-input"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// MCP servers: the second kind of workspace tool (next to API tools).
// The server owns its tool list — the form's job is connection settings plus
// the enabledTools allowlist, populated by "Connect & discover".

export type McpServerRow = {
  id: string
  name: string
  description: string
  url: string
  authMode: "static" | "oauth"
  oauthStatus:
    | "pending"
    | "needs_tool_review"
    | "connected"
    | "reauthorization_required"
    | null
  oauthAuthorizedBy: { id: string; name: string } | null
  oauthAuthorizedAt: string | null
  headers: Record<string, string>
  secretNames: string[]
  enabledTools: string[]
  usedByProfiles: number
  createdAt: string
  updatedAt: string
}

export function mcpServersQueryKey(workspaceSlug: string) {
  return ["mcp-servers", workspaceSlug]
}

export function useMcpServers(workspaceSlug: string) {
  return useQuery({
    queryKey: mcpServersQueryKey(workspaceSlug),
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "mcp-servers"
      ].$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load MCP servers")
      return res.json()
    },
  })
}

type Pair = { name: string; value: string }
type DiscoveredTool = { name: string; description: string }
const noop = () => undefined
const AUTHORIZATION_POLL_INTERVAL_MS = 2000
const AUTHORIZATION_POLL_MAX_ATTEMPTS = 300

type ServerDraft = {
  name: string
  description: string
  url: string
  authMode: "static" | "oauth"
  headers: Pair[]
  // Edit only: saved secrets kept (unchecked = delete on save) and optional
  // replacement values. New secrets are plaintext until save.
  keptSecretNames: string[]
  updatedSecrets: Pair[]
  newSecrets: Pair[]
  enabled: Set<string>
  // Last discovery result this editing session; null = not discovered yet.
  discovered: DiscoveredTool[] | null
}

function emptyDraft(): ServerDraft {
  return {
    name: "",
    description: "",
    url: "",
    authMode: "static",
    headers: [],
    keptSecretNames: [],
    updatedSecrets: [],
    newSecrets: [],
    enabled: new Set(),
    discovered: null,
  }
}

function draftFromServer(server: McpServerRow): ServerDraft {
  return {
    name: server.name,
    description: server.description,
    url: server.url,
    authMode: server.authMode,
    headers: Object.entries(server.headers).map(([name, value]) => ({
      name,
      value,
    })),
    keptSecretNames: [...server.secretNames],
    updatedSecrets: [],
    newSecrets: [],
    // A newly authorized (or reauthorized) account must receive a fresh,
    // explicit tool review. Previously enabled names remain stored while the
    // server is inactive, but must not appear preselected for a new account.
    enabled: new Set(
      server.authMode === "oauth" && server.oauthStatus !== "connected"
        ? []
        : server.enabledTools
    ),
    discovered: null,
  }
}

function oauthStatusLabel(status: McpServerRow["oauthStatus"]): string {
  switch (status) {
    case "connected":
      return "Connected"
    case "needs_tool_review":
      return "Review tools"
    case "reauthorization_required":
      return "Authorization required"
    default:
      return "Not active"
  }
}

function oauthStatusVariant(
  status: McpServerRow["oauthStatus"]
): "success" | "warning" | "outline" {
  if (status === "connected") return "success"
  if (status === "needs_tool_review" || status === "reauthorization_required") {
    return "warning"
  }
  return "outline"
}

function authorizedSummary(server: McpServerRow): string | null {
  if (!(server.oauthAuthorizedBy && server.oauthAuthorizedAt)) return null
  const date = new Date(server.oauthAuthorizedAt)
  if (Number.isNaN(date.getTime())) return null
  return `Authorized by ${server.oauthAuthorizedBy.name} on ${date.toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" }
  )}`
}

function draftHeaders(draft: ServerDraft): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of draft.headers) {
    if (pair.name.trim()) headers[pair.name.trim()] = pair.value
  }
  return headers
}

function newSecretsPayload(draft: ServerDraft): Record<string, string> {
  const secrets: Record<string, string> = {}
  for (const pair of draft.newSecrets) {
    if (pair.name.trim() && pair.value) secrets[pair.name.trim()] = pair.value
  }
  return secrets
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

// MCP tool descriptions arrive model-facing — XML-ish tags, fenced examples,
// repeated boilerplate. Strip the markup and clamp in the checklist; Merlin
// still gets the raw text at bind time.
function cleanToolDescription(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<\/?[a-z_]+>/gi, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

// Matches the API's secret-name rule (mcp-servers schema) so a bad name is
// caught in the form instead of coming back as a 400.
const SECRET_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]{0,63}$/

function PairRows({
  pairs,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  secret,
  addLabel,
  template,
}: {
  pairs: Pair[]
  onChange: (pairs: Pair[]) => void
  namePlaceholder: string
  valuePlaceholder: string
  secret?: boolean
  addLabel: string
  // Header values reference secrets via the {{ autocomplete popup.
  template?: {
    secretNames: string[]
    onCreatePlaceholder: (item: PlaceholderItem) => void
  }
}) {
  const ValueInput = secret ? PasswordInput : Input
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
            className="h-8 w-44 shrink-0 font-mono text-xs"
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
              argNames={[]}
              secretNames={template.secretNames}
              onCreatePlaceholder={template.onCreatePlaceholder}
              onChange={(value) =>
                onChange(pairs.map((p, j) => (j === i ? { ...p, value } : p)))
              }
            />
          ) : (
            <div className="min-w-0 flex-1">
              <ValueInput
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
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => onChange(pairs.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
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

function OAuthConnectionPanel({
  server,
  authorizationOpened,
  busy,
  onAuthorize,
  onFinishAuthorization,
  onDisconnect,
}: {
  server: McpServerRow | null
  authorizationOpened: boolean
  busy: boolean
  onAuthorize: () => void
  onFinishAuthorization: () => void
  onDisconnect: () => void
}) {
  if (!server) {
    return (
      <Alert variant="info">
        <AlertTitle>Save before signing in</AlertTitle>
        <AlertDescription className="text-xs">
          Lor stores the server address first, then opens OAuth in your browser.
          Tools stay inactive until authorization and tool review are complete.
        </AlertDescription>
      </Alert>
    )
  }

  if (server.oauthStatus === "connected") {
    return (
      <Alert variant="success">
        <AlertTitle>OAuth · Shared through assigned channels</AlertTitle>
        <AlertDescription className="text-xs">
          <span>
            Everyone in an assigned channel can use the enabled tools through
            this shared account.
          </span>
          {authorizedSummary(server) ? (
            <span>{authorizedSummary(server)}</span>
          ) : null}
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onAuthorize}
          >
            Reauthorize
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDisconnect}
          >
            Disconnect
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  if (server.oauthStatus === "needs_tool_review") {
    return (
      <Alert variant="warning">
        <AlertTitle>Authorization complete · Tools inactive</AlertTitle>
        <AlertDescription className="text-xs">
          <span>
            Review the current tool list below and choose what assigned channels
            may use.
          </span>
          <span>
            Permissions selected during OAuth control what those tools can
            access; they are not separate MCP tools.
          </span>
        </AlertDescription>
      </Alert>
    )
  }

  if (authorizationOpened && server.oauthStatus === "pending") {
    return (
      <Alert variant="info">
        <AlertTitle>Finish authorization in your browser</AlertTitle>
        <AlertDescription className="text-xs">
          Return here after signing in. The connection remains inactive until
          Lor confirms the callback and you review its tools.
        </AlertDescription>
        <AlertAction>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onFinishAuthorization}
          >
            Finish authorization
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  const reauthorization = server.oauthStatus === "reauthorization_required"
  return (
    <Alert variant={reauthorization ? "warning" : "default"}>
      <AlertTitle>
        {reauthorization
          ? "Authorization expired · Tools inactive"
          : "OAuth not connected · Tools inactive"}
      </AlertTitle>
      <AlertDescription className="text-xs">
        Sign in with an account that is appropriate to share through every
        channel assigned this MCP server.
      </AlertDescription>
      <AlertAction>
        <Button type="button" size="sm" disabled={busy} onClick={onAuthorize}>
          {reauthorization ? "Reauthorize" : "Authorize account"}
        </Button>
      </AlertAction>
    </Alert>
  )
}

function ServerEditor({
  draft,
  setDraft,
  server,
  savedSecretNames,
  busy,
  discovering,
  oauthBusy,
  authorizationOpened,
  saveLabel,
  onDiscover,
  onAuthorize,
  onFinishAuthorization,
  onCompleteOAuth,
  onDisconnectOAuth,
  onSave,
  onCancel,
}: {
  draft: ServerDraft
  setDraft: (update: (d: ServerDraft) => ServerDraft) => void
  server: McpServerRow | null
  savedSecretNames: string[]
  busy: boolean
  discovering: boolean
  oauthBusy: boolean
  authorizationOpened: boolean
  saveLabel: string
  onDiscover: () => void
  onAuthorize: () => void
  onFinishAuthorization: () => void
  onCompleteOAuth: () => void
  onDisconnectOAuth: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const invalidSecretNames = draft.newSecrets
    .map((s) => s.name.trim())
    .filter((name) => name.length > 0 && !SECRET_NAME_REGEX.test(name))
  const trimmedNewNames = draft.newSecrets
    .map((s) => s.name.trim())
    .filter((name) => name.length > 0)
  // A name used twice among new rows, or shadowing a kept stored secret,
  // would silently overwrite a value in the save payload.
  const duplicateSecretNames = [
    ...new Set(
      trimmedNewNames.filter(
        (name, i) =>
          trimmedNewNames.indexOf(name) !== i ||
          draft.keptSecretNames.includes(name)
      )
    ),
  ]
  const isOAuth = draft.authMode === "oauth"
  const oauthCanReview =
    server?.authMode === "oauth" &&
    (server.oauthStatus === "needs_tool_review" ||
      server.oauthStatus === "connected")
  const canDiscover =
    draft.url.trim().length > 0 &&
    (!isOAuth || oauthCanReview) &&
    invalidSecretNames.length === 0 &&
    duplicateSecretNames.length === 0 &&
    !discovering &&
    !busy &&
    !oauthBusy
  const definedSecretNames = [
    ...draft.keptSecretNames,
    ...draft.newSecrets.map((s) => s.name.trim()).filter(Boolean),
  ]
  const handleCreatePlaceholder = (item: PlaceholderItem) => {
    if (item.kind !== "secrets") return
    setDraft((d) =>
      d.newSecrets.some((s) => s.name.trim() === item.name) ||
      d.keptSecretNames.includes(item.name)
        ? d
        : {
            ...d,
            newSecrets: [...d.newSecrets, { name: item.name, value: "" }],
          }
    )
  }
  const toolList =
    draft.discovered ??
    // Pre-discovery on edit: show the saved allowlist so the row is legible
    // without a round trip.
    [...draft.enabled].sort().map((name) => ({ name, description: "" }))
  const canSave =
    draft.name.trim().length > 0 &&
    draft.url.trim().length > 0 &&
    (isOAuth || draft.enabled.size > 0) &&
    invalidSecretNames.length === 0 &&
    duplicateSecretNames.length === 0 &&
    !busy &&
    !oauthBusy
  const canCompleteOAuth =
    oauthCanReview &&
    draft.enabled.size > 0 &&
    !busy &&
    !discovering &&
    !oauthBusy

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Name</Label>
        <Input
          value={draft.name}
          maxLength={80}
          placeholder="Sentry MCP"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">
          Description — when should Merlin use this?
        </Label>
        <Textarea
          value={draft.description}
          maxLength={500}
          placeholder="Our production Postgres — use for questions about signups, usage, and billing data. The server describes its own tools; this says what the connection is for."
          className="min-h-14 text-xs"
          rows={2}
          onChange={(e) =>
            setDraft((d) => ({ ...d, description: e.target.value }))
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Server URL</Label>
        <Input
          value={draft.url}
          maxLength={2048}
          placeholder="https://mcp.example.com/mcp"
          className="font-mono text-xs"
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Authentication</Label>
        {server ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
            <div>
              <div className="text-xs font-medium">
                {isOAuth ? "OAuth" : "Headers / API key"}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Authentication type is fixed after the server is created.
              </div>
            </div>
            {isOAuth && (
              <Badge variant={oauthStatusVariant(server.oauthStatus)} size="sm">
                {oauthStatusLabel(server.oauthStatus)}
              </Badge>
            )}
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label="Authentication method"
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            {(
              [
                {
                  value: "static" as const,
                  title: "Headers / API key",
                  description: "No sign-in, or credentials sent as headers.",
                },
                {
                  value: "oauth" as const,
                  title: "OAuth",
                  description: "One shared account for assigned channels.",
                },
              ] as const
            ).map((option) => {
              const selected = draft.authMode === option.value
              return (
                <label
                  key={option.value}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors active:scale-[0.99] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-background hover:border-foreground/20"
                  )}
                >
                  <input
                    type="radio"
                    name="mcp-auth-mode"
                    value={option.value}
                    checked={selected}
                    className="sr-only"
                    onChange={() =>
                      setDraft((d) => ({
                        ...d,
                        authMode: option.value,
                        discovered: null,
                        enabled: new Set(),
                        headers:
                          option.value === "oauth"
                            ? d.headers.filter(
                                (header) =>
                                  header.name.trim().toLowerCase() !==
                                  "authorization"
                              )
                            : d.headers,
                      }))
                    }
                  />
                  <span className="block text-xs font-medium">
                    {option.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                </label>
              )
            })}
          </div>
        )}
      </div>

      {isOAuth && (
        <OAuthConnectionPanel
          server={server}
          authorizationOpened={authorizationOpened}
          busy={busy || oauthBusy}
          onAuthorize={onAuthorize}
          onFinishAuthorization={onFinishAuthorization}
          onDisconnect={onDisconnectOAuth}
        />
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Headers</Label>
        <p className="text-[11px] text-muted-foreground">
          {isOAuth
            ? "Optional request headers. Lor adds OAuth authorization automatically — reference other secrets as "
            : "Sent on every request — reference secrets as "}
          <code className="text-foreground">{"{{secrets.NAME}}"}</code> instead
          of pasting values.
        </p>
        <PairRows
          pairs={draft.headers}
          onChange={(headers) => setDraft((d) => ({ ...d, headers }))}
          namePlaceholder={isOAuth ? "X-Workspace" : "Authorization"}
          valuePlaceholder={
            isOAuth ? "{{secrets.WORKSPACE_ID}}" : "Bearer {{secrets.API_KEY}}"
          }
          addLabel="Add header"
          template={{
            secretNames: definedSecretNames,
            onCreatePlaceholder: handleCreatePlaceholder,
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Secrets</Label>
        {savedSecretNames.length > 0 && (
          <div className="space-y-1.5">
            {savedSecretNames.map((name) => {
              const kept = draft.keptSecretNames.includes(name)
              const update = draft.updatedSecrets.find((u) => u.name === name)
              return (
                <div key={name} className="flex items-center gap-1.5">
                  <Input
                    value={name}
                    disabled
                    className="h-8 w-44 shrink-0 font-mono text-xs"
                  />
                  <div className="min-w-0 flex-1">
                    {update ? (
                      <PasswordInput
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
                    ) : (
                      <Input
                        value={kept ? "••••••••" : "removed on save"}
                        disabled
                        className="h-8 text-xs"
                      />
                    )}
                  </div>
                  {kept && !update && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-muted-foreground"
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
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        keptSecretNames: kept
                          ? d.keptSecretNames.filter((n) => n !== name)
                          : [...d.keptSecretNames, name],
                        updatedSecrets: d.updatedSecrets.filter(
                          (u) => u.name !== name
                        ),
                      }))
                    }
                  >
                    {kept ? "Delete" : "Keep"}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
        <PairRows
          pairs={draft.newSecrets}
          onChange={(newSecrets) => setDraft((d) => ({ ...d, newSecrets }))}
          namePlaceholder="API_KEY"
          valuePlaceholder="Value (stored encrypted)"
          secret
          addLabel="Add secret"
        />
        {invalidSecretNames.length > 0 && (
          <p className="text-[11px] text-destructive-foreground">
            {invalidSecretNames.join(", ")} — secret names must start with a
            letter and use only letters, numbers, and underscores.
          </p>
        )}
        {duplicateSecretNames.length > 0 && (
          <p className="text-[11px] text-destructive-foreground">
            {duplicateSecretNames.join(", ")} — duplicate secret name; each name
            can only be defined once (stored secrets included).
          </p>
        )}
      </div>

      {(!isOAuth || oauthCanReview) && (
        <div className="space-y-1.5 border-border border-t pt-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Tools Merlin may use</Label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canDiscover}
              onClick={onDiscover}
            >
              {discovering ? (
                <Spinner className="size-3.5" />
              ) : (
                <HugeiconsIcon
                  icon={RotateClockwiseIcon}
                  className="size-3.5"
                  strokeWidth={2}
                />
              )}
              {draft.discovered
                ? "Refresh tools"
                : isOAuth
                  ? "Review tools"
                  : "Connect & discover"}
            </Button>
          </div>
          {toolList.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {isOAuth
                ? "Review the authorized server's tools, then choose which ones assigned channels may call."
                : "Connect to list the server's tools, then pick which ones Merlin may call. New tools the server adds later stay off until enabled here."}
            </p>
          ) : (
            <ul className="space-y-1">
              {toolList.map((tool) => {
                const description = cleanToolDescription(tool.description)
                return (
                  <li
                    key={tool.name}
                    className="flex items-start gap-2.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
                  >
                    <Checkbox
                      id={`mcp-tool-${tool.name}`}
                      className="mt-0.5"
                      checked={draft.enabled.has(tool.name)}
                      disabled={busy || oauthBusy}
                      onCheckedChange={(checked) =>
                        setDraft((d) => {
                          const enabled = new Set(d.enabled)
                          if (checked === true) enabled.add(tool.name)
                          else enabled.delete(tool.name)
                          return { ...d, enabled }
                        })
                      }
                    />
                    <label
                      htmlFor={`mcp-tool-${tool.name}`}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <span className="block font-mono text-xs">
                        {tool.name}
                      </span>
                      {description && (
                        <span
                          className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground"
                          title={description}
                        >
                          {description}
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {isOAuth && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>
                  This list comes directly from the MCP server. OAuth
                  permissions may unlock products or operations inside a general
                  tool instead of adding one tool per product.
                </p>
                <p>
                  Tool changes apply to every channel whose profile grants this
                  server.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!canCompleteOAuth}
                onClick={onCompleteOAuth}
              >
                {oauthBusy
                  ? "Saving…"
                  : server?.oauthStatus === "connected"
                    ? "Save tool access"
                    : "Enable selected tools"}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-border border-t pt-3">
        {!isOAuth && draft.enabled.size === 0 && (
          <span className="mr-auto text-[11px] text-muted-foreground">
            Connect and enable at least one tool to save.
          </span>
        )}
        {isOAuth && !server && (
          <span className="mr-auto text-[11px] text-muted-foreground">
            Saving continues to the shared-account confirmation.
          </span>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canSave} onClick={onSave}>
          {busy ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  )
}

export function McpServersBlock({
  workspaceSlug,
  servers,
  creating,
  onCloseCreate,
}: {
  workspaceSlug: string
  servers: McpServerRow[]
  creating: boolean
  onCloseCreate: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const requestedServerId =
    typeof search.mcpServerId === "string" ? search.mcpServerId : null
  const handledRequestedServerId = useRef<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ServerDraft>(emptyDraft())
  const [deleteTarget, setDeleteTarget] = useState<McpServerRow | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<McpServerRow | null>(
    null
  )
  const [oauthDisclosureTarget, setOauthDisclosureTarget] =
    useState<McpServerRow | null>(null)
  const [disclosureConfirmed, setDisclosureConfirmed] = useState(false)
  const [authorizationOpenedId, setAuthorizationOpenedId] = useState<
    string | null
  >(null)

  // Opening the create card always starts from a blank draft (the draft is
  // shared with row editing).
  useEffect(() => {
    if (creating) {
      setDraft(emptyDraft())
      setEditingId(null)
    }
  }, [creating])

  // OAuth returns to the Tools settings URL with the relevant server id. Open
  // that editor once the list query arrives, then remove the one-shot target
  // so later refetches cannot overwrite in-progress edits.
  useEffect(() => {
    if (!requestedServerId) {
      handledRequestedServerId.current = null
      return
    }
    if (handledRequestedServerId.current === requestedServerId) return
    const requestedServer = servers.find(
      (server) => server.id === requestedServerId
    )
    if (!requestedServer) return
    handledRequestedServerId.current = requestedServerId
    onCloseCreate()
    setDraft(draftFromServer(requestedServer))
    setEditingId(requestedServer.id)
    void navigate({
      to: ".",
      replace: true,
      search: (previous) => ({ ...previous, mcpServerId: undefined }),
    })
  }, [navigate, onCloseCreate, requestedServerId, servers])

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: mcpServersQueryKey(workspaceSlug),
    })

  // Refresh the editor only when it still shows the server whose authorization
  // completed. The user may have opened another server while OAuth was pending.
  useEffect(() => {
    if (!authorizationOpenedId) return
    const current = servers.find(
      (server) => server.id === authorizationOpenedId
    )
    if (current && current.oauthStatus !== "pending") {
      setAuthorizationOpenedId(null)
      if (editingId === current.id) {
        setDraft(draftFromServer(current))
        setEditingId(current.id)
      }
    }
  }, [authorizationOpenedId, editingId, servers])

  // The desktop app opens OAuth in the system browser, so this settings view
  // stays mounted. Poll only for the attempt started from this editor and stop
  // after the server-side attempt expires.
  useEffect(() => {
    if (!authorizationOpenedId) return
    let attempts = 0
    const timer = window.setInterval(() => {
      attempts += 1
      void queryClient.invalidateQueries({
        queryKey: mcpServersQueryKey(workspaceSlug),
      })
      if (attempts >= AUTHORIZATION_POLL_MAX_ATTEMPTS) {
        window.clearInterval(timer)
        setAuthorizationOpenedId((current) =>
          current === authorizationOpenedId ? null : current
        )
      }
    }, AUTHORIZATION_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [authorizationOpenedId, queryClient, workspaceSlug])

  const discoverMutation = useMutation({
    mutationFn: async (mcpServerId: string | null) => {
      const base = apiClient.v1.workspaces[":workspaceSlug"]["mcp-servers"]
      const res = mcpServerId
        ? await base[":mcpServerId"].discover.$post({
            param: { workspaceSlug, mcpServerId },
            json: {
              url: draft.url.trim(),
              headers: draftHeaders(draft),
              secrets: newSecretsPayload(draft),
            },
          })
        : await base.discover.$post({
            param: { workspaceSlug },
            json: {
              url: draft.url.trim(),
              headers: draftHeaders(draft),
              secrets: newSecretsPayload(draft),
            },
          })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Couldn't reach the server")
      }
      return res.json() as Promise<{ tools: DiscoveredTool[] }>
    },
    onSuccess: ({ tools }, mcpServerId) => {
      // Late-response guard: only the row (or create card) that initiated
      // discovery may receive its result.
      if (mcpServerId ? editingId !== mcpServerId : !creating) return
      setDraft((d) => ({
        ...d,
        discovered: tools,
        // Fresh connections opt everything in (saving is the explicit
        // allowlist act); refreshes keep the current selection.
        enabled: mcpServerId
          ? new Set(
              [...d.enabled].filter((name) =>
                tools.some((t) => t.name === name)
              )
            )
          : new Set(tools.map((t) => t.name)),
      }))
      if (tools.length === 0) toast.info("The server reported no tools")
    },
    onError: (err) => toast.error(err.message),
  })

  // A row switch mid-discovery must not leave the previous request's pending
  // spinner (or a settled error) on the newly opened editor.
  const resetDiscovery = discoverMutation.reset
  useEffect(() => {
    resetDiscovery()
  }, [resetDiscovery, editingId, creating])

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "mcp-servers"
      ].$post({
        param: { workspaceSlug },
        json: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          url: draft.url.trim(),
          authMode: draft.authMode,
          headers: draftHeaders(draft),
          secrets: newSecretsPayload(draft),
          enabledTools: draft.authMode === "oauth" ? [] : [...draft.enabled],
        },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Failed to connect server")
      }
      const body = await res.json()
      return body.server as McpServerRow
    },
    onSuccess: async (server) => {
      await invalidate()
      onCloseCreate()
      if (server.authMode === "oauth") {
        setDraft(draftFromServer(server))
        setEditingId(server.id)
        setDisclosureConfirmed(false)
        setOauthDisclosureTarget(server)
      }
    },
    onError: (err) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: async (server: McpServerRow) => {
      // Secrets diff: removed rows → null, replacement + new rows → values.
      const secrets: Record<string, string | null> = {}
      for (const name of server.secretNames) {
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
        "mcp-servers"
      ][":mcpServerId"].$patch({
        param: { workspaceSlug, mcpServerId: server.id },
        json: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          url: draft.url.trim(),
          headers: draftHeaders(draft),
          secrets,
          ...(server.authMode === "static"
            ? { enabledTools: [...draft.enabled] }
            : {}),
        },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Failed to update server")
      }
      return res.json()
    },
    onSuccess: async () => {
      await invalidate()
      setEditingId(null)
    },
    onError: (err) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (mcpServerId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "mcp-servers"
      ][":mcpServerId"].$delete({ param: { workspaceSlug, mcpServerId } })
      if (!res.ok) throw new Error("Failed to delete server")
    },
    onSuccess: () => {
      invalidate()
      setEditingId(null)
      setDeleteTarget(null)
    },
    onError: () => toast.error("Failed to delete server"),
  })

  const startOAuthMutation = useMutation({
    mutationFn: async (server: McpServerRow) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "mcp-servers"
      ][":mcpServerId"].oauth.start.$post({
        param: { workspaceSlug, mcpServerId: server.id },
        json: { disclosureConfirmed: true },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "OAuth authorization could not start")
      }
      const body = await res.json()
      return { server, authorizationUrl: body.authorizationUrl }
    },
    onSuccess: async ({ server, authorizationUrl }) => {
      setOauthDisclosureTarget(null)
      setDisclosureConfirmed(false)
      setAuthorizationOpenedId(server.id)
      await invalidate()
      openExternal(authorizationUrl)
    },
    onError: (error) => toast.error(error.message),
  })

  const completeOAuthMutation = useMutation({
    mutationFn: async (server: McpServerRow) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "mcp-servers"
      ][":mcpServerId"].oauth.complete.$post({
        param: { workspaceSlug, mcpServerId: server.id },
        json: { enabledTools: [...draft.enabled] },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Tool access could not be saved")
      }
      return (await res.json()).server as McpServerRow
    },
    onSuccess: async (server) => {
      setDraft(draftFromServer(server))
      await invalidate()
      toast.success("MCP tool access updated")
    },
    onError: (error) => toast.error(error.message),
  })

  const disconnectOAuthMutation = useMutation({
    mutationFn: async (server: McpServerRow) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "mcp-servers"
      ][":mcpServerId"].oauth.disconnect.$post({
        param: { workspaceSlug, mcpServerId: server.id },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "OAuth connection could not be removed")
      }
      return (await res.json()).server as McpServerRow
    },
    onSuccess: async (server) => {
      setDisconnectTarget(null)
      setAuthorizationOpenedId(null)
      setDraft(draftFromServer(server))
      await invalidate()
      toast.success("OAuth account disconnected")
    },
    onError: (error) => toast.error(error.message),
  })

  const busy = createMutation.isPending || updateMutation.isPending
  const oauthBusy =
    startOAuthMutation.isPending ||
    completeOAuthMutation.isPending ||
    disconnectOAuthMutation.isPending

  return (
    <>
      {creating && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <HugeiconsIcon
              icon={CloudServerIcon}
              className="size-4"
              strokeWidth={2}
            />
            Connect an MCP server
          </div>
          <ServerEditor
            draft={draft}
            setDraft={(update) => setDraft(update)}
            server={null}
            savedSecretNames={[]}
            busy={busy}
            discovering={discoverMutation.isPending}
            oauthBusy={oauthBusy}
            authorizationOpened={false}
            saveLabel={
              draft.authMode === "oauth" ? "Save & Authorize" : "Connect Server"
            }
            onDiscover={() => discoverMutation.mutate(null)}
            onAuthorize={noop}
            onFinishAuthorization={noop}
            onCompleteOAuth={noop}
            onDisconnectOAuth={noop}
            onSave={() => createMutation.mutate()}
            onCancel={onCloseCreate}
          />
        </div>
      )}

      {servers.length > 0 && (
        <ul className="space-y-2">
          {servers.map((server) => {
            const isEditing = editingId === server.id
            return (
              <li
                key={server.id}
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
                    onCloseCreate()
                    setDraft(draftFromServer(server))
                    setEditingId(server.id)
                  }}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                    <HugeiconsIcon
                      icon={CloudServerIcon}
                      className="size-4.5 text-muted-foreground"
                      strokeWidth={2}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {server.name}
                      </span>
                      <Badge
                        variant="outline"
                        size="sm"
                        className="shrink-0 px-1.5 font-mono font-normal"
                      >
                        MCP
                      </Badge>
                      {server.authMode === "oauth" && (
                        <Badge
                          variant={oauthStatusVariant(server.oauthStatus)}
                          size="sm"
                          className="shrink-0"
                        >
                          {oauthStatusLabel(server.oauthStatus)}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {hostOf(server.url)} · {server.enabledTools.length}{" "}
                      {server.enabledTools.length === 1 ? "tool" : "tools"}{" "}
                      {server.authMode === "oauth" &&
                      server.oauthStatus !== "connected"
                        ? "configured · inactive"
                        : "enabled"}
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
                    <ServerEditor
                      draft={draft}
                      setDraft={(update) => setDraft(update)}
                      server={server}
                      savedSecretNames={server.secretNames}
                      busy={busy}
                      discovering={discoverMutation.isPending}
                      oauthBusy={oauthBusy}
                      authorizationOpened={authorizationOpenedId === server.id}
                      saveLabel="Save Changes"
                      onDiscover={() => discoverMutation.mutate(server.id)}
                      onAuthorize={() => {
                        setDisclosureConfirmed(false)
                        setOauthDisclosureTarget(server)
                      }}
                      onFinishAuthorization={() => {
                        void invalidate().then(() =>
                          toast.info(
                            "If sign-in is complete, tool review will appear here shortly"
                          )
                        )
                      }}
                      onCompleteOAuth={() =>
                        completeOAuthMutation.mutate(server)
                      }
                      onDisconnectOAuth={() => setDisconnectTarget(server)}
                      onSave={() => updateMutation.mutate(server)}
                      onCancel={() => setEditingId(null)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-destructive hover:text-destructive"
                      disabled={deleteMutation.isPending}
                      onClick={() => setDeleteTarget(server)}
                    >
                      Delete Server
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <AlertDialog
        open={oauthDisclosureTarget !== null}
        onOpenChange={(open) => {
          if (open || startOAuthMutation.isPending) return
          setOauthDisclosureTarget(null)
          setDisclosureConfirmed(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share this OAuth account?</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              Every user in a channel whose agent profile grants{" "}
              <span className="font-medium text-foreground">
                {oauthDisclosureTarget?.name}
              </span>{" "}
              can call its enabled MCP tools through the account you sign into.
              Use a team account or another account that is appropriate to share
              with all of those channels.
            </AlertDialogDescription>
            <label
              htmlFor="mcp-oauth-shared-account-confirmation"
              className="mt-2 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3 text-left"
            >
              <Checkbox
                id="mcp-oauth-shared-account-confirmation"
                className="mt-0.5"
                checked={disclosureConfirmed}
                disabled={startOAuthMutation.isPending}
                onCheckedChange={(checked) =>
                  setDisclosureConfirmed(checked === true)
                }
              />
              <span className="text-xs leading-relaxed">
                I understand this is one shared workspace connection, not my
                personal identity, and everyone in assigned channels can use its
                enabled tools.
              </span>
            </label>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              disabled={!disclosureConfirmed}
              loading={startOAuthMutation.isPending}
              onClick={() => {
                if (oauthDisclosureTarget && disclosureConfirmed) {
                  startOAuthMutation.mutate(oauthDisclosureTarget)
                }
              }}
            >
              Continue to sign in
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={disconnectTarget !== null}
        onOpenChange={(open) => {
          if (!open && !disconnectOAuthMutation.isPending) {
            setDisconnectTarget(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect shared account?</AlertDialogTitle>
            <AlertDialogDescription>
              Lor will remove the OAuth credentials and disable every MCP tool
              from {disconnectTarget?.name}. Existing profile assignments stay
              in place, but no channel can use this server until it is
              authorized and reviewed again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={disconnectOAuthMutation.isPending}
              onClick={() => {
                if (disconnectTarget) {
                  disconnectOAuthMutation.mutate(disconnectTarget)
                }
              }}
            >
              Disconnect
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">{deleteTarget?.name}</span>?{" "}
              {deleteTarget && deleteTarget.usedByProfiles > 0
                ? `${deleteTarget.usedByProfiles} agent ${deleteTarget.usedByProfiles === 1 ? "profile grants" : "profiles grant"} it — Merlin loses its tools in those channels immediately. `
                : "Merlin can no longer call its tools. "}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              loading={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
              }}
            >
              Delete Server
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
