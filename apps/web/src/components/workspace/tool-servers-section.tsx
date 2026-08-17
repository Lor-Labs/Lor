import {
  ArrowDown01Icon,
  CloudServerIcon,
  PlusSignIcon,
  RotateClockwiseIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
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
import { useEffect, useState } from "react"
import { PasswordInput } from "@/components/auth/password-input"
import {
  type PlaceholderItem,
  TemplateInput,
} from "@/components/workspace/template-input"
import { apiClient } from "@/lib/api-client"

// MCP tool servers: the second kind of workspace tool (next to API tools).
// The server owns its tool list — the form's job is connection settings plus
// the enabledTools allowlist, populated by "Connect & discover".

export type ToolServerRow = {
  id: string
  name: string
  description: string
  url: string
  headers: Record<string, string>
  secretNames: string[]
  enabledTools: string[]
  usedByProfiles: number
  createdAt: string
  updatedAt: string
}

export function toolServersQueryKey(workspaceSlug: string) {
  return ["tool-servers", workspaceSlug]
}

export function useToolServers(workspaceSlug: string) {
  return useQuery({
    queryKey: toolServersQueryKey(workspaceSlug),
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "tool-servers"
      ].$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load tool servers")
      return res.json()
    },
  })
}

type Pair = { name: string; value: string }
type DiscoveredTool = { name: string; description: string }

type ServerDraft = {
  name: string
  description: string
  url: string
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
    headers: [],
    keptSecretNames: [],
    updatedSecrets: [],
    newSecrets: [],
    enabled: new Set(),
    discovered: null,
  }
}

function draftFromServer(server: ToolServerRow): ServerDraft {
  return {
    name: server.name,
    description: server.description,
    url: server.url,
    headers: Object.entries(server.headers).map(([name, value]) => ({
      name,
      value,
    })),
    keptSecretNames: [...server.secretNames],
    updatedSecrets: [],
    newSecrets: [],
    enabled: new Set(server.enabledTools),
    discovered: null,
  }
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

function ServerEditor({
  draft,
  setDraft,
  savedSecretNames,
  busy,
  discovering,
  saveLabel,
  onDiscover,
  onSave,
  onCancel,
}: {
  draft: ServerDraft
  setDraft: (update: (d: ServerDraft) => ServerDraft) => void
  savedSecretNames: string[]
  busy: boolean
  discovering: boolean
  saveLabel: string
  onDiscover: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const canDiscover = draft.url.trim().length > 0 && !discovering && !busy
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
    draft.enabled.size > 0 &&
    !busy

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

      <div className="space-y-1.5">
        <Label className="text-xs">Headers</Label>
        <p className="text-[11px] text-muted-foreground">
          Sent on every request — reference secrets as{" "}
          <code className="text-foreground">{"{{secrets.NAME}}"}</code> instead
          of pasting values.
        </p>
        <PairRows
          pairs={draft.headers}
          onChange={(headers) => setDraft((d) => ({ ...d, headers }))}
          namePlaceholder="Authorization"
          valuePlaceholder="Bearer {{secrets.API_KEY}}"
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
      </div>

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
            {draft.discovered ? "Refresh tools" : "Connect & discover"}
          </Button>
        </div>
        {toolList.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Connect to list the server's tools, then pick which ones Merlin may
            call. New tools the server adds later stay off until enabled here.
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
                    disabled={busy}
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
                    <span className="block font-mono text-xs">{tool.name}</span>
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
      </div>

      <div className="flex items-center justify-end gap-2 border-border border-t pt-3">
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
  servers: ToolServerRow[]
  creating: boolean
  onCloseCreate: () => void
}) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ServerDraft>(emptyDraft())
  const [deleteTarget, setDeleteTarget] = useState<ToolServerRow | null>(null)

  // Opening the create card always starts from a blank draft (the draft is
  // shared with row editing).
  useEffect(() => {
    if (creating) {
      setDraft(emptyDraft())
      setEditingId(null)
    }
  }, [creating])

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: toolServersQueryKey(workspaceSlug),
    })

  const discoverMutation = useMutation({
    mutationFn: async (serverId: string | null) => {
      const base = apiClient.v1.workspaces[":workspaceSlug"]["tool-servers"]
      const res = serverId
        ? await base[":serverId"].discover.$post({
            param: { workspaceSlug, serverId },
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
    onSuccess: ({ tools }, serverId) => {
      setDraft((d) => ({
        ...d,
        discovered: tools,
        // Fresh connections opt everything in (saving is the explicit
        // allowlist act); refreshes keep the current selection.
        enabled: serverId
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

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "tool-servers"
      ].$post({
        param: { workspaceSlug },
        json: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          url: draft.url.trim(),
          headers: draftHeaders(draft),
          secrets: newSecretsPayload(draft),
          enabledTools: [...draft.enabled],
        },
      })
      if (!res.ok) {
        const body = (await res.json()) as { message?: string }
        throw new Error(body.message ?? "Failed to connect server")
      }
      return res.json()
    },
    onSuccess: async () => {
      await invalidate()
      onCloseCreate()
    },
    onError: (err) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: async (server: ToolServerRow) => {
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
        "tool-servers"
      ][":serverId"].$patch({
        param: { workspaceSlug, serverId: server.id },
        json: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          url: draft.url.trim(),
          headers: draftHeaders(draft),
          secrets,
          enabledTools: [...draft.enabled],
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
    mutationFn: async (serverId: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "tool-servers"
      ][":serverId"].$delete({ param: { workspaceSlug, serverId } })
      if (!res.ok) throw new Error("Failed to delete server")
    },
    onSuccess: () => {
      invalidate()
      setEditingId(null)
      setDeleteTarget(null)
    },
    onError: () => toast.error("Failed to delete server"),
  })

  const busy = createMutation.isPending || updateMutation.isPending

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
            savedSecretNames={[]}
            busy={busy}
            discovering={discoverMutation.isPending}
            saveLabel="Connect Server"
            onDiscover={() => discoverMutation.mutate(null)}
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
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {hostOf(server.url)} · {server.enabledTools.length}{" "}
                      {server.enabledTools.length === 1 ? "tool" : "tools"}{" "}
                      enabled
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
                      savedSecretNames={server.secretNames}
                      busy={busy}
                      discovering={discoverMutation.isPending}
                      saveLabel="Save Changes"
                      onDiscover={() => discoverMutation.mutate(server.id)}
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
