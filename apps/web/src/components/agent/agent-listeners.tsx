import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  SettingsAction,
  SettingsCard,
  SettingsGroup,
  SettingsSection,
} from "@/components/workspace/settings-group"
import type { WorkspaceAgent } from "@/hooks/use-agents"
import { connectorLogo } from "@/lib/connector-ui"
import { integrationsQueryOptions } from "@/lib/integrations-query"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels-query"

// What an agent listens to (reference/agents-and-chats.md, decision 40): the
// connector events it is woken by, each with the chat it reports in. A row
// opens its connector in settings, where listeners are added and removed.
// Custom webhooks have a tab of their own (AgentWebhooks).
export function AgentListeners({
  workspaceSlug,
  agent,
}: {
  workspaceSlug: string
  agent: WorkspaceAgent
}) {
  const navigate = useNavigate()
  const { data } = useQuery(integrationsQueryOptions(workspaceSlug))
  const { data: list } = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  const chats = new Map(
    (list ? openTextChannels(list) : []).map((chat) => [chat.id, chat.name])
  )
  // Settings open over this page, on the connector when one is named.
  const openConnectors = (connector?: string) =>
    void navigate({
      to: ".",
      search: (prev) => ({
        ...prev,
        settings: "workspace",
        tab: "connectors",
        connector,
      }),
    })
  const listeners = (data?.providers ?? []).flatMap((provider) =>
    provider.events.flatMap((event) =>
      event.listeners
        .filter((listener) => listener.agentId === agent.id)
        .map((listener) => ({ provider, event, listener }))
    )
  )
  if (!data) {
    return <p className="px-4 text-muted-foreground text-sm">Loading…</p>
  }
  return (
    <SettingsSection
      title="Listens to"
      count={listeners.length || undefined}
      action={
        <SettingsAction onClick={() => openConnectors()}>
          Connectors
        </SettingsAction>
      }
    >
      {listeners.length === 0 ? (
        <SettingsCard className="py-8 text-center">
          <p className="text-sm">No events yet</p>
          <p className="text-muted-foreground text-xs">
            Open a connector and add {agent.name} to the events it should hear.
          </p>
        </SettingsCard>
      ) : (
        <SettingsGroup>
          {listeners.map(({ provider, event, listener }) => {
            const Logo = connectorLogo(provider.id)
            return (
              <button
                key={listener.id}
                type="button"
                onClick={() => openConnectors(provider.id)}
                className="group flex min-h-14 w-full cursor-pointer items-center gap-3 text-left outline-none focus-visible:[&_[data-name]]:underline"
              >
                <Logo className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span
                    data-name
                    className="block truncate font-medium text-sm"
                  >
                    {provider.name}: {event.label}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {listener.filter ? `Only when ${listener.filter}. ` : ""}
                    Reports in {chats.get(listener.channelId) ?? "its chat"}
                  </span>
                </span>
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={16}
                  className="shrink-0 text-muted-foreground/60 transition-[color,transform] duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground"
                />
              </button>
            )
          })}
        </SettingsGroup>
      )}
    </SettingsSection>
  )
}
