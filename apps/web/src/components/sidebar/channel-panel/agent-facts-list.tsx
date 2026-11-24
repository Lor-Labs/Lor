import {
  Cancel01Icon,
  Delete02Icon,
  LockIcon,
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

const agentFactsKey = (agentId: string) => ["agent-facts", agentId] as const

type AgentFact = {
  id: string
  text: string
  source: string
  updatedAt: string
  editedBy: { id: string; name: string } | null
  // The private channel or project it was learned in and stays in.
  privateTo: { id: string; name: string | null } | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

// An agent's facts (reference/always-on-agents.md §7): what it keeps after
// its turns, each with its source and date. One learned in a private channel
// is listed only for that channel's people, marked with where it stays.
// Edits and deletes save at once and reach the agent as a change note on
// its next turn.
export function AgentFactsList({
  workspaceSlug,
  agentId,
  agentName,
}: {
  workspaceSlug: string
  agentId: string
  agentName: string
}) {
  const queryClient = useQueryClient()
  const facts = useQuery({
    queryKey: agentFactsKey(agentId),
    queryFn: async (): Promise<AgentFact[]> => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].facts.$get({ param: { workspaceSlug, agentId } })
      if (!res.ok) throw new Error("Failed to load facts")
      return (await res.json()).facts
    },
  })
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  )

  const save = useMutation({
    mutationFn: async (input: { id: string; text: string }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].facts[":factId"].$patch({
        param: { workspaceSlug, agentId, factId: input.id },
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
      queryClient.setQueryData<AgentFact[]>(agentFactsKey(agentId), (list) =>
        list?.map((fact) => (fact.id === saved.id ? saved : fact))
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].facts[":factId"].$delete({
        param: { workspaceSlug, agentId, factId: id },
      })
      if (!res.ok) throw new Error("Failed to delete the fact")
      return id
    },
    onSuccess: (id) =>
      queryClient.setQueryData<AgentFact[]>(agentFactsKey(agentId), (list) =>
        list?.filter((fact) => fact.id !== id)
      ),
    onError: (error) => toast.error(error.message),
  })

  const list = facts.data ?? []
  return (
    <div>
      {facts.isPending ? (
        <p className="px-4 text-muted-foreground text-sm">Loading…</p>
      ) : facts.isError && list.length === 0 ? (
        <p className="px-4 text-muted-foreground text-sm">
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
        <p className="rounded-xl bg-muted px-4 py-3 text-muted-foreground text-sm dark:bg-muted/60">
          Nothing yet. {agentName} adds facts as it learns how the team works,
          and saves anything you ask it to remember.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl bg-muted px-4 dark:bg-muted/60">
          {list.map((fact) => (
            <li key={fact.id} className="group flex gap-2 py-2.5">
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
                      // Enter that confirms an IME composition isn't a save.
                      if (event.nativeEvent.isComposing) return
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
                    className="h-7 bg-background text-[13px]"
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
                      {fact.privateTo && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5"
                          title={`${agentName} learned this in a private place. It is shown only there, and only its members see it here.`}
                        >
                          <HugeiconsIcon
                            icon={LockIcon}
                            className="size-3"
                            strokeWidth={2}
                          />
                          Only in {fact.privateTo.name ?? "a private channel"}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
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
