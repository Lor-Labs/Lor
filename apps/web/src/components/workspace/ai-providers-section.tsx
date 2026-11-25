import { ArrowRight01Icon, SquareLock02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Skeleton } from "@repo/ui/components/skeleton"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { formatDate } from "@repo/utils/date"
import {
  KEY_PROVIDER_NAMES,
  KEY_PROVIDERS,
  type KeyProvider,
} from "@repo/utils/inference"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { InlineConfirmButton } from "@/components/ui/inline-confirm-button"
import { AiProviderDialog } from "./ai-provider-dialog"
import {
  AI_PROVIDER_INFO,
  AiProviderLogo,
  type AiProvidersData,
  aiProvidersEndpoint,
  aiProvidersQueryKey,
  fetchAiProviders,
  type SavedAiProvider,
  savedSummary,
} from "./ai-provider-meta"
import {
  IconTile,
  PILL_BUTTON,
  SETTINGS_SURFACE,
  SettingsGroup,
  SettingsSection,
} from "./settings-group"

// The workspace's own model provider accounts. Each connected provider's
// models appear in the composer's model picker under its name and run on
// it; see reference/beta-pricing-runbook.md (BYOK).

export function AiProvidersSection({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const client = useQueryClient()
  const queryKey = aiProvidersQueryKey(workspaceSlug)
  const { data, isError } = useQuery({
    queryKey,
    queryFn: () => fetchAiProviders(workspaceSlug),
  })
  const [open, setOpen] = useState<KeyProvider | null>(null)
  // Kept after closing so the dialog keeps its content while it animates out.
  const [shown, setShown] = useState<KeyProvider>("anthropic")
  const [formKey, setFormKey] = useState(0)
  const onChange = (next: AiProvidersData) => {
    client.setQueryData(queryKey, next)
    void client.invalidateQueries({ queryKey: ["agent-models"] })
  }
  const openDialog = (provider: KeyProvider) => {
    setShown(provider)
    setFormKey((key) => key + 1)
    setOpen(provider)
  }

  if (isError)
    return (
      <p className="px-4 text-sm text-muted-foreground">
        Couldn't load AI providers. Try reopening settings.
      </p>
    )
  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid gap-2 sm:grid-cols-2">
          {KEY_PROVIDERS.map((provider) => (
            <Skeleton key={provider} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    )

  const savedOf = (provider: KeyProvider) =>
    data.providers.find((item) => item.provider === provider)
  const connected = KEY_PROVIDERS.filter((provider) => savedOf(provider))
  const available = KEY_PROVIDERS.filter((provider) => !savedOf(provider))

  return (
    <div className="space-y-8">
      <p className="px-4 text-sm leading-relaxed text-muted-foreground">
        Run Lor on your team's own model provider accounts. Their models show up
        in the model picker under the provider's name. The provider bills you
        for usage, and Lor only charges a small platform fee from your credits.
      </p>
      {data.locked && (
        <div
          className={cn(
            SETTINGS_SURFACE,
            "flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground"
          )}
        >
          <HugeiconsIcon
            icon={SquareLock02Icon}
            className="size-4 shrink-0"
            strokeWidth={2}
          />
          This team's beta has ended. You can remove providers, but not add or
          change them.
        </div>
      )}
      {connected.length > 0 && (
        <SettingsSection title="Connected" count={connected.length}>
          <SettingsGroup>
            {connected.map((provider) => {
              const saved = savedOf(provider)
              return saved ? (
                <ConnectedRow
                  key={provider}
                  saved={saved}
                  workspaceSlug={workspaceSlug}
                  locked={data.locked}
                  onEdit={() => openDialog(provider)}
                  onChange={onChange}
                />
              ) : null
            })}
          </SettingsGroup>
        </SettingsSection>
      )}
      {available.length > 0 && (
        <SettingsSection
          title={connected.length > 0 ? "Add a provider" : "Providers"}
          caption="Credentials are stored encrypted. Lor checks them with the provider before saving."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((provider) => (
              <ProviderCard
                key={provider}
                provider={provider}
                disabled={data.locked}
                onClick={() => openDialog(provider)}
              />
            ))}
          </div>
        </SettingsSection>
      )}
      <AiProviderDialog
        provider={shown}
        open={open !== null}
        formKey={formKey}
        onOpenChange={(value) => {
          if (!value) setOpen(null)
        }}
        saved={savedOf(shown)}
        azureModels={data.azureModels}
        workspaceSlug={workspaceSlug}
        onSaved={(next) => {
          onChange(next)
          setOpen(null)
        }}
      />
    </div>
  )
}

function ProviderCard({
  provider,
  disabled,
  onClick,
}: {
  provider: KeyProvider
  disabled: boolean
  onClick: () => void
}) {
  const info = AI_PROVIDER_INFO[provider]
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Connect ${KEY_PROVIDER_NAMES[provider]}`}
      onClick={onClick}
      className={cn(
        SETTINGS_SURFACE,
        "group flex cursor-pointer flex-col gap-3 p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60 disabled:hover:bg-muted dark:hover:bg-muted"
      )}
    >
      <span className="flex items-center justify-between">
        <IconTile>
          <AiProviderLogo provider={provider} />
        </IconTile>
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:hidden">
          Connect
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-3.5"
            strokeWidth={2}
          />
        </span>
      </span>
      <span className="space-y-1">
        <span className="block text-sm font-medium">
          {KEY_PROVIDER_NAMES[provider]}
        </span>
        <span className="block text-xs leading-relaxed text-muted-foreground">
          {info.blurb}
        </span>
        <span className="block text-xs text-muted-foreground/70">
          {info.credential}
        </span>
      </span>
    </button>
  )
}

function ConnectedRow({
  saved,
  workspaceSlug,
  locked,
  onEdit,
  onChange,
}: {
  saved: SavedAiProvider
  workspaceSlug: string
  locked: boolean
  onEdit: () => void
  onChange: (next: AiProvidersData) => void
}) {
  const name = KEY_PROVIDER_NAMES[saved.provider]
  const remove = async () => {
    const res = await aiProvidersEndpoint[":provider"].$delete({
      param: { workspaceSlug, provider: saved.provider },
    })
    if (!res.ok) {
      toast.error(`Couldn't remove ${name}`)
      throw new Error("Remove failed")
    }
    onChange(await res.json())
    toast.success(`${name} removed`)
  }
  return (
    <div className="flex items-center gap-3 py-3">
      <IconTile>
        <AiProviderLogo provider={saved.provider} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm">
          {name}
          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none text-success-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Connected
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {savedSummary(saved)}
        </p>
        <p className="truncate text-xs text-muted-foreground/70">
          Added by {saved.createdBy ?? "a former member"} on{" "}
          {formatDate(saved.createdAt)}
        </p>
      </div>
      {!locked && (
        <Button
          variant="secondary"
          size="sm"
          className={PILL_BUTTON}
          onClick={onEdit}
        >
          Edit
        </Button>
      )}
      <InlineConfirmButton
        label={`Remove ${name}`}
        confirmLabel="Remove"
        onConfirm={remove}
      />
    </div>
  )
}
