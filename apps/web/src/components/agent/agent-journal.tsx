import { useQuery } from "@tanstack/react-query"
import { SettingsSection } from "@/components/workspace/settings-group"
import { apiClient } from "@/lib/api-client"

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// An agent's journal (reference/agents-and-chats.md, decision 25): what it
// noted after its turns in every place it works, newest first. Read-only:
// it is how a turn in one place knows what happened in another.
export function AgentJournal({
  workspaceSlug,
  agentId,
  agentName,
}: {
  workspaceSlug: string
  agentId: string
  agentName: string
}) {
  const journal = useQuery({
    queryKey: ["agent-journal", agentId] as const,
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].journal.$get({ param: { workspaceSlug, agentId } })
      if (!res.ok) throw new Error("Failed to load the journal")
      return (await res.json()).entries
    },
  })
  const entries = journal.data ?? []
  return (
    <SettingsSection
      title="Journal"
      caption={`What ${agentName} noted after its turns. It reads the recent entries wherever it works next, so it knows there what you told it here.`}
    >
      {journal.isPending ? (
        <p className="px-4 text-muted-foreground text-sm">Loading…</p>
      ) : journal.isError && entries.length === 0 ? (
        <p className="px-4 text-muted-foreground text-sm">
          Couldn't load the journal.{" "}
          <button
            type="button"
            onClick={() => void journal.refetch()}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </p>
      ) : entries.length === 0 ? (
        <p className="rounded-xl bg-muted px-4 py-3 text-muted-foreground text-sm dark:bg-muted/60">
          Nothing yet. {agentName} adds an entry after a turn worth remembering.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl bg-muted px-4 dark:bg-muted/60">
          {entries.map((entry) => {
            const where = entry.session
              ? `${entry.session.title ?? "A code session"}${entry.channel?.name ? ` in ${entry.channel.name}` : ""}`
              : entry.channel?.name || null
            return (
              <li key={entry.id} className="py-2.5">
                <p className="text-[13px] leading-5">{entry.text}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {[
                    where,
                    entry.user ? `with ${entry.user.name}` : null,
                    formatWhen(entry.createdAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </SettingsSection>
  )
}
