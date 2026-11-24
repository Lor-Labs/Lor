import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import PencilEdit02Icon from "@hugeicons/core-free-icons/PencilEdit02Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useThemeColor } from "heroui-native/hooks"
import { Input } from "heroui-native/input"
import { useToast } from "heroui-native/toast"
import { useState } from "react"
import { Alert, Pressable, Text, View } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import { SectionLabel } from "@/components/ui/section-label"
import { Skeleton } from "@/components/ui/skeleton"
import { api, responseMessage } from "@/lib/api"

type AgentFact = {
  id: string
  text: string
  source: string
  updatedAt: string
  editedBy: { id: string; name: string } | null
  // Set once the agent dropped it to make room; such a fact is not listed.
  archivedAt: string | null
}

const agentFactsKey = (agentId: string) => ["agent-facts", agentId] as const

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

// An agent's facts (reference/always-on-agents.md §7): what it keeps after
// its turns, in any channel, each with its source and date. Anyone who sees
// the agent can edit or delete one; it saves at once and reaches the agent as
// a change note on its next turn. As web's agent-facts-list.tsx.
export function AgentFacts({
  workspaceSlug,
  agentId,
  agentName,
}: {
  workspaceSlug: string
  agentId: string
  agentName: string
}) {
  const [foreground, muted, danger] = useThemeColor([
    "foreground",
    "muted",
    "danger",
  ])
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const facts = useQuery({
    queryKey: agentFactsKey(agentId),
    queryFn: async (): Promise<AgentFact[]> => {
      const res = await api.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].facts.$get({ param: { workspaceSlug, agentId } })
      if (!res.ok) throw new Error("Couldn't load the facts")
      // Archived facts are managed on web.
      return (await res.json()).facts.filter((fact) => !fact.archivedAt)
    },
  })
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null
  )

  const save = useMutation({
    mutationFn: async (input: { id: string; text: string }) => {
      const res = await api.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].facts[":factId"].$patch({
        param: { workspaceSlug, agentId, factId: input.id },
        json: { text: input.text },
      })
      if (!res.ok) {
        throw new Error(await responseMessage(res, "Couldn't save the fact"))
      }
      return (await res.json()) as AgentFact
    },
    onSuccess: async (saved, submitted) => {
      // A draft changed while this saved stays open.
      setEditing((current) =>
        current?.id === submitted.id && current.text.trim() === submitted.text
          ? null
          : current
      )
      // A fetch that started before the save would put the old text back.
      await queryClient.cancelQueries({ queryKey: agentFactsKey(agentId) })
      queryClient.setQueryData<AgentFact[]>(agentFactsKey(agentId), (list) =>
        list?.map((fact) => (fact.id === saved.id ? saved : fact))
      )
    },
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: "Fact not saved",
        description: error.message,
      }),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].facts[":factId"].$delete({
        param: { workspaceSlug, agentId, factId: id },
      })
      if (!res.ok) {
        throw new Error(await responseMessage(res, "Couldn't delete the fact"))
      }
      return id
    },
    onSuccess: async (id) => {
      await queryClient.cancelQueries({ queryKey: agentFactsKey(agentId) })
      queryClient.setQueryData<AgentFact[]>(agentFactsKey(agentId), (list) =>
        list?.filter((fact) => fact.id !== id)
      )
    },
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: "Fact not deleted",
        description: error.message,
      }),
  })

  // A stray tap on a phone shouldn't lose a fact, so deleting asks first.
  const confirmDelete = (fact: AgentFact) =>
    Alert.alert("Delete this fact?", fact.text, [
      { style: "cancel", text: "Cancel" },
      {
        style: "destructive",
        text: "Delete",
        onPress: () => remove.mutate(fact.id),
      },
    ])

  const list = facts.data ?? []
  return (
    <View className="gap-two">
      <SectionLabel>
        {list.length > 0 ? `Facts · ${list.length}` : "Facts"}
      </SectionLabel>
      <Text className="text-xs leading-4 text-muted">
        What {agentName} keeps after its turns, in front of it on every turn in
        every channel it is in. Anyone who sees {agentName} can edit or delete
        one.
      </Text>
      {facts.isPending ? (
        <View className="gap-two rounded-lor-lg bg-surface-secondary p-three">
          <Skeleton className="h-3 w-4/5 rounded-full" />
          <Skeleton className="h-3 w-3/5 rounded-full" />
        </View>
      ) : facts.isError && list.length === 0 ? (
        <Pressable
          accessibilityRole="button"
          className="rounded-lor-lg bg-surface-secondary px-three py-three active:opacity-70"
          onPress={() => void facts.refetch()}
        >
          <Text className="text-sm text-muted">
            Couldn't load the facts.{" "}
            <Text className="font-semibold text-foreground">Try again</Text>
          </Text>
        </Pressable>
      ) : list.length === 0 ? (
        <View className="rounded-lor-lg border border-dashed border-separator px-three py-three">
          <Text className="text-sm leading-5 text-muted">
            No facts yet. {agentName} adds them as it learns how the team works,
            and saves anything you ask it to remember.
          </Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
          {list.map((fact, index) => (
            <View key={fact.id}>
              {index > 0 ? (
                <View className="ml-three h-px bg-separator" />
              ) : null}
              {editing?.id === fact.id ? (
                <View className="flex-row items-center gap-one px-two py-two">
                  <Input
                    accessibilityLabel="Fact"
                    autoFocus
                    className="min-w-0 flex-1"
                    isDisabled={save.isPending}
                    maxLength={300}
                    onChangeText={(text) => setEditing({ id: fact.id, text })}
                    onSubmitEditing={() => {
                      const text = editing.text.trim()
                      if (text && !save.isPending) {
                        save.mutate({ id: fact.id, text })
                      }
                    }}
                    returnKeyType="done"
                    value={editing.text}
                  />
                  <IconButton
                    accessibilityLabel="Save fact"
                    isDisabled={save.isPending || !editing.text.trim()}
                    onPress={() =>
                      save.mutate({ id: fact.id, text: editing.text.trim() })
                    }
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      color={foreground}
                      icon={Tick02Icon}
                      size={18}
                    />
                  </IconButton>
                  <IconButton
                    accessibilityLabel="Cancel"
                    onPress={() => setEditing(null)}
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      color={muted}
                      icon={Cancel01Icon}
                      size={18}
                    />
                  </IconButton>
                </View>
              ) : (
                <View className="flex-row items-start gap-one py-two pl-three pr-one">
                  <View className="min-w-0 flex-1 gap-px py-one">
                    <Text className="text-[15px] leading-5 text-foreground">
                      {fact.text}
                    </Text>
                    <Text className="text-xs text-muted">
                      {fact.editedBy
                        ? `Edited by ${fact.editedBy.name}`
                        : fact.source}{" "}
                      · {formatDate(fact.updatedAt)}
                    </Text>
                  </View>
                  <IconButton
                    accessibilityLabel="Edit fact"
                    onPress={() => setEditing({ id: fact.id, text: fact.text })}
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      color={muted}
                      icon={PencilEdit02Icon}
                      size={17}
                    />
                  </IconButton>
                  <IconButton
                    accessibilityLabel="Delete fact"
                    isDisabled={remove.isPending}
                    onPress={() => confirmDelete(fact)}
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      color={danger}
                      icon={Delete02Icon}
                      size={17}
                    />
                  </IconButton>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
