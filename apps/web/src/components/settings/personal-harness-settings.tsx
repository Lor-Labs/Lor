import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDndContext,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DragDropVerticalIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Button } from "@repo/ui/components/button"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { Spinner } from "@repo/ui/components/spinner"
import { Switch } from "@repo/ui/components/switch"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { features } from "@repo/utils/features"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { useReducedMotion } from "motion/react"
import { useId, useState } from "react"
import { HarnessLogo } from "@/components/session/harness-logo"
import {
  type HarnessAccountsData,
  harnessAccountsEndpoint,
  harnessAccountsQueryOptions,
} from "@/hooks/use-harness-accounts"
import {
  useDisconnectChatgptAccount,
  useDisconnectClaudeAccount,
  usePersonalAccounts,
} from "@/hooks/use-personal-accounts"
import { AccountLimit } from "./account-limit"
import { ChatgptConnectDialog } from "./chatgpt-connect-dialog"
import { ClaudeConnectDialog } from "./claude-connect-dialog"

type Provider = "claude" | "chatgpt"
type Account = HarnessAccountsData["personal"][number]
const providerNames = { claude: "Claude Code", chatgpt: "Codex" }
const accountLabel = (account: Account) =>
  account.label ??
  account.email ??
  `${providerNames[account.provider]} · ${account.login}`

export function PersonalHarnessSettings() {
  const { workspaceSlug: activeSlug } = useParams({ strict: false })
  const [selection, setSelection] = useState<string | null>(null)
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const result = await authClient.organization.list()
      if (result.error) throw result.error
      return result.data
    },
  })
  const workspaceSlug = selection ?? activeSlug ?? workspaces.data?.[0]?.slug
  const options = (workspaces.data ?? []).map((workspace) => ({
    value: workspace.slug,
    label: workspace.name,
  }))
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="account-workspace" className="text-sm font-medium">
          Your preferences for
        </label>
        <Select
          value={workspaceSlug ?? null}
          items={options}
          onValueChange={(value) => {
            if (value) setSelection(value)
          }}
          disabled={workspaces.isPending || !options.length}
        >
          <SelectTrigger id="account-workspace" className="w-full">
            <SelectValue placeholder="Choose a workspace" />
          </SelectTrigger>
          <SelectPopup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <p className="text-xs text-muted-foreground">
          Only affects your requests in this workspace. Drag accounts into
          priority order; the first is your default. Other workspaces and
          teammates keep their own preferences.
        </p>
      </div>
      {workspaces.isError ? (
        <div className="space-y-2 text-sm">
          <p>Couldn't load your workspaces.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => workspaces.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : workspaceSlug ? (
        <WorkspaceAccounts key={workspaceSlug} workspaceSlug={workspaceSlug} />
      ) : workspaces.isPending ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Join a workspace to set your account preferences.
          </p>
          <UnscopedAccounts />
        </div>
      )}
    </div>
  )
}

// Without a workspace, linked accounts can still be disconnected.
function UnscopedAccounts() {
  const { data } = usePersonalAccounts()
  const disconnectClaude = useDisconnectClaudeAccount()
  const disconnectCodex = useDisconnectChatgptAccount()
  const pending = disconnectClaude.isPending || disconnectCodex.isPending
  const accounts = [
    ...(data?.claude.accounts ?? []).map((account) => ({
      id: account.id,
      label: account.label ?? `Claude Code · ${account.tokenHint}`,
      disconnect: disconnectClaude,
    })),
    ...(data?.chatgpt.accounts ?? []).map((account) => ({
      id: account.id,
      label: account.label ?? account.email ?? "Codex",
      disconnect: disconnectCodex,
    })),
  ]
  return accounts.map((account) => (
    <div
      key={account.id}
      className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
    >
      <p className="min-w-0 flex-1 truncate text-sm">{account.label}</p>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Disconnect ${account.label}`}
        onClick={() => account.disconnect.mutate(account.id)}
      >
        Disconnect
      </Button>
    </div>
  ))
}

function WorkspaceAccounts({ workspaceSlug }: { workspaceSlug: string }) {
  const query = useQuery(harnessAccountsQueryOptions(workspaceSlug))
  const client = useQueryClient()
  const [connecting, setConnecting] = useState<Provider | null>(null)
  // Kept after close so the dialog's text doesn't change while it fades out.
  const [replacing, setReplacing] = useState<{
    accountId: string
    name: string
  } | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const disconnectClaude = useDisconnectClaudeAccount()
  const disconnectCodex = useDisconnectChatgptAccount()
  const saveAgent = useMutation({
    mutationFn: async (
      defaultHarness: HarnessAccountsData["personalSettings"]["defaultHarness"]
    ) => {
      const res = await harnessAccountsEndpoint["personal-agent"].$put({
        param: { workspaceSlug },
        json: { defaultHarness },
      })
      if (!res.ok) throw new Error("Couldn't save your preferred agent")
      return res.json()
    },
    onSuccess: (data) =>
      client.setQueryData(
        harnessAccountsQueryOptions(workspaceSlug).queryKey,
        data
      ),
    onError: (err) => toast.error(err.message),
  })
  const save = useMutation({
    mutationFn: async (value: {
      provider: Provider
      accountOrder: string[]
      autoFallback: boolean
    }) => {
      const { provider, accountOrder, autoFallback } = value
      const res = await harnessAccountsEndpoint.preferences[":provider"].$put({
        param: { workspaceSlug, provider },
        json: {
          accountId: accountOrder[0] ?? null,
          accountOrder,
          autoFallback,
        },
      })
      if (!res.ok) throw new Error("Couldn't save your account order")
      return res.json()
    },
    onMutate: async (value) => {
      const key = harnessAccountsQueryOptions(workspaceSlug).queryKey
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<HarnessAccountsData>(key)
      if (previous)
        client.setQueryData<HarnessAccountsData>(key, {
          ...previous,
          preferences: {
            ...previous.preferences,
            [value.provider]: {
              accountId: value.accountOrder[0] ?? null,
              accountOrder: value.accountOrder,
              autoFallback: value.autoFallback,
            },
          },
        })
      return { previous }
    },
    onSuccess: (data) => {
      client.setQueryData(
        harnessAccountsQueryOptions(workspaceSlug).queryKey,
        data
      )
      void client.invalidateQueries({ queryKey: ["agent-models"] })
    },
    onError: (err, _value, context) => {
      if (context?.previous)
        client.setQueryData(
          harnessAccountsQueryOptions(workspaceSlug).queryKey,
          context.previous
        )
      toast.error(err.message)
    },
  })
  if (query.isPending) return <Spinner />
  if (query.isError)
    return (
      <div className="space-y-2 text-sm">
        <p>{query.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Try again
        </Button>
      </div>
    )

  const data = query.data
  const agentOptions = [
    { value: "auto", label: "Automatic · your subscriptions" },
    ...(features.claudeCodeHarness
      ? [{ value: "claude_code", label: "Claude Code · your subscription" }]
      : []),
    ...(features.codexHarness
      ? [{ value: "codex", label: "Codex · your subscription" }]
      : []),
    { value: "pi", label: "Lor · API billing" },
  ]
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="personal-request-agent" className="text-sm font-medium">
          Agent for your requests to Lor
        </label>
        <Select
          value={data.personalSettings.defaultHarness}
          items={agentOptions}
          disabled={saveAgent.isPending || save.isPending}
          onValueChange={(value) => {
            if (value)
              saveAgent.mutate(
                value as HarnessAccountsData["personalSettings"]["defaultHarness"]
              )
          }}
        >
          <SelectTrigger id="personal-request-agent" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {agentOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <p className="text-xs text-muted-foreground">
          {data.personalSettings.defaultHarness === "auto"
            ? "Automatic uses your Claude Code subscription first, then Codex if you have no Claude account, or API billing if neither is linked."
            : data.personalSettings.defaultHarness === "pi"
              ? "Requests you send to Lor in this workspace use API billing."
              : `Requests you send to Lor in this workspace use your ${data.personalSettings.defaultHarness === "claude_code" ? "Claude Code" : "Codex"} accounts below.`}{" "}
          Coding sessions use the agent selected for that session.
        </p>
      </div>
      {(["claude", "chatgpt"] as const).map((provider) => {
        const enabled =
          provider === "claude"
            ? features.claudeCodeHarness
            : features.codexHarness
        const accounts = data.personal.filter(
          (account) => account.provider === provider
        )
        if (!enabled && !accounts.length) return null
        const pref = data.preferences[provider]
        const ids = pref.accountOrder ?? accounts.map((account) => account.id)
        const ordered = ids.flatMap((id) =>
          accounts.filter((account) => account.id === id)
        )
        const pending =
          save.isPending ||
          saveAgent.isPending ||
          disconnectClaude.isPending ||
          disconnectCodex.isPending
        return (
          <div key={provider} className="space-y-3">
            <div className="flex items-center gap-3">
              <HarnessLogo
                harness={provider === "claude" ? "claude_code" : "codex"}
                className="size-5"
              />
              <h4 className="flex-1 text-sm font-medium">
                {providerNames[provider]}
              </h4>
              <Button
                variant="outline"
                size="sm"
                disabled={!enabled || pending}
                onClick={() => setConnecting(provider)}
              >
                Add account
              </Button>
            </div>
            {ordered.length ? (
              <AccountOrder
                provider={provider}
                accounts={ordered}
                disabled={pending}
                fallback={pref.autoFallback}
                onReorder={(accountOrder) =>
                  save.mutate({
                    provider,
                    accountOrder,
                    autoFallback: pref.autoFallback,
                  })
                }
                onDisconnect={(id) =>
                  (provider === "claude"
                    ? disconnectClaude
                    : disconnectCodex
                  ).mutate(id)
                }
                onReplace={
                  provider === "claude"
                    ? (account) => {
                        setReplacing({
                          accountId: account.id,
                          name: accountLabel(account),
                        })
                        setReplaceOpen(true)
                      }
                    : undefined
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No {providerNames[provider]} accounts connected.
              </p>
            )}
            <FallbackToggle
              provider={provider}
              checked={pref.autoFallback}
              disabled={pending || ordered.length < 2}
              onChange={(autoFallback) =>
                save.mutate({ provider, accountOrder: ids, autoFallback })
              }
            />
          </div>
        )
      })}
      <output className="block text-xs text-muted-foreground">
        {save.isPending || saveAgent.isPending
          ? "Saving your preferences…"
          : "Changes save automatically. Disconnecting an account removes it from all your workspaces."}
      </output>
      <ClaudeConnectDialog
        open={connecting === "claude"}
        onOpenChange={(open) => !open && setConnecting(null)}
      />
      <ClaudeConnectDialog
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        replace={replacing ?? undefined}
      />
      <ChatgptConnectDialog
        open={connecting === "chatgpt"}
        onOpenChange={(open) => !open && setConnecting(null)}
      />
    </div>
  )
}

function AccountOrder({
  provider,
  accounts,
  disabled,
  fallback,
  onReorder,
  onDisconnect,
  onReplace,
}: {
  provider: Provider
  accounts: Account[]
  disabled: boolean
  fallback: boolean
  onReorder: (ids: string[]) => void
  onDisconnect: (id: string) => void
  onReplace?: (account: Account) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const ids = accounts.map((account) => account.id)
  const nameFor = (id: string | number) => {
    const account = accounts.find((item) => item.id === String(id))
    return account ? accountLabel(account) : "Account"
  }
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!disabled && over && active.id !== over.id) {
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from >= 0 && to >= 0) onReorder(arrayMove(ids, from, to))
    }
  }
  return (
    <DndContext
      id={`account-order-${provider}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={reorder}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${nameFor(active.id)}, priority ${ids.indexOf(String(active.id)) + 1} of ${ids.length}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${nameFor(active.id)}, priority ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${nameFor(active.id)} at priority ${ids.indexOf(String(over.id)) + 1}.`
              : "Order unchanged.",
          onDragCancel: () => "Reordering cancelled. Order unchanged.",
        },
        screenReaderInstructions: {
          draggable:
            "Press Space to pick up an account, Up or Down to move it, Space to save its position, or Escape to cancel.",
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol
          className="space-y-2"
          aria-label={`${providerNames[provider]} account priority`}
        >
          {accounts.map((account, index) => (
            <AccountRow
              key={account.id}
              account={account}
              position={index}
              disabled={disabled || accounts.length < 2}
              fallback={fallback}
              onDisconnect={() => onDisconnect(account.id)}
              onReplace={onReplace && (() => onReplace(account))}
              disconnectDisabled={disabled}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function AccountRow({
  account,
  position,
  disabled,
  disconnectDisabled,
  fallback,
  onDisconnect,
  onReplace,
}: {
  account: Account
  position: number
  disabled: boolean
  disconnectDisabled: boolean
  fallback: boolean
  onDisconnect: () => void
  onReplace?: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: account.id, disabled })
  const { activatorEvent } = useDndContext()
  const reducedMotion = useReducedMotion()
  const label = accountLabel(account)
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition:
          reducedMotion || activatorEvent?.type === "keydown"
            ? undefined
            : transition,
      }}
      className={cn(
        "relative flex items-center gap-2 rounded-lg border bg-background py-2 pr-3",
        isDragging && "z-10 shadow-md ring-1 ring-ring"
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Move ${label}, priority ${position + 1}`}
        className="flex size-11 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 cursor-grab active:cursor-grabbing disabled:cursor-default"
      >
        <HugeiconsIcon icon={DragDropVerticalIcon} className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="truncate text-sm font-medium">{label}</p>
          <span className="text-xs text-muted-foreground">
            {position === 0
              ? "Default"
              : fallback
                ? `Fallback ${position}`
                : "Fallback off"}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {account.email ?? `Token ending ${account.login}`}
        </p>
        <AccountLimit until={account.unavailableUntil} />
      </div>
      {onReplace && (
        <Button
          variant="ghost"
          size="sm"
          disabled={disconnectDisabled}
          aria-label={`Replace token for ${label}`}
          onClick={onReplace}
        >
          Replace token
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={disconnectDisabled}
        aria-label={`Disconnect ${label}`}
        onClick={onDisconnect}
      >
        Disconnect
      </Button>
    </li>
  )
}

function FallbackToggle({
  provider,
  checked,
  disabled,
  onChange,
}: {
  provider: Provider
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-4">
      <span className="text-xs text-muted-foreground">
        When usage runs out, try the next {providerNames[provider]} account in
        this order.
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={`Automatically use the next ${providerNames[provider]} account`}
      />
    </label>
  )
}
