import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import {
  AGENT_NAME_MAX,
  CREATURES,
  type CreatureId,
  channelAgentIdentity,
  isCreatureId,
} from "@repo/utils/bestiary"
import { CHANNEL_AGENT_DEFAULT_MODEL } from "@repo/utils/inference"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { Description } from "heroui-native/description"
import { useThemeColor } from "heroui-native/hooks"
import { Input } from "heroui-native/input"
import { Label } from "heroui-native/label"
import { Radio } from "heroui-native/radio"
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
import { RadioGroup } from "@/components/ui/radio-group"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { SectionLabel } from "@/components/ui/section-label"
import { StatePanel } from "@/components/ui/state-panel"
import { useWorkspace } from "@/context/workspace-context"
import { agentModelsQueryOptions } from "@/hooks/use-agent-models"
import {
  AGENT_STATE_TEXT,
  useChannelAgentState,
} from "@/hooks/use-channel-agent"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { api, responseMessage } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

type WakeMode = NonNullable<ChannelDetail["agentWakeMode"]>

const WAKE_MODES: { value: WakeMode; label: string }[] = [
  { value: "mention", label: "When mentioned or replied to" },
  { value: "every_message", label: "To every message" },
]

// A channel agent's settings on the phone: its name and creature, how it
// answers, its model and brief, then its facts and follow-ups. As web's
// Agent tab (edit-channel-dialog.tsx) and the follow-ups in its member
// panel. Who edits what follows the API: channel managers everything, the
// channel's creator the name and creature, anyone in the channel the facts
// and follow-ups.
export default function ChannelAgentScreen() {
  const { channelId } = useLocalSearchParams<{ channelId: string }>()
  const { workspace } = useWorkspace()
  const { channel, replaceChannel } = useChannelDetail({
    workspaceSlug: workspace?.slug ?? "",
    channelId: channelId ?? "",
  })
  const back = () =>
    channelId
      ? router.replace({
          pathname: "/channel/[channelId]",
          params: { channelId },
        })
      : router.replace("/")

  if (!workspace || !channel || channel.type !== "text") {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <ScreenHeader onBack={back} title="Agent" />
        <StatePanel
          className="flex-1"
          detail="Only text channels have an agent."
          title="No agent here"
        />
      </Screen>
    )
  }
  return (
    <AgentSettings
      channel={channel}
      key={channel.id}
      onBack={back}
      onSaved={replaceChannel}
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
    />
  )
}

function AgentSettings({
  channel,
  onBack,
  onSaved,
  workspaceId,
  workspaceSlug,
}: {
  channel: ChannelDetail
  onBack: () => void
  onSaved: (channel: ChannelDetail) => void
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
    (Boolean(channel.creatorId) && channel.creatorId === session?.user.id)

  // Drafts start from the channel when the screen opens; only edited fields
  // are sent, so a stale draft never overwrites someone else's change.
  const [agentName, setAgentName] = useState(channel.agentName ?? "")
  const [creature, setCreature] = useState<CreatureId | null>(
    isCreatureId(channel.agentCreature) ? channel.agentCreature : null
  )
  const [wakeMode, setWakeMode] = useState<WakeMode>(
    channel.agentWakeMode ?? "mention"
  )
  const [model, setModel] = useState(channel.agentModel ?? null)
  const [brief, setBrief] = useState(channel.agentBrief ?? "")
  const [edited, setEdited] = useState<{
    agentName?: boolean
    creature?: boolean
    wakeMode?: boolean
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

  // What it will be called and look like once saved: a blank name takes the
  // creature's default (reference/always-on-agents.md, decision 32).
  const identity = channelAgentIdentity({
    id: channel.id,
    agentName: agentName.trim() || null,
    agentCreature: creature,
  })
  const defaultName = channelAgentIdentity({
    id: channel.id,
    agentCreature: creature,
  }).name

  const hasChanges = Object.values(edited).some(Boolean)
  const save = useMutation({
    mutationFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$patch({
        param: { workspaceSlug, channelId: channel.id },
        json: {
          ...(edited.agentName ? { agentName: agentName.trim() || null } : {}),
          ...(edited.creature ? { agentCreature: creature } : {}),
          ...(canManage && edited.wakeMode ? { agentWakeMode: wakeMode } : {}),
          ...(canManage && edited.model ? { agentModel: model } : {}),
          ...(canManage && edited.brief
            ? { agentBrief: brief.trim() || null }
            : {}),
        },
      })
      if (!res.ok) {
        throw new Error(await responseMessage(res, "Couldn't save the agent"))
      }
      return res.json()
    },
    onSuccess: (updated) => {
      onSaved(updated)
      setEdited({})
      // The Channels tab shows its name and face from the channel list.
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
      })
      toast.show({ variant: "success", label: `${identity.name} saved` })
    },
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: "Agent not saved",
        description: error.message,
      }),
  })

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScreenHeader
        onBack={onBack}
        right={
          canEdit ? (
            <Button
              className="mr-one"
              isDisabled={!hasChanges || save.isPending}
              onPress={() => save.mutate()}
              size="sm"
            >
              {save.isPending ? "Saving…" : "Save"}
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
        </View>

        {canEdit ? (
          <>
            <TextField>
              <Label>Name</Label>
              <Input
                autoCapitalize="words"
                maxLength={AGENT_NAME_MAX}
                onChangeText={(text) => {
                  setAgentName(text)
                  edit("agentName")
                }}
                placeholder={defaultName}
                value={agentName}
              />
              <Description>
                What the channel calls its agent. People mention it as @
                {identity.name}.
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
            People who manage channels, and the channel's creator, can change
            its name and creature.
          </Text>
        )}

        {canManage ? (
          <>
            <View className="gap-two">
              <SectionLabel>Answers</SectionLabel>
              <RadioGroup
                onValueChange={(value) => {
                  setWakeMode(value as WakeMode)
                  edit("wakeMode")
                }}
                value={wakeMode}
              >
                {WAKE_MODES.map((mode) => (
                  <RadioGroup.Item
                    className="min-h-[52px] rounded-lor-md border border-border bg-surface px-four py-three"
                    key={mode.value}
                    value={mode.value}
                  >
                    <Text className="min-w-0 flex-1 text-[15px] font-semibold text-foreground">
                      {mode.label}
                    </Text>
                    <Radio />
                  </RadioGroup.Item>
                ))}
              </RadioGroup>
              <Text className="text-xs leading-4 text-muted">
                {identity.name} reads every message here either way. This sets
                which ones it answers right away.
              </Text>
            </View>

            <View className="gap-two">
              <SectionLabel>Model</SectionLabel>
              <Pressable
                accessibilityHint="Opens the list of models"
                accessibilityLabel={`Model, ${modelName}`}
                accessibilityRole="button"
                className="min-h-[52px] flex-row items-center gap-two rounded-lor-md border border-border bg-surface px-four py-three active:opacity-70"
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
                maxLength={4000}
                numberOfLines={5}
                onChangeText={(text) => {
                  setBrief(text)
                  edit("brief")
                }}
                placeholder={`What ${identity.name} should know and do here, e.g. “Watch deploys and tell us in two lines when one fails.”`}
                value={brief}
              />
              <Description>
                Standing instructions for {identity.name} in this channel. Only
                people write the brief.
              </Description>
            </TextField>
          </>
        ) : null}

        <AgentFacts
          agentName={identity.name}
          channelId={channel.id}
          workspaceSlug={workspaceSlug}
        />
        <AgentFollowUps
          agentName={identity.name}
          channelId={channel.id}
          workspaceSlug={workspaceSlug}
        />
        {canManage ? (
          <Text className="text-xs leading-4 text-muted">
            Moving the chat to Discord and the agent's profile are set on web.
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
