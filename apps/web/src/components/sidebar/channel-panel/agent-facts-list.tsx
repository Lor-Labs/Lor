import {
  Cancel01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiClient } from "@/lib/api-client"

const agentFactsKey = (channelId: string) =>
  ["channel-agent-facts", channelId] as const

type AgentFact = {
  id: string
  text: string
  source: string
  updatedAt: string
  editedBy: { id: string; name: string } | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

// The channel agent's facts (reference/always-on-agents.md §7): what Lor
// keeps after its turns, each with its source and date. Edits and deletes
// save at once, apart from the dialog's Save, and reach the agent as a change
// note on its next turn.
export function AgentFactsList({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const queryClient = useQueryClient()
  const facts = useQuery({
    queryKey: agentFactsKey(channelId),
    queryFn: async (): Promise<AgentFact[]> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["agent-facts"].$get({ param: { workspaceSlug, channelId } })
      if (!res.ok) throw new Error("Failed to load facts")
      return (await res.json()).facts
    },
  })
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  )

  const save = useMutation({
    mutationFn: async (input: { id: string; text: string }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["agent-facts"][":factId"].$patch({
        param: { workspaceSlug, channelId, factId: input.id },
        json: { text: input.text },
      })
      if (!res.ok) throw new Error("Failed to save the fact")
      return (await res.json()) as AgentFact
    },
    onSuccess: (saved, submitted) => {
      // A draft started or changed while this saved stays open.
      setEditing((current) =>
        current?.id === submitted.id && current.text.trim() === submitted.text
          ? null
          : current
      )
      queryClient.setQueryData<AgentFact[]>(agentFactsKey(channelId), (list) =>
        list?.map((fact) => (fact.id === saved.id ? saved : fact))
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ]["agent-facts"][":factId"].$delete({
        param: { workspaceSlug, channelId, factId: id },
      })
      if (!res.ok) throw new Error("Failed to delete the fact")
      return id
    },
    onSuccess: (id) =>
      queryClient.setQueryData<AgentFact[]>(agentFactsKey(channelId), (list) =>
        list?.filter((fact) => fact.id !== id)
      ),
    onError: (error) => toast.error(error.message),
  })

  const list = facts.data ?? []
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-sm">Facts</span>
        {list.length > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {list.length}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        What Lor keeps about this channel after its turns, in front of it on
        every turn. Anyone here can edit or delete one.
      </p>
      {facts.isPending ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : facts.isError && list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Couldn't load the facts.{" "}
          <button
            type="button"
            onClick={() => void facts.refetch()}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-md border border-border/70 border-dashed px-3 py-2 text-xs text-muted-foreground">
          No facts yet. Lor adds them as it learns how this channel works, and
          saves anything you ask it to remember.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border/70">
          {list.map((fact) => (
            <li key={fact.id} className="group flex gap-2 px-3 py-2">
              {editing?.id === fact.id ? (
                // Not a form: the settings dialog around it is one.
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <Input
                    autoFocus
                    aria-label="Fact"
                    value={editing.text}
                    maxLength={300}
                    disabled={save.isPending}
                    onChange={(event) =>
                      setEditing({ id: fact.id, text: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        const text = editing.text.trim()
                        if (text && !save.isPending) {
                          save.mutate({ id: fact.id, text })
                        }
                      } else if (event.key === "Escape") {
                        event.stopPropagation()
                        setEditing(null)
                      }
                    }}
                    className="h-7 text-[13px]"
                  />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Save fact"
                    disabled={save.isPending || !editing.text.trim()}
                    onClick={() =>
                      save.mutate({ id: fact.id, text: editing.text.trim() })
                    }
                  >
                    <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Cancel"
                    onClick={() => setEditing(null)}
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-5">{fact.text}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {fact.editedBy
                        ? `Edited by ${fact.editedBy.name}`
                        : fact.source}{" "}
                      · {formatDate(fact.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Edit fact"
                      onClick={() =>
                        setEditing({ id: fact.id, text: fact.text })
                      }
                    >
                      <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Delete fact"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(fact.id)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
