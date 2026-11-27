import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import DiscordIcon from "@hugeicons/core-free-icons/DiscordIcon"
import Infinity01Icon from "@hugeicons/core-free-icons/Infinity01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { describeLoopSchedule } from "@repo/realtime-types/loops"
import {
  AGENT_NAME_MAX,
  CREATURES,
  type CreatureId,
} from "@repo/utils/bestiary"
import { CHANNEL_AGENT_DEFAULT_MODEL } from "@repo/utils/inference"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { Description } from "heroui-native/description"
import { useThemeColor } from "heroui-native/hooks"
import { Input } from "heroui-native/input"
import { Label } from "heroui-native/label"
import { TextArea } from "heroui-native/text-area"
import { TextField } from "heroui-native/text-field"
import { useToast } from "heroui-native/toast"
import { useState } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { AgentCreature } from "@/components/agent-creature"
import { AgentFacts } from "@/components/agent-facts"
import { LoopStatusChip, openLoop } from "@/components/loop-card"
import { PickerSheet } from "@/components/picker-sheet"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { SectionLabel } from "@/components/ui/section-label"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { agentModelsQueryOptions } from "@/hooks/use-agent-models"
import {
  agentCreature,
  agentsKey,
  useAgentsById,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { usePlaceChats } from "@/hooks/use-chats"
import { sortLoops, useAgentLoops } from "@/hooks/use-loops"
import { api, responseMessage } from "@/lib/api"
import type { ChannelLoop } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import {
  openTextChannels,
  workspaceChannelsQueryOptions,
} from "@/lib/workspace-channels"

// An agent's page (reference/agents-and-chats.md): its name and creature,
// model and brief, the chats it is in, the Loops it runs across them, and
// its facts. Who edits what follows the API: chat managers everything, the
// agent's creator its name and creature, anyone who sees it the facts.
// Making and deleting agents, its events and webhooks stay on the web.
export default function AgentScreen() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>()
  const { workspace } = useWorkspace()
  const agent = useAgentsById(workspace?.slug).get(agentId ?? "") ?? null

  if (!workspace || !agent) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <ScreenHeader title="Agent" />
        <StatePanel
          className="flex-1"
          detail="It may have been deleted, or it is still loading."
          title="Agent unavailable"
        />
      </Screen>
    )
  }
  return (
    <AgentSettings
      agent={agent}
      key={agent.id}
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
    />
  )
}

function AgentSettings({
  agent,
  workspaceId,
  workspaceSlug,
}: {
  agent: WorkspaceAgent
  workspaceId: string
  workspaceSlug: string
}) {
  const muted = useThemeColor("muted")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const permissions = useChannelPermissions(workspaceId)
  const canManage = permissions.canUpdateChannel
  // Its creator may name the agent and pick its creature too.
  const canEdit =
    canManage ||
    (Boolean(agent.createdById) && agent.createdById === session?.user.id)

  // The chats it is in, among those this person sees.
  const { data: channels } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )
  const chatsIn = channels
    ? openTextChannels(channels).filter((item) =>
        agent.channelIds.includes(item.id)
      )
    : []

  // Drafts start from the agent when the screen opens; only edited fields
  // are sent, so a stale draft never overwrites someone else's change.
  const [agentName, setAgentName] = useState(agent.name)
  const [creature, setCreature] = useState<CreatureId>(agentCreature(agent))
  const [model, setModel] = useState(agent.model)
  const [brief, setBrief] = useState(agent.brief ?? "")
  const [edited, setEdited] = useState<{
    agentName?: boolean
    creature?: boolean
    model?: boolean
    brief?: boolean
  }>({})
  const [isModelOpen, setIsModelOpen] = useState(false)
  const edit = (field: keyof typeof edited) =>
    setEdited((current) => ({ ...current, [field]: true }))

  const models = useQuery({
    ...agentModelsQueryOptions("pi", workspaceSlug),
    enabled: canManage,
  })
  // Lor's own models; batch-only ones can't answer live.
  const modelOptions = (models.data?.models ?? [])
    .filter(
      (option) => option.keyProvider === null && !option.id.endsWith("-batch")
    )
    .map((option) => ({
      value: option.id,
      label: option.name,
      badge: option.id === CHANNEL_AGENT_DEFAULT_MODEL ? "default" : null,
    }))
  const selectedModel = model ?? CHANNEL_AGENT_DEFAULT_MODEL
  const modelName =
    modelOptions.find((option) => option.value === selectedModel)?.label ??
    selectedModel

  // What it will be called and look like once saved. A name can't be blank.
  const identity = { name: agentName.trim() || agent.name, creature }

  // A field edited back to the agent's current value is not sent either.
  const changes = {
    ...(edited.agentName && agentName.trim() && agentName.trim() !== agent.name
      ? { name: agentName.trim() }
      : {}),
    ...(edited.creature && creature !== agentCreature(agent)
      ? { creature }
      : {}),
    ...(canManage && edited.model && model !== agent.model ? { model } : {}),
    ...(canManage &&
    edited.brief &&
    (brief.trim() || null) !== (agent.brief ?? null)
      ? { brief: brief.trim() || null }
      : {}),
  }
  const hasChanges = Object.keys(changes).length > 0
  const save = useMutation({
    mutationFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].$patch({
        param: { workspaceSlug, agentId: agent.id },
        json: changes,
      })
      if (!res.ok) {
        throw new Error(await responseMessage(res, "Couldn't save the agent"))
      }
      return res.json()
    },
    onSuccess: (updated) => {
      // The server normalizes what it saves (a name loses its "@").
      setAgentName(updated.name)
      setCreature(agentCreature(updated))
      setModel(updated.model)
      setBrief(updated.brief ?? "")
      setEdited({})
      // Every channel it is in shows the new name and face.
      queryClient.setQueryData<WorkspaceAgent[]>(
        agentsKey(workspaceSlug),
        (list) => list?.map((item) => (item.id === updated.id ? updated : item))
      )
      void queryClient.invalidateQueries({ queryKey: agentsKey(workspaceSlug) })
      toast.show({ variant: "success", label: `${updated.name} saved` })
    },
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: "Agent not saved",
        description: error.message,
      }),
  })

  // A save clears the edited marks, so nothing changes while one is in
  // flight: an edit made then would be dropped from the next save.
  const saving = save.isPending

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScreenHeader
        right={
          canEdit ? (
            <Button
              className="mr-one"
              isDisabled={!hasChanges || saving || !agentName.trim()}
              onPress={() => save.mutate()}
              size="sm"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : null
        }
        subtitle={agent.role ?? "Agent"}
        title={identity.name}
      />
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerClassName="gap-six px-four pb-eight pt-five"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-two">
          <View className="size-32 items-center justify-center rounded-lor-lg bg-surface-secondary">
            <AgentCreature creature={identity.creature} size={96} still />
          </View>
          <Text className="text-xl font-bold text-foreground">
            {identity.name}
          </Text>
          <Text className="text-center text-sm text-muted">
            {agent.role ? `${agent.role}. ` : ""}Mention it in a chat to wake
            it.
          </Text>
        </View>

        {chatsIn.length > 0 ? (
          <View className="gap-two">
            <SectionLabel>{`In ${chatsIn.length} ${chatsIn.length === 1 ? "chat" : "chats"}`}</SectionLabel>
            <View className="flex-row flex-wrap gap-two">
              {chatsIn.map((chat) => (
                <PressableScale
                  accessibilityHint="Opens the chat"
                  accessibilityRole="button"
                  className="h-9 justify-center rounded-full bg-surface-secondary px-four"
                  key={chat.id}
                  onPress={() =>
                    router.push({
                      pathname: "/channel/[channelId]",
                      params: { channelId: chat.id },
                    })
                  }
                  scale={0.95}
                >
                  <Text
                    className="max-w-[220px] text-[14px] font-medium text-foreground"
                    numberOfLines={1}
                  >
                    {chat.name ?? "Chat"}
                  </Text>
                </PressableScale>
              ))}
            </View>
            <Text className="text-xs leading-4 text-muted">
              Its settings, facts and Loops are the same in every chat.
            </Text>
          </View>
        ) : null}

        {canEdit ? (
          <>
            <TextField>
              <Label>Name</Label>
              <Input
                autoCapitalize="words"
                isDisabled={saving}
                maxLength={AGENT_NAME_MAX}
                onChangeText={(text) => {
                  setAgentName(text)
                  edit("agentName")
                }}
                value={agentName}
              />
              <Description>
                What the team calls it. People mention it as @{identity.name}.
              </Description>
            </TextField>

            <View className="gap-two">
              <SectionLabel>Creature</SectionLabel>
              <View className="flex-row flex-wrap">
                {CREATURES.map((option) => {
                  const picked = identity.creature === option.id
                  return (
                    <View className="w-1/5 p-[3px]" key={option.id}>
                      <Pressable
                        accessibilityLabel={option.label}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: picked }}
                        className={`items-center gap-one rounded-lor-sm border px-one pb-one pt-two active:opacity-70 ${
                          picked
                            ? "border-accent bg-surface-secondary"
                            : "border-transparent"
                        }`}
                        disabled={saving}
                        onPress={() => {
                          triggerHaptic("selection")
                          setCreature(option.id)
                          edit("creature")
                        }}
                      >
                        <AgentCreature creature={option.id} size={44} still />
                        <Text
                          className={`text-[11px] ${picked ? "font-semibold text-foreground" : "text-muted"}`}
                          numberOfLines={1}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    </View>
                  )
                })}
              </View>
            </View>
          </>
        ) : (
          <Text className="text-sm leading-5 text-muted">
            People who manage chats, and whoever made {identity.name}, can
            change its name and creature.
          </Text>
        )}

        {canManage ? (
          <>
            <View className="gap-two">
              <SectionLabel>Model</SectionLabel>
              <Pressable
                accessibilityHint="Opens the list of models"
                accessibilityLabel={`Model, ${modelName}`}
                accessibilityRole="button"
                className="min-h-[52px] flex-row items-center gap-two rounded-lor-md border border-border bg-surface px-four py-three active:opacity-70"
                disabled={saving}
                onPress={() => setIsModelOpen(true)}
              >
                <Text
                  className="min-w-0 flex-1 text-[15px] text-foreground"
                  numberOfLines={1}
                >
                  {modelName}
                  {model === null ? (
                    <Text className="text-muted"> (default)</Text>
                  ) : null}
                </Text>
                <HugeiconsIcon
                  color={muted}
                  icon={ArrowRight01Icon}
                  size={16}
                />
              </Pressable>
            </View>

            <TextField>
              <Label>Brief</Label>
              <TextArea
                isDisabled={saving}
                maxLength={4000}
                numberOfLines={5}
                onChangeText={(text) => {
                  setBrief(text)
                  edit("brief")
                }}
                placeholder={`What ${identity.name} should know and do, e.g. “Watch deploys and tell us in two lines when one fails.”`}
                value={brief}
              />
              <Description>
                Standing instructions for {identity.name}, wherever it is. Only
                people write the brief.
              </Description>
            </TextField>
          </>
        ) : null}

        <AgentLoops
          agent={agent}
          agentName={identity.name}
          workspaceSlug={workspaceSlug}
        />
        <AgentFacts
          agentId={agent.id}
          agentName={identity.name}
          workspaceSlug={workspaceSlug}
        />
        <Text className="text-xs leading-4 text-muted">
          Making and deleting agents, their events and webhooks, and Discord are
          set up on the web.
        </Text>
      </KeyboardAwareScrollView>
      {canManage ? (
        <PickerSheet
          emptyText="No models match"
          isOpen={isModelOpen}
          loading={models.isPending}
          onOpenChange={setIsModelOpen}
          onPick={(value) => {
            setModel(value === CHANNEL_AGENT_DEFAULT_MODEL ? null : value)
            edit("model")
            setIsModelOpen(false)
          }}
          options={modelOptions}
          search={{ placeholder: "Search models" }}
          selected={selectedModel}
          title="Model"
        />
      ) : null}
    </Screen>
  )
}

const LOOP_STATUS: Partial<Record<ChannelLoop["status"], string>> = {
  paused: "Paused",
  draft: "Draft",
  completed: "Completed",
}

// The Loops it runs: by the chat each reports in, then those with no chat.
function AgentLoops({
  agent,
  agentName,
  workspaceSlug,
}: {
  agent: WorkspaceAgent
  agentName: string
  workspaceSlug: string
}) {
  const [accent, muted] = useThemeColor(["accent", "muted"])
  const loops = useAgentLoops(workspaceSlug, agent.id)
  const { data: list } = useQuery(workspaceChannelsQueryOptions(workspaceSlug))
  const places = usePlaceChats(workspaceSlug, true)
  if (!loops.data) {
    return (
      <View className="gap-two">
        <SectionLabel>Loops</SectionLabel>
        <Text className="text-sm text-muted">
          {loops.isError ? "Couldn't load its Loops." : "Loading…"}
        </Text>
      </View>
    )
  }
  const chats = [
    ...(list ? openTextChannels(list) : []).map((chat) => ({
      id: chat.id,
      title: chat.name ?? "Chat",
      discord: false,
    })),
    ...(places.data ?? []).map((chat) => ({
      id: chat.id,
      title: `#${chat.name ?? "channel"}`,
      discord: true,
    })),
  ]
  const order = (channelId: string | null) =>
    channelId === null
      ? chats.length + 2
      : chats.findIndex((chat) => chat.id === channelId) + 1 || chats.length + 1
  const groups = [...new Set(loops.data.map((loop) => loop.channelId))]
    .sort((a, b) => order(a) - order(b))
    .map((channelId) => {
      const chat = chats.find((item) => item.id === channelId)
      return {
        key: channelId ?? "none",
        title:
          channelId === null
            ? "No chat"
            : (chat?.title ?? "A chat that was put away"),
        discord: chat?.discord ?? false,
        loops: sortLoops(
          (loops.data ?? []).filter((loop) => loop.channelId === channelId)
        ),
      }
    })

  return (
    <View className="gap-three">
      <SectionLabel>Loops</SectionLabel>
      {groups.length === 0 ? (
        <Text className="text-sm leading-5 text-muted">
          No Loops yet. Ask {agentName} in a chat to do something on a schedule,
          and it sets one up.
        </Text>
      ) : null}
      {groups.map((group) => (
        <View className="gap-one" key={group.key}>
          <View className="flex-row items-center gap-one px-one">
            {group.discord ? (
              <HugeiconsIcon color={muted} icon={DiscordIcon} size={12} />
            ) : null}
            <Text className="text-xs font-medium text-muted" numberOfLines={1}>
              {group.title}
            </Text>
          </View>
          <View className="overflow-hidden rounded-lor-md bg-surface-secondary">
            {group.loops.map((loop, index) => {
              const live = loop.status === "active" || loop.status === "draft"
              const status =
                loop.status === "paused" && loop.pausedReason === "agent_left"
                  ? "Not in this chat"
                  : loop.status === "paused" &&
                      loop.pausedReason === "chat_archived"
                    ? "Chat archived"
                    : LOOP_STATUS[loop.status]
              return (
                <PressableRow
                  accessibilityHint="Opens the loop"
                  accessibilityLabel={`${loop.name}, ${status ?? "active"}`}
                  accessibilityRole="button"
                  className={`min-h-14 flex-row items-center gap-three px-three py-two ${
                    index > 0 ? "border-t border-separator" : ""
                  } ${loop.status === "completed" ? "opacity-60" : ""}`}
                  highlightClassName="bg-surface-tertiary rounded-none"
                  key={loop.id}
                  onPress={() => openLoop(loop)}
                >
                  <HugeiconsIcon
                    color={live ? accent : muted}
                    icon={Infinity01Icon}
                    size={17}
                    strokeWidth={2}
                  />
                  <View className="min-w-0 flex-1 gap-px">
                    <Text
                      className="text-[15px] text-foreground"
                      numberOfLines={1}
                    >
                      {loop.name}
                    </Text>
                    <Text className="text-xs text-muted" numberOfLines={1}>
                      {describeLoopSchedule(loop.schedule, loop.timezone)}
                    </Text>
                  </View>
                  {loop.status === "active" ? null : (
                    <LoopStatusChip status={loop.status} />
                  )}
                  <HugeiconsIcon
                    color={muted}
                    icon={ArrowRight01Icon}
                    size={14}
                  />
                </PressableRow>
              )
            })}
          </View>
        </View>
      ))}
    </View>
  )
}
