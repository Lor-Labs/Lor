import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import Alert02Icon from "@hugeicons/core-free-icons/Alert02Icon"
import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useToast } from "heroui-native/toast"
import { type ReactNode, useState } from "react"
import { Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { useWorkspace } from "@/context/workspace-context"
import {
  agentSessionKey,
  type SessionDetail,
  useAgentSession,
} from "@/hooks/use-agent-session"
import { environmentsQueryOptions } from "@/hooks/use-environments"
import { api } from "@/lib/api"
import type { AgentSession } from "@/lib/api-types"
import type { LorToolCall } from "@/lib/lor"

// A code session's environment and sandbox size, changed while it runs
// (LOR-156). A new size replaces the sandbox; the server restores the work
// folder from the newest checkpoint. Mirrors web's session-setup-dialog.tsx,
// except that an environment's env files are created and edited on web.

export type SessionSetupPick = {
  environmentId?: string | null
  sandboxMemoryMb?: number
}

const gb = (memoryMb: number) => `${memoryMb / 1024} GB`

export function SessionSetupSheet({
  isOpen,
  onOpenChange,
  workspaceSlug,
  session,
  lorRunning = false,
  suggested,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  // A prop, not from context: a sheet's content renders outside the
  // workspace provider.
  workspaceSlug: string
  session: AgentSession
  lorRunning?: boolean
  // Lor's suggestion card opens the sheet with its pick.
  suggested?: SessionSetupPick
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const repo = session.repoFullName
  const { data: list, isPending } = useQuery({
    ...environmentsQueryOptions(workspaceSlug, repo),
    enabled: isOpen && Boolean(workspaceSlug && repo),
  })
  const environments = list?.environments ?? []
  const defaultMb = list?.defaultSandboxMemoryMb ?? null
  const sizeOf = (environmentId: string | null) =>
    environments.find((env) => env.id === environmentId)?.sandboxMemoryMb ??
    defaultMb
  const currentMb = session.sandboxMemoryMb ?? sizeOf(session.environmentId)

  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  // Null: follow the picked environment's size.
  const [pickedMb, setPickedMb] = useState<number | null>(null)
  // Filled from the session (or the suggestion) each time the sheet opens.
  const [filled, setFilled] = useState(false)
  if (isOpen && !filled && list) {
    setFilled(true)
    setEnvironmentId(
      suggested?.environmentId !== undefined
        ? suggested.environmentId
        : session.environmentId
    )
    setPickedMb(suggested?.sandboxMemoryMb ?? session.sandboxMemoryMb)
  } else if (!isOpen && filled) {
    setFilled(false)
  }
  const sizeMb = pickedMb ?? sizeOf(environmentId)
  const resizing = filled && sizeMb !== currentMb
  const changed =
    filled && (resizing || environmentId !== session.environmentId)

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.v1.sessions[":sessionId"].setup.$patch({
        param: { sessionId: session.id },
        json: {
          environmentId,
          sandboxMemoryMb: pickedMb === sizeOf(environmentId) ? null : pickedMb,
        },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't change the session's setup")
      }
      return res.json()
    },
    onSuccess: ({ session: updated, replaced }) => {
      queryClient.setQueryData<SessionDetail>(
        agentSessionKey(session.id),
        (detail) => (detail ? { ...detail, session: updated } : detail)
      )
      triggerHaptic("success")
      toast.show({
        variant: "success",
        label: replaced
          ? `Replacing the sandbox with a ${gb(sizeMb ?? 0)} one`
          : "Session setup saved",
      })
      onOpenChange(false)
    },
    onError: (error) => toast.show({ variant: "danger", label: error.message }),
  })

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          contentContainerClassName="h-full"
          enableDynamicSizing={false}
          enableOverDrag={false}
          // The composer's keyboard would cover the sheet.
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["80%"]}
        >
          <View className="flex-row items-start gap-three px-one pb-two">
            <View className="min-w-0 flex-1 gap-one">
              <BottomSheet.Title>Environment & sandbox</BottomSheet.Title>
              <Text className="text-[13px] leading-[18px] text-muted">
                The env files Lor writes into {repo ?? "the repo"} and the
                memory of this session's sandbox. Anyone who can write here can
                change them.
              </Text>
            </View>
            <BottomSheet.Close />
          </View>
          {isPending ? (
            <View className="flex-1 items-center justify-center">
              <Spinner accessibilityLabel="Loading environments" />
            </View>
          ) : !list ? (
            <Text className="px-one py-four text-sm text-muted">
              Couldn't load environments.
            </Text>
          ) : (
            <BottomSheetScrollView
              // The action is the list's last item: a bar pinned under the list
              // sits below the sheet's visible edge.
              contentContainerStyle={{
                gap: 20,
                paddingBottom: 40,
                paddingTop: 12,
              }}
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
            >
              <Group title="Environment">
                <Choice
                  disabled={save.isPending}
                  label="None"
                  onPress={() => setEnvironmentId(null)}
                  selected={environmentId === null}
                  tick={accent}
                />
                {environments.map((env) => (
                  <Choice
                    disabled={save.isPending}
                    key={env.id}
                    label={env.name}
                    onPress={() => setEnvironmentId(env.id)}
                    selected={environmentId === env.id}
                    tick={accent}
                  />
                ))}
                <Text className="px-three pt-one text-xs leading-4 text-muted">
                  {environments.length === 0
                    ? `No environments for ${repo ?? "this repo"} yet. `
                    : ""}
                  Environments are created and edited in Lor on the web.
                </Text>
              </Group>
              <Group title="Sandbox size">
                {list.sandboxSizes.map((size) => (
                  <Choice
                    disabled={save.isPending}
                    detail={`${size.creditsPerHour} credits an hour${
                      size.memoryMb === currentMb ? " · current" : ""
                    }`}
                    key={size.memoryMb}
                    label={gb(size.memoryMb)}
                    onPress={() => setPickedMb(size.memoryMb)}
                    selected={sizeMb === size.memoryMb}
                    tick={accent}
                  />
                ))}
              </Group>
              {resizing ? (
                <View className="mx-one flex-row gap-two rounded-lor-md border border-border bg-surface-secondary px-three py-three">
                  <HugeiconsIcon
                    color={muted}
                    icon={Alert02Icon}
                    size={16}
                    strokeWidth={2}
                  />
                  <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-muted">
                    {lorRunning
                      ? "Lor is working in this session. Change the size when its turn ends."
                      : "Saving replaces this session's sandbox. The work folder comes back from Lor's last turn; installed packages, running servers and changes made since then are lost."}
                  </Text>
                </View>
              ) : null}
              <View className="px-one">
                <Button
                  isDisabled={
                    !changed || save.isPending || (resizing && lorRunning)
                  }
                  onPress={() => save.mutate()}
                >
                  {save.isPending
                    ? "Saving…"
                    : resizing
                      ? "Replace sandbox"
                      : "Save"}
                </Button>
              </View>
            </BottomSheetScrollView>
          )}
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View accessibilityRole="radiogroup" className="gap-px">
      <Text className="px-three pb-one text-xs font-semibold text-muted">
        {title}
      </Text>
      {children}
    </View>
  )
}

function Choice({
  label,
  detail,
  selected,
  onPress,
  tick,
  disabled = false,
}: {
  // While a save is in flight: the sheet closes on its result.
  disabled?: boolean
  label: string
  detail?: string
  selected: boolean
  onPress: () => void
  tick: string
}) {
  return (
    <PressableRow
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      className={`min-h-12 flex-row items-center gap-two px-three py-two ${
        disabled ? "opacity-50" : ""
      }`}
      disabled={disabled}
      onPress={() => {
        if (selected) return
        triggerHaptic("selection")
        onPress()
      }}
    >
      <View className="min-w-0 flex-1 gap-px">
        <Text className="text-[15px] text-foreground" numberOfLines={1}>
          {label}
        </Text>
        {detail ? <Text className="text-xs text-muted">{detail}</Text> : null}
      </View>
      {selected ? (
        <HugeiconsIcon color={tick} icon={Tick02Icon} size={18} />
      ) : null}
    </PressableRow>
  )
}

type Suggestion = NonNullable<LorToolCall["setup"]>

// Lor's suggest_session_setup result (LOR-156), under its reply: Review
// opens the session's Environment & sandbox sheet with the suggestion
// picked, so a new size's warning shows before the sandbox is replaced.
// Mirrors web's session-setup-card.tsx.
export function SessionSetupCard({ setup }: { setup: Suggestion }) {
  const muted = useThemeColor("muted")
  const { workspace } = useWorkspace()
  const workspaceSlug = workspace?.slug ?? ""
  const { data } = useAgentSession(setup.sessionId)
  const session = data?.session
  const { data: list } = useQuery(
    environmentsQueryOptions(workspaceSlug, session?.repoFullName ?? null)
  )
  const [open, setOpen] = useState(false)

  const environmentMb = list?.environments.find(
    (env) => env.id === session?.environmentId
  )?.sandboxMemoryMb
  const currentMb =
    session?.sandboxMemoryMb ??
    environmentMb ??
    list?.defaultSandboxMemoryMb ??
    null
  const applied =
    session !== undefined &&
    (setup.environmentId === undefined ||
      setup.environmentId === session.environmentId) &&
    (setup.sandboxMemoryMb === undefined || setup.sandboxMemoryMb === currentMb)

  const title = [
    setup.sandboxMemoryMb !== undefined
      ? `${gb(setup.sandboxMemoryMb)} sandbox`
      : null,
    setup.environmentName ? `the ${setup.environmentName} environment` : null,
  ]
    .filter(Boolean)
    .join(" and ")

  return (
    <View className="mt-two max-w-[420px] flex-row items-start gap-three rounded-lor-md border border-border px-three py-three">
      <View className="pt-[2px]">
        <HugeiconsIcon
          color={muted}
          icon={Settings02Icon}
          size={16}
          strokeWidth={2}
        />
      </View>
      {/* The action sits under the text: beside it, a phone's width leaves
          the reason three words a line. */}
      <View className="min-w-0 flex-1 gap-two">
        <View className="gap-px">
          <Text className="text-[15px] font-semibold text-foreground">
            Switch to {title}
          </Text>
          <Text className="text-[13px] leading-[18px] text-muted">
            {setup.reason}
          </Text>
        </View>
        {applied ? (
          <Text className="text-xs text-muted">Applied</Text>
        ) : session && workspaceSlug && !session.archivedAt ? (
          <Button
            className="self-start"
            onPress={() => setOpen(true)}
            size="sm"
            variant="secondary"
          >
            Review
          </Button>
        ) : null}
      </View>
      {session && workspaceSlug ? (
        <SessionSetupSheet
          isOpen={open}
          onOpenChange={setOpen}
          session={session}
          suggested={{
            ...(setup.environmentId !== undefined
              ? { environmentId: setup.environmentId }
              : {}),
            ...(setup.sandboxMemoryMb !== undefined
              ? { sandboxMemoryMb: setup.sandboxMemoryMb }
              : {}),
          }}
          workspaceSlug={workspaceSlug}
        />
      ) : null}
    </View>
  )
}
