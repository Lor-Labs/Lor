import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
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
import { AgentFollowUps } from "@/components/agent-follow-ups"
import { PickerSheet } from "@/components/picker-sheet"
import { Button } from "@/components/ui/button"
import { triggerHaptic } from "@/components/ui/haptics"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { SectionLabel } from "@/components/ui/section-label"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { agentModelsQueryOptions } from "@/hooks/use-agent-models"
import {
  agentCreature,
  agentsKey,
  channelAgentOf,
  useAgentsById,
  type WorkspaceAgent,
} from "@/hooks/use-agents"
import {
  AGENT_STATE_TEXT,
  useChannelAgentState,
} from "@/hooks/use-channel-agent"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { api, responseMessage } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { workspaceChannelsQueryOptions } from "@/lib/workspace-channels"

// The settings of the agent in a channel, on the phone: its name and
// creature, its model and brief, then its facts and this channel's
// follow-ups (reference/agents-and-chats.md). They are the agent's, so they
// apply in every channel it is in. Which agent a channel has is picked on
// web. Who edits what follows the API: channel managers everything, the
// agent's creator its name and creature, anyone who sees it the facts and
// follow-ups.
export default function ChannelAgentScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { workspace } = useWorkspace()
  const { channel } = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const agent = channelAgentOf(channel, useAgentsById(workspace?.slug))
  const back = () =>
    channelId
      ? router.replace({
          pathname: "/channel/[channelId]",
          params: { channelId },
        })
      : router.replace("/")

  if (!workspace || !channel || !agent) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <ScreenHeader onBack={back} title="Agent" />
        <StatePanel
          className="flex-1"
          detail="Add one from the channel's settings on web."
          title="No agent in this channel"
        />
      </Screen>
    )
  }
  return (
    <AgentSettings
      agent={agent}
      channel={channel}
      key={agent.id}
      onBack={back}
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
    />
  )
}

function AgentSettings({
  agent,
  channel,
  onBack,
  workspaceId,
  workspaceSlug,
}: {
  agent: WorkspaceAgent
  channel: ChannelDetail
  onBack: () => void
  workspaceId: string
  workspaceSlug: string
}) {
  const muted = useThemeColor("muted")
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const permissions = useChannelPermissions(workspaceId)
  const state = useChannelAgentState()
  const canManage = permissions.canUpdateChannel
  // Its creator may name the agent and pick its creature too.
  const canEdit =
    canManage ||
    (Boolean(agent.createdById) && agent.createdById === session?.user.id)

  // The other channels it is in, by name, among those this person sees.
  const { data: channels } = useQuery(
    workspaceChannelsQueryOptions(workspaceSlug)
  )
  const channelNames = new Map(
    [
      ...(channels?.uncategorized ?? []),
      ...(channels?.categories.flatMap((category) => category.channels) ?? []),
    ].map((item) => [item.id, item.name])
  )
  const alsoIn = agent.channelIds
    .filter((id) => id !== channel.id)
    .flatMap((id) => channelNames.get(id) ?? [])

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

  const hasChanges = Object.values(edited).some(Boolean)
  const save = useMutation({
    mutationFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].agents[
        ":agentId"
      ].$patch({
        param: { workspaceSlug, agentId: agent.id },
        json: {
          ...(edited.agentName && agentName.trim()
            ? { name: agentName.trim() }
            : {}),
          ...(edited.creature ? { creature } : {}),
          ...(canManage && edited.model ? { model } : {}),
          ...(canManage && edited.brief ? { brief: brief.trim() || null } : {}),
        },
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
        onBack={onBack}
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
        subtitle={`#${channel.name ?? "channel"}`}
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
            <AgentCreature
              creature={identity.creature}
              size={96}
              state={state}
            />
          </View>
          <Text className="text-xl font-bold text-foreground">
            {identity.name}
          </Text>
          <Text className="text-center text-sm text-muted">
            {identity.name} {AGENT_STATE_TEXT[state]}
            {state === "asleep" ? ". Mention it to wake it." : "."}
          </Text>
          {alsoIn.length > 0 ? (
            <Text className="text-center text-xs leading-4 text-muted">
              Also in {alsoIn.map((name) => `#${name}`).join(", ")}. Its
              settings and facts are the same there.
            </Text>
          ) : null}
        </View>

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
            People who manage channels, and whoever made {identity.name}, can
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

        <AgentFacts
          agentId={agent.id}
          agentName={identity.name}
          workspaceSlug={workspaceSlug}
        />
        <AgentFollowUps
          agentName={identity.name}
          channelId={channel.id}
          workspaceSlug={workspaceSlug}
        />
        {canManage ? (
          <Text className="text-xs leading-4 text-muted">
            Which agent is in a channel, moving the chat to Discord and the
            channel's tools are set on web.
          </Text>
        ) : null}
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
