import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { diffLines } from "diff"
import { router, useLocalSearchParams } from "expo-router"
import { SymbolView } from "expo-symbols"
import { useThemeColor } from "heroui-native/hooks"
import { useToast } from "heroui-native/toast"
import { useMemo } from "react"
import { ScrollView, Text, View } from "react-native"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Screen } from "@/components/ui/screen"
import { Skeleton } from "@/components/ui/skeleton"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { api, responseMessage } from "@/lib/api"
import type { WorkspaceInstructions } from "@/lib/api-types"

type DiffRow = { type: "same" | "add" | "del"; text: string }

function toDiffRows(before: string, after: string): DiffRow[] {
  return diffLines(before, after).flatMap((change) => {
    const type = change.added ? "add" : change.removed ? "del" : "same"
    const lines = change.value.split("\n")
    if (lines.at(-1) === "") lines.pop()
    return lines.map((text) => ({ type: type as DiffRow["type"], text }))
  })
}

function DiffView({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => toDiffRows(before, after), [before, after])
  return (
    <View className="gap-px rounded-lor-md border border-border bg-surface p-three">
      {rows.map((row, index) => (
        <Text
          className={
            row.type === "add"
              ? "text-xs text-success"
              : row.type === "del"
                ? "text-xs text-danger line-through"
                : "text-xs text-muted"
          }
          key={`${index}-${row.text}`}
        >
          {row.type === "add" ? "+ " : row.type === "del" ? "- " : "  "}
          {row.text || " "}
        </Text>
      ))}
    </View>
  )
}

export default function InstructionsApprovalScreen() {
  const foreground = useThemeColor("foreground")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { workspace } = useWorkspace()
  const params = useLocalSearchParams<{ workspaceSlug?: string }>()
  const workspaceSlug = params.workspaceSlug ?? workspace?.slug ?? null

  const instructionsQuery = useQuery({
    enabled: workspaceSlug !== null,
    queryKey: ["workspace-instructions", workspaceSlug],
    queryFn: async (): Promise<WorkspaceInstructions> => {
      const response = await api.v1.workspaces[
        ":workspaceSlug"
      ].instructions.$get({ param: { workspaceSlug: workspaceSlug ?? "" } })
      if (!response.ok) throw new Error("Could not load instructions")
      return response.json()
    },
  })
  const data = instructionsQuery.data ?? null

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["workspace-instructions", workspaceSlug],
    })

  const resolve = useMutation({
    mutationFn: async (input: {
      version: number
      action: "approve" | "reject"
    }) => {
      const client =
        api.v1.workspaces[":workspaceSlug"].instructions[":version"]
      const request =
        input.action === "approve" ? client.approve.$post : client.reject.$post
      const response = await request({
        param: {
          workspaceSlug: workspaceSlug ?? "",
          version: String(input.version),
        },
      })
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "Could not update the proposal")
        )
      }
      return input.action
    },
    onSuccess: (action) => {
      toast.show({
        variant: "success",
        label: action === "approve" ? "Proposal approved" : "Proposal rejected",
      })
      void invalidate()
    },
    onError: (error) => {
      toast.show({
        variant: "danger",
        label: "Proposal not updated",
        description: error.message,
      })
      void invalidate()
    },
  })

  const pending = data?.pending ?? null
  const activeContent = data?.active?.content ?? ""
  const pendingIsStale =
    pending !== null && pending.baseVersion !== (data?.active?.version ?? null)

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[60px] flex-row items-center gap-two border-b border-separator px-three">
        <IconButton
          accessibilityLabel="Back"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/" as never)
          }
          variant="ghost"
        >
          <SymbolView
            name={{
              ios: "chevron.left",
              android: "arrow_back",
              web: "arrow_back",
            }}
            size={21}
            tintColor={foreground}
          />
        </IconButton>
        <Text className="flex-1 text-[17px] font-bold text-foreground">
          Merlin Instructions
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-five px-four pb-eight pt-five"
        showsVerticalScrollIndicator={false}
      >
        {instructionsQuery.isPending ? (
          <View className="gap-three">
            <Skeleton className="h-2.5 w-48 rounded-full" />
            <Skeleton className="h-40 rounded-lor-md" />
            <Skeleton className="h-11 rounded-lor-sm" />
          </View>
        ) : instructionsQuery.isError || !data ? (
          <StatePanel
            action={{
              label: "Try again",
              onPress: () => void instructionsQuery.refetch(),
            }}
            detail={instructionsQuery.error?.message ?? "Please try again."}
            status="danger"
            title="Instructions are unavailable"
          />
        ) : pending ? (
          <>
            <View className="gap-px">
              <Text className="text-[15px] font-semibold text-foreground">
                Merlin proposed an update
              </Text>
              <Text className="text-xs text-muted">
                v{pending.version} ·{" "}
                {new Date(pending.createdAt).toLocaleString()} · pending
                approval
              </Text>
            </View>
            {pending.rationale ? (
              <Text className="text-sm text-foreground">
                {pending.rationale}
              </Text>
            ) : null}
            {pendingIsStale ? (
              <StatePanel
                detail="The active instructions changed after this was proposed, so approving is blocked. Reject it, or re-apply what's still wanted from the web editor."
                status="danger"
                title="Proposal is out of date"
              />
            ) : null}
            <DiffView after={pending.content} before={activeContent} />
            {data.canManage ? (
              <View className="gap-two">
                <Button
                  isDisabled={resolve.isPending || pendingIsStale}
                  onPress={() =>
                    resolve.mutate({
                      version: pending.version,
                      action: "approve",
                    })
                  }
                >
                  {resolve.isPending ? "Working…" : "Approve"}
                </Button>
                <Button
                  isDisabled={resolve.isPending}
                  onPress={() =>
                    resolve.mutate({
                      version: pending.version,
                      action: "reject",
                    })
                  }
                  variant="secondary"
                >
                  Reject
                </Button>
              </View>
            ) : (
              <Text className="text-xs text-muted">
                Only workspace owners and admins can approve or reject
                proposals.
              </Text>
            )}
          </>
        ) : (
          <>
            <StatePanel
              detail="There's no proposal waiting for review. The current instructions are below."
              status="success"
              title="Nothing pending"
            />
            {activeContent ? (
              <View className="rounded-lor-md border border-border bg-surface p-three">
                <Text className="text-xs text-foreground">{activeContent}</Text>
              </View>
            ) : (
              <Text className="text-xs text-muted">
                No instructions are set for this workspace yet.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  )
}
