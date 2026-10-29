import {
  ArrowRight01Icon,
  CloudServerIcon,
  Delete02Icon,
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
import { type ReactNode, useEffect, useRef, useState } from "react"
import { PasswordInput } from "@/components/auth/password-input"
import {
  IconTile,
  PILL_BUTTON,
  SettingsBackButton,
  SettingsCard,
  SettingsCardButton,
  SettingsSection,
} from "@/components/workspace/settings-group"
import {
  type PlaceholderItem,
  TemplateInput,
} from "@/components/workspace/template-input"
import { ToolPicker } from "@/components/workspace/tool-picker"
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
type DiscoveredTool = {
  name: string
  description: string
  readOnlyHint?: boolean
}
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
  onDelete,
  deleting,
  oauthSaved = false,
}: {
  draft: ServerDraft
  setDraft: (update: (d: ServerDraft) => ServerDraft) => void
  server: McpServerRow | null
  savedSecretNames: string[]
  busy: boolean
  discovering: boolean
  oauthBusy: boolean
  oauthSaved?: boolean
  authorizationOpened: boolean
  saveLabel: string
  onDiscover: () => void
  onAuthorize: () => void
  onFinishAuthorization: () => void
  onCompleteOAuth: () => void
  onDisconnectOAuth: () => void
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
  deleting?: boolean
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
    invalidSecretNames.length === 0 &&
    duplicateSecretNames.length === 0 &&
    !busy &&
    !oauthBusy
  const canCompleteOAuth =
    oauthCanReview &&
    (draft.discovered !== null || server?.oauthStatus === "connected") &&
    !busy &&
    !discovering &&
    !oauthBusy

  const discoverLabel = draft.discovered
    ? "Refresh tools"
    : isOAuth
      ? "Review tools"
      : "Connect & discover"
  const completeLabel =
    server?.oauthStatus === "connected"
      ? "Save tool access"
      : "Enable selected tools"
  let footerHint: string | null = null
  if (!isOAuth && draft.enabled.size === 0) {
    footerHint =
      "No tools selected. Lor cannot call this server until tools are enabled."
  } else if (isOAuth && !server) {
    footerHint = "Saving continues to the shared-account confirmation."
  }

  return (
    <div className="space-y-8">
      <SettingsSection title="MCP server">
        <SettingsCard>
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              value={draft.name}
              maxLength={80}
              placeholder="Sentry MCP"
              onChange={(e) =>
                setDraft((d) => ({ ...d, name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Description — when should Lor use this?
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
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Authentication">
        <SettingsCard>
          {server ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">
                  {isOAuth ? "OAuth" : "Headers / API key"}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Authentication type is fixed after the server is created.
                </div>
              </div>
              {isOAuth && (
                <Badge
                  variant={oauthStatusVariant(server.oauthStatus)}
                  size="sm"
                >
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
                      "cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors active:scale-[0.99] focus-within:ring-2 focus-within:ring-ring",
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
                    <span className="block text-sm font-medium">
                      {option.title}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {option.description}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
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
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Headers"
        caption={
          <>
            {isOAuth
              ? "Optional request headers. Lor adds OAuth authorization automatically — reference other secrets as "
              : "Sent on every request — reference secrets as "}
            <code className="text-foreground">{"{{secrets.NAME}}"}</code>{" "}
            instead of pasting values.
          </>
        }
      >
        <SettingsCard>
          <PairRows
            pairs={draft.headers}
            onChange={(headers) => setDraft((d) => ({ ...d, headers }))}
            namePlaceholder={isOAuth ? "X-Workspace" : "Authorization"}
            valuePlaceholder={
              isOAuth
                ? "{{secrets.WORKSPACE_ID}}"
                : "Bearer {{secrets.API_KEY}}"
            }
            addLabel="Add header"
            template={{
              secretNames: definedSecretNames,
              onCreatePlaceholder: handleCreatePlaceholder,
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Secrets">
        <SettingsCard className="space-y-3">
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
              {duplicateSecretNames.join(", ")} — duplicate secret name; each
              name can only be defined once (stored secrets included).
            </p>
          )}
        </SettingsCard>
      </SettingsSection>

      {(!isOAuth || oauthCanReview) && (
        <SettingsSection
          title="Tools"
          action={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={cn(PILL_BUTTON, "px-3")}
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
              {discoverLabel}
            </Button>
          }
        >
          {toolList.length === 0 ? (
            <SettingsCard>
              <p className="text-sm text-muted-foreground">
                {isOAuth
                  ? "Review the server’s tools to finish connecting."
                  : "Connect to choose which tools Lor can use."}
              </p>
            </SettingsCard>
          ) : (
            <ToolPicker
              tools={toolList}
              selected={draft.enabled}
              onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
              disabled={busy || oauthBusy}
              providerHints
            />
          )}
          {isOAuth && (
            <div className="flex items-center justify-between gap-3 px-4">
              <p className="text-xs text-muted-foreground">
                Available actions depend on the server’s OAuth permissions.
              </p>
              <Button
                type="button"
                size="sm"
                className={cn(PILL_BUTTON, "px-3")}
                disabled={!canCompleteOAuth}
                loading={oauthBusy}
                success={oauthSaved}
                onClick={onCompleteOAuth}
              >
                {completeLabel}
              </Button>
            </div>
          )}
        </SettingsSection>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {onDelete && (
          <Button
            type="button"
            variant="destructive-outline"
            className={PILL_BUTTON}
            disabled={deleting}
            onClick={onDelete}
          >
            Delete server
          </Button>
        )}
        {footerHint && (
          <span className="text-xs text-muted-foreground">{footerHint}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className={PILL_BUTTON}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className={PILL_BUTTON}
            disabled={!canSave}
            loading={busy}
            onClick={onSave}
          >
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// The Tools tab owns which view is open (list, or one editor); this block owns
// the MCP drafts, OAuth flow, and dialogs, and stays mounted across views so a
// pending authorization keeps polling.
export function McpServersBlock({
  workspaceSlug,
  servers,
  editingId,
  creating,
  listHidden,
  caption,
  onCreate,
  onOpen,
  onClose,
}: {
  workspaceSlug: string
  servers: McpServerRow[]
  // The server whose editor is open; null in the list or while creating.
  editingId: string | null
  creating: boolean
  listHidden: boolean
  caption?: ReactNode
  onCreate: () => void
  onOpen: (serverId: string) => void
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const requestedServerId =
    typeof search.mcpServerId === "string" ? search.mcpServerId : null
  const handledRequestedServerId = useRef<string | null>(null)
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

  // Opening the create editor always starts from a blank draft (the draft is
  // shared with server editing).
  useEffect(() => {
    if (creating) setDraft(emptyDraft())
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
    setDraft(draftFromServer(requestedServer))
    onOpen(requestedServer.id)
    void navigate({
      to: ".",
      replace: true,
      search: (previous) => ({ ...previous, mcpServerId: undefined }),
    })
  }, [navigate, onOpen, requestedServerId, servers])

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: mcpServersQueryKey(workspaceSlug),
      }),
      queryClient.invalidateQueries({
        queryKey: ["agent-profiles", workspaceSlug],
      }),
    ])

  // Refresh the editor only when it still shows the server whose authorization
  // completed. The user may have opened another server while OAuth was pending.
  useEffect(() => {
    if (!authorizationOpenedId) return
    const current = servers.find(
      (server) => server.id === authorizationOpenedId
    )
    if (current && current.oauthStatus !== "pending") {
      setAuthorizationOpenedId(null)
      if (editingId === current.id) setDraft(draftFromServer(current))
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
        // Only initial discovery selects defaults; later refreshes preserve choices.
        enabled:
          mcpServerId || d.discovered !== null
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
      if (server.authMode !== "oauth") {
        onClose()
        return
      }
      setDraft(draftFromServer(server))
      onOpen(server.id)
      setDisclosureConfirmed(false)
      setOauthDisclosureTarget(server)
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
      onClose()
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
      onClose()
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

  const editingServer = editingId
    ? servers.find((server) => server.id === editingId)
    : undefined

  return (
    <>
      {creating && (
        <div className="space-y-5">
          <SettingsBackButton label="All tools" onClick={onClose} />
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
              draft.authMode === "oauth"
                ? "Save and authorize"
                : "Connect server"
            }
            onDiscover={() => discoverMutation.mutate(null)}
            onAuthorize={noop}
            onFinishAuthorization={noop}
            onCompleteOAuth={noop}
            onDisconnectOAuth={noop}
            onSave={() => createMutation.mutate()}
            onCancel={onClose}
          />
        </div>
      )}

      {editingServer && (
        <div className="space-y-5">
          <SettingsBackButton label="All tools" onClick={onClose} />
          <ServerEditor
            draft={draft}
            setDraft={(update) => setDraft(update)}
            server={editingServer}
            savedSecretNames={editingServer.secretNames}
            busy={busy}
            discovering={discoverMutation.isPending}
            oauthBusy={oauthBusy}
            authorizationOpened={authorizationOpenedId === editingServer.id}
            saveLabel="Save"
            onDiscover={() => discoverMutation.mutate(editingServer.id)}
            onAuthorize={() => {
              setDisclosureConfirmed(false)
              setOauthDisclosureTarget(editingServer)
            }}
            onFinishAuthorization={() => {
              void invalidate().then(() =>
                toast.info(
                  "If sign-in is complete, tool review will appear here shortly"
                )
              )
            }}
            oauthSaved={completeOAuthMutation.isSuccess}
            onCompleteOAuth={() => completeOAuthMutation.mutate(editingServer)}
            onDisconnectOAuth={() => setDisconnectTarget(editingServer)}
            onSave={() => updateMutation.mutate(editingServer)}
            onCancel={onClose}
            onDelete={() => setDeleteTarget(editingServer)}
            deleting={deleteMutation.isPending}
          />
        </div>
      )}

      {!listHidden && (
        <SettingsSection
          title="MCP servers"
          count={servers.length}
          action={
            <Button
              variant="secondary"
              size="sm"
              className={cn(PILL_BUTTON, "px-3")}
              data-tool="mcp:new"
              onClick={onCreate}
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Add server
            </Button>
          }
          caption={caption}
        >
          {servers.length === 0 ? (
            <SettingsCard>
              <p className="text-sm text-muted-foreground">
                Connect an MCP server to give Lor the tools it offers.
              </p>
            </SettingsCard>
          ) : (
            <div className="space-y-2">
              {servers.map((server) => (
                <SettingsCardButton
                  key={server.id}
                  data-tool={`mcp:${server.id}`}
                  onClick={() => {
                    setDraft(draftFromServer(server))
                    onOpen(server.id)
                  }}
                >
                  <IconTile>
                    <HugeiconsIcon
                      icon={CloudServerIcon}
                      className="size-5"
                      strokeWidth={2}
                    />
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {server.name}
                      </span>
                      {server.authMode === "oauth" && (
                        <Badge
                          variant={oauthStatusVariant(server.oauthStatus)}
                          size="sm"
                          className="shrink-0"
                        >
                          {oauthStatusLabel(server.oauthStatus)}
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {hostOf(server.url)} · {server.enabledTools.length}{" "}
                      {server.enabledTools.length === 1 ? "tool" : "tools"}{" "}
                      {server.authMode === "oauth" &&
                      server.oauthStatus !== "connected"
                        ? "configured · inactive"
                        : "enabled"}
                    </span>
                  </span>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    className="size-4 shrink-0 text-muted-foreground"
                    strokeWidth={2}
                  />
                </SettingsCardButton>
              ))}
            </div>
          )}
        </SettingsSection>
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
                ? `${deleteTarget.usedByProfiles} agent ${deleteTarget.usedByProfiles === 1 ? "profile grants" : "profiles grant"} it — Lor loses its tools in those channels immediately. `
                : "Lor can no longer call its tools. "}
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
