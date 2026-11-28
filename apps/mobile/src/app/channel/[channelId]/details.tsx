import Archive02Icon from "@hugeicons/core-free-icons/Archive02Icon"
import ArchiveRestoreIcon from "@hugeicons/core-free-icons/ArchiveRestoreIcon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon"
import DiscordIcon from "@hugeicons/core-free-icons/DiscordIcon"
import Infinity01Icon from "@hugeicons/core-free-icons/Infinity01Icon"
import Logout01Icon from "@hugeicons/core-free-icons/Logout01Icon"
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon"
import NotificationOff01Icon from "@hugeicons/core-free-icons/NotificationOff01Icon"
import Pin02Icon from "@hugeicons/core-free-icons/Pin02Icon"
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon"
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon"
import SquareLock02Icon from "@hugeicons/core-free-icons/SquareLock02Icon"
import UserRemove01Icon from "@hugeicons/core-free-icons/UserRemove01Icon"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react-native"
import { MAX_CHANNEL_AGENTS } from "@repo/db/constants"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { router, useLocalSearchParams } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useToast } from "heroui-native/toast"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Alert, Text, TextInput, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import Animated from "react-native-reanimated"
import { AgentCreature } from "@/components/agent-creature"
import { AgentFollowUps } from "@/components/agent-follow-ups"
import { ChatAvatar } from "@/components/chat-avatar"
import { useMutePrompt } from "@/components/mute-sheet"
import { PickManySheet } from "@/components/pick-many-sheet"
import { Avatar } from "@/components/ui/avatar"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableRow } from "@/components/ui/pressable-row"
import { PressableScale } from "@/components/ui/pressable-scale"
import { Screen } from "@/components/ui/screen"
import { ScreenHeader } from "@/components/ui/screen-header"
import { StatePanel } from "@/components/ui/state-panel"
import { SwipeRow } from "@/components/ui/swipe-row"
import { useWorkspace } from "@/context/workspace-context"
import {
  agentCreature,
  refreshAgents,
  setChannelAgents,
  useAgents,
} from "@/hooks/use-agents"
import { useAuthorProfileSheet } from "@/hooks/use-author-profile-sheet"
import {
  AGENT_STATE_TEXT,
  useChannelAgentState,
} from "@/hooks/use-channel-agent"
import { useChannelDetail } from "@/hooks/use-channel-detail"
import { useChannelDiscord } from "@/hooks/use-channel-discord"
import { mutedUntilLabel, useChannelMutes } from "@/hooks/use-channel-mutes"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import {
  chatsKey,
  useChatArchive,
  useChatPeople,
  useChatPeopleChanges,
} from "@/hooks/use-chats"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { api, responseMessage } from "@/lib/api"
import type { ChannelDetail } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"
import { LIST_REFLOW, ROW_ENTER, ROW_EXIT } from "@/lib/motion"
import { openExternalUrl } from "@/lib/open-url"

// A chat's details (reference/agents-and-chats.md, decisions 31, 35 and 52):
// its name, the agents in it and the people in it, what it holds, and
// archiving or deleting it. As web's chat details panel. A swipe left on a
// person or agent takes them out; anyone can leave.
export default function ChatDetailsScreen() {
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

  if (!workspace || !channel) {
    return (
      <Screen className="bg-background" edges={["top", "bottom"]}>
        <ScreenHeader onBack={back} title="Details" />
        <StatePanel
          className="flex-1"
          detail="It may have been deleted."
          title="This chat is unavailable"
        />
      </Screen>
    )
  }
  return (
    <ChatDetails
      channel={channel}
      onBack={back}
      onChannelChanged={replaceChannel}
      workspaceId={workspace.id}
      workspaceSlug={workspace.slug}
    />
  )
}

function ChatDetails({
  channel,
  onBack,
  onChannelChanged,
  workspaceId,
  workspaceSlug,
}: {
  channel: ChannelDetail
  onBack: () => void
  onChannelChanged: (channel: ChannelDetail) => void
  workspaceId: string
  workspaceSlug: string
}) {
  const [danger, warning] = useThemeColor(["danger", "warning"])
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const permissions = useChannelPermissions(workspaceId)
  const canManage = permissions.canUpdateChannel
  const agents = useAgents(workspaceSlug)
  const state = useChannelAgentState()
  const people = useChatPeople(workspaceSlug, channel.id)
  const peopleChanges = useChatPeopleChanges(workspaceSlug, channel.id)
  const { archive, unarchive } = useChatArchive(workspaceSlug)
  const { getMute } = useChannelMutes()
  const { promptMute, muteSheet } = useMutePrompt()
  const { openAuthorProfile, profileSheet } =
    useAuthorProfileSheet(workspaceSlug)
  const [adding, setAdding] = useState<"agents" | "people" | null>(null)

  const here = channel.agentIds.flatMap(
    (id) => agents.find((agent) => agent.id === id) ?? []
  )
  const others = (people.data ?? []).filter((person) => person.id !== me)
  const inChat = people.data?.some((person) => person.id === me) ?? false
  const isPrivate = channel.audience === "members" && channel.parentId === null
  // A Discord channel agents are in: its name and agents are managed from
  // the Discord connector, and it has no people in Lor.
  const place = channel.kind === "place"
  const discord = useChannelDiscord(workspaceSlug, channel.id, place)
  const open = !channel.archivedAt
  const name = channel.name ?? "Chat"
  const canRename =
    open && !place && (canManage || (!!me && channel.creatorId === me))
  const canChangeAgents = canManage && open && !place
  const canAddPeople = open && !place && (!isPrivate || canManage)
  const mute = getMute(channel.id)

  // Agent changes send the whole list, so each is built from the latest one
  // and runs alone: a second removal confirmed before the first lands can't
  // put the first back.
  const agentIdsRef = useRef(channel.agentIds)
  agentIdsRef.current = channel.agentIds
  const changingAgentsRef = useRef(false)
  const changeAgents = useMutation({
    mutationFn: (agentIds: string[]) =>
      setChannelAgents(workspaceSlug, channel.id, agentIds),
    onSuccess: (updated) => {
      triggerHaptic("success")
      agentIdsRef.current = updated.agentIds
      onChannelChanged(updated as ChannelDetail)
      setAdding(null)
      return refreshAgents(queryClient, workspaceSlug)
    },
    onError: (error) => {
      triggerHaptic("error")
      toast.show({ variant: "danger", label: error.message })
    },
  })

  const updateAgents = (change: (agentIds: string[]) => string[]) => {
    if (changingAgentsRef.current) return
    changingAgentsRef.current = true
    changeAgents.mutate(change(agentIdsRef.current), {
      onSettled: () => {
        changingAgentsRef.current = false
      },
    })
  }

  const removeAgent = (agentId: string, agentName: string) => {
    if (changeAgents.isPending) return
    triggerHaptic("warning")
    Alert.alert(
      `Take ${agentName} out of ${name}?`,
      "It stops reading and answering here. Its Loops that report here pause.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Take out",
          onPress: () =>
            updateAgents((ids) => ids.filter((id) => id !== agentId)),
        },
      ]
    )
  }

  const removePerson = (userId: string, personName: string) => {
    const leaving = userId === me
    triggerHaptic("warning")
    Alert.alert(
      leaving ? `Leave ${name}?` : `Take ${personName} out of ${name}?`,
      leaving
        ? isPrivate
          ? "It leaves your list, and you can't see it again unless someone adds you."
          : "It leaves your list. You can find it and join again."
        : isPrivate
          ? "They won't see it any more."
          : "It leaves their list. They can find it and join again.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: leaving ? "Leave" : "Take out",
          onPress: () =>
            peopleChanges.remove.mutate(userId, {
              onSuccess: () => {
                if (leaving) router.replace("/")
              },
            }),
        },
      ]
    )
  }

  const confirmArchive = () => {
    triggerHaptic("warning")
    Alert.alert(
      `Archive ${name}?`,
      "For everyone: nobody can post, its agents stop here and its Loops pause. You can unarchive it.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Archive",
          onPress: () => archive.mutate({ channelId: channel.id, name }),
        },
      ]
    )
  }

  const deleteChat = useMutation({
    mutationFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$delete({ param: { workspaceSlug, channelId: channel.id } })
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't delete the chat"))
    },
    onSuccess: () => {
      triggerHaptic("success")
      void queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) })
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
        exact: true,
      })
      router.replace("/")
    },
    onError: (error) => {
      triggerHaptic("error")
      toast.show({ variant: "danger", label: error.message })
    },
  })
  const confirmDelete = () => {
    triggerHaptic("warning")
    Alert.alert(
      `Delete ${name}?`,
      "Every message and thread in it is deleted for everyone. This can't be undone.",
      [
        { style: "cancel", text: "Cancel" },
        {
          style: "destructive",
          text: "Delete",
          onPress: () => deleteChat.mutate(),
        },
      ]
    )
  }

  const goTo = (path: "sessions" | "loops" | "pins") =>
    router.push({
      pathname: `/channel/[channelId]/${path}`,
      params: { channelId: channel.id },
    } as never)

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <ScreenHeader onBack={onBack} title="Details" />
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerClassName="gap-six px-four pb-eight pt-five"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-three">
          <ChatAvatar
            agents={here.map((agent) => ({
              id: agent.id,
              creature: agentCreature(agent),
            }))}
            people={
              others.length + here.length > 0 ? others : (people.data ?? [])
            }
            size={84}
            total={here.length + others.length}
          />
          <View className="w-full items-center gap-one">
            <ChatName
              channel={channel}
              editable={canRename}
              key={channel.id}
              onRenamed={onChannelChanged}
              workspaceSlug={workspaceSlug}
            />
            {place ? (
              <Text className="text-center text-[13px] leading-[18px] text-muted">
                In Discord
                {discord.data?.link?.guildName
                  ? ` on ${discord.data.link.guildName}`
                  : ""}
                . Its agents are set up in Connectors on the web.
              </Text>
            ) : (
              <View className="flex-row items-center gap-one">
                {isPrivate ? (
                  <HugeiconsIcon
                    color={warning}
                    icon={SquareLock02Icon}
                    size={13}
                    strokeWidth={2}
                  />
                ) : null}
                <Text className="text-center text-[13px] text-muted">
                  {isPrivate
                    ? "Private: only the people in it can see it"
                    : "Anyone in the workspace can find it and join"}
                </Text>
              </View>
            )}
          </View>
          {place && discord.data?.link ? (
            <PressableScale
              accessibilityRole="button"
              className="h-10 flex-row items-center gap-two rounded-full bg-surface-secondary px-four"
              onPress={() => {
                const url = discord.data?.link?.url
                if (url) openExternalUrl(url)
              }}
              scale={0.96}
            >
              <HugeiconsIcon
                color="#5865F2"
                icon={DiscordIcon}
                size={17}
                strokeWidth={2}
              />
              <Text className="text-[15px] font-semibold text-foreground">
                Open in Discord
              </Text>
            </PressableScale>
          ) : null}
          {!place && open && people.data && !inChat ? (
            <PressableScale
              accessibilityRole="button"
              className="h-10 items-center justify-center rounded-full bg-accent px-five"
              disabled={peopleChanges.add.isPending}
              onPress={() => {
                if (me) peopleChanges.add.mutate([me])
              }}
              scale={0.96}
            >
              <Text className="text-[15px] font-semibold text-accent-foreground">
                Join chat
              </Text>
            </PressableScale>
          ) : null}
        </View>

        {here.length > 0 || canChangeAgents ? (
          <Section
            title={here.length > 0 ? `Agents · ${here.length}` : "Agents"}
          >
            {here.map((agent, index) => (
              <Animated.View
                entering={ROW_ENTER}
                exiting={ROW_EXIT}
                key={agent.id}
                layout={LIST_REFLOW}
              >
                <SwipeRow
                  action={
                    canChangeAgents
                      ? {
                          label: "Take out",
                          icon: UserRemove01Icon,
                          color: danger,
                          onPress: () => removeAgent(agent.id, agent.name),
                        }
                      : undefined
                  }
                >
                  <ListRow
                    detail={agent.role ?? "Agent"}
                    face={
                      <AgentCreature
                        creature={agentCreature(agent)}
                        size={34}
                        state={here.length === 1 ? state : "asleep"}
                        still={!(here.length === 1 && state === "working")}
                      />
                    }
                    first={index === 0}
                    hint="Opens its page"
                    onLongPress={
                      canChangeAgents
                        ? () => removeAgent(agent.id, agent.name)
                        : undefined
                    }
                    onPress={() =>
                      router.push({
                        pathname: "/agent/[agentId]",
                        params: { agentId: agent.id, from: channel.id },
                      } as never)
                    }
                    title={agent.name}
                    trailing={
                      here.length === 1 && state !== "asleep" ? (
                        <Text className="text-xs text-accent">
                          {AGENT_STATE_TEXT[state].replace(/^is /, "")}
                        </Text>
                      ) : undefined
                    }
                  />
                </SwipeRow>
              </Animated.View>
            ))}
            {canChangeAgents && here.length < MAX_CHANNEL_AGENTS ? (
              <AddRow
                first={here.length === 0}
                label="Add agent"
                onPress={() => setAdding("agents")}
              />
            ) : null}
          </Section>
        ) : null}

        {!place ? (
          <Section
            title={people.data ? `People · ${people.data.length}` : "People"}
          >
            {people.isPending ? (
              <View className="min-h-14 items-center justify-center">
                <Spinner size="sm" />
              </View>
            ) : null}
            {(people.data ?? []).map((person, index) => {
              const isMe = person.id === me
              return (
                <Animated.View
                  entering={ROW_ENTER}
                  exiting={ROW_EXIT}
                  key={person.id}
                  layout={LIST_REFLOW}
                >
                  <SwipeRow
                    action={
                      isMe
                        ? {
                            label: "Leave",
                            icon: Logout01Icon,
                            color: danger,
                            onPress: () => removePerson(person.id, person.name),
                          }
                        : canManage
                          ? {
                              label: "Take out",
                              icon: UserRemove01Icon,
                              color: danger,
                              onPress: () =>
                                removePerson(person.id, person.name),
                            }
                          : undefined
                    }
                  >
                    <ListRow
                      face={
                        <Avatar
                          avatarColor={person.avatarColor}
                          className="size-9"
                          image={person.image}
                          name={person.name}
                          size="sm"
                        />
                      }
                      first={index === 0}
                      hint="Opens their profile"
                      onLongPress={
                        isMe || canManage
                          ? () => removePerson(person.id, person.name)
                          : undefined
                      }
                      onPress={() => openAuthorProfile({ author: person })}
                      title={person.name}
                      trailing={
                        isMe ? (
                          <Text className="text-xs text-muted">You</Text>
                        ) : undefined
                      }
                    />
                  </SwipeRow>
                </Animated.View>
              )
            })}
            {canAddPeople && people.data ? (
              <AddRow
                first={people.data.length === 0}
                label="Add people"
                onPress={() => setAdding("people")}
              />
            ) : null}
          </Section>
        ) : null}

        <Section title="In this chat">
          <LinkRow
            first
            icon={Pin02Icon}
            label="Pinned messages"
            onPress={() => goTo("pins")}
          />
          <LinkRow
            icon={Infinity01Icon}
            label="Loops"
            onPress={() => goTo("loops")}
          />
          <LinkRow
            icon={SourceCodeIcon}
            label="Sessions"
            onPress={() => goTo("sessions")}
          />
          {!place && open ? (
            <LinkRow
              detail={mute ? mutedUntilLabel(mute.mutedUntil) : undefined}
              icon={mute ? NotificationOff01Icon : Notification01Icon}
              label={mute ? "Muted" : "Mute"}
              onPress={() =>
                promptMute({ channelId: channel.id, channelLabel: name, mute })
              }
            />
          ) : null}
        </Section>

        {here.length > 0 ? (
          <AgentFollowUps
            agentName={
              here.length === 1 ? (here[0]?.name ?? "Lor") : "Its agents"
            }
            channelId={channel.id}
            workspaceSlug={workspaceSlug}
          />
        ) : null}

        {/* A place is archived and deleted from the Discord connector. */}
        {!place && (canManage || permissions.canDeleteChannel) ? (
          <Section title="">
            {canManage ? (
              open ? (
                <LinkRow
                  first
                  icon={Archive02Icon}
                  label="Archive chat"
                  onPress={confirmArchive}
                />
              ) : (
                <LinkRow
                  first
                  icon={ArchiveRestoreIcon}
                  label="Unarchive chat"
                  onPress={() => unarchive.mutate({ channelId: channel.id })}
                />
              )
            ) : null}
            {permissions.canDeleteChannel ? (
              <LinkRow
                danger
                first={!canManage}
                icon={Delete02Icon}
                label={deleteChat.isPending ? "Deleting…" : "Delete chat"}
                onPress={confirmDelete}
              />
            ) : null}
          </Section>
        ) : null}
      </KeyboardAwareScrollView>
      <AddAgentsSheet
        busy={changeAgents.isPending}
        here={channel.agentIds}
        isOpen={adding === "agents"}
        onAdd={(ids) =>
          updateAgents((current) => [
            ...current,
            ...ids.filter((id) => !current.includes(id)),
          ])
        }
        onOpenChange={(isOpen) => setAdding(isOpen ? "agents" : null)}
        workspaceSlug={workspaceSlug}
      />
      <AddPeopleSheet
        busy={peopleChanges.add.isPending}
        here={(people.data ?? []).map((person) => person.id)}
        isOpen={adding === "people"}
        onAdd={(ids) =>
          peopleChanges.add.mutate(ids, { onSuccess: () => setAdding(null) })
        }
        onOpenChange={(isOpen) => setAdding(isOpen ? "people" : null)}
        workspaceSlug={workspaceSlug}
      />
      {profileSheet}
      {muteSheet}
    </Screen>
  )
}

// The chat's name: a field for whoever may rename it, saved on Done or when
// it loses focus.
function ChatName({
  channel,
  editable,
  onRenamed,
  workspaceSlug,
}: {
  channel: ChannelDetail
  editable: boolean
  onRenamed: (channel: ChannelDetail) => void
  workspaceSlug: string
}) {
  const [accent, placeholder] = useThemeColor(["accent", "field-placeholder"])
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const saved = channel.name ?? ""
  const [draft, setDraft] = useState(saved)
  useEffect(() => setDraft(saved), [saved])
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels[
        ":channelId"
      ].$patch({
        param: { workspaceSlug, channelId: channel.id },
        json: { name },
      })
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't rename the chat"))
      return res.json()
    },
    onSuccess: (updated) => {
      triggerHaptic("success")
      onRenamed(updated as ChannelDetail)
      void queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) })
      void queryClient.invalidateQueries({
        queryKey: ["channels", workspaceSlug],
        exact: true,
      })
    },
    onError: (error) => {
      setDraft(saved)
      triggerHaptic("error")
      toast.show({ variant: "danger", label: error.message })
    },
  })
  // Done blurs a single-line input, so blur alone commits (one PATCH).
  const commit = () => {
    if (rename.isPending) return
    const name = draft.trim()
    if (!name) return setDraft(saved)
    if (name !== saved) rename.mutate(name)
  }
  if (!editable) {
    return (
      <Text
        accessibilityRole="header"
        className="text-center text-[22px] font-bold tracking-[-0.4px] text-foreground"
        numberOfLines={2}
      >
        {saved || "Chat"}
      </Text>
    )
  }
  return (
    <TextInput
      accessibilityHint="Edits the chat's name"
      accessibilityLabel="Chat name"
      className="min-h-11 w-full rounded-lor-md px-three text-center text-[22px] font-bold tracking-[-0.4px] text-foreground"
      maxLength={100}
      onBlur={commit}
      onChangeText={setDraft}
      placeholder="Name this chat"
      placeholderTextColor={placeholder}
      returnKeyType="done"
      selectionColor={accent}
      value={draft}
    />
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-two">
      {title ? (
        <Text
          accessibilityRole="header"
          className="px-one text-[13px] font-semibold text-muted"
        >
          {title}
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
        {children}
      </View>
    </View>
  )
}

function ListRow({
  face,
  title,
  detail,
  trailing,
  first,
  hint,
  onPress,
  onLongPress,
}: {
  face: ReactNode
  title: string
  detail?: string | null
  trailing?: ReactNode
  first: boolean
  hint: string
  onPress: () => void
  onLongPress?: () => void
}) {
  return (
    <PressableRow
      accessibilityHint={hint}
      accessibilityLabel={title}
      accessibilityRole="button"
      className="flex-row items-center gap-three bg-surface-secondary pl-four"
      delayLongPress={420}
      highlightClassName="bg-surface-tertiary"
      onLongPress={
        onLongPress
          ? () => {
              triggerHaptic("medium")
              onLongPress()
            }
          : undefined
      }
      onPress={onPress}
    >
      <View className="size-9 items-center justify-center">{face}</View>
      <View
        className={`min-h-[60px] min-w-0 flex-1 flex-row items-center gap-two pr-four ${
          first ? "" : "border-t border-separator"
        }`}
      >
        <View className="min-w-0 flex-1 gap-px">
          <Text className="text-[16px] text-foreground" numberOfLines={1}>
            {title}
          </Text>
          {detail ? (
            <Text className="text-xs text-muted" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        {trailing}
      </View>
    </PressableRow>
  )
}

function AddRow({
  label,
  first,
  onPress,
}: {
  label: string
  first: boolean
  onPress: () => void
}) {
  const accent = useThemeColor("accent")
  return (
    <PressableRow
      accessibilityRole="button"
      className="flex-row items-center gap-three pl-four"
      highlightClassName="bg-surface-tertiary"
      onPress={() => {
        triggerHaptic("selection")
        onPress()
      }}
    >
      <View className="size-9 items-center justify-center rounded-full border border-dashed border-border">
        <HugeiconsIcon color={accent} icon={PlusSignIcon} size={16} />
      </View>
      <View
        className={`min-h-[52px] flex-1 justify-center pr-four ${
          first ? "" : "border-t border-separator"
        }`}
      >
        <Text className="text-[16px] text-accent">{label}</Text>
      </View>
    </PressableRow>
  )
}

function LinkRow({
  icon,
  label,
  detail,
  first = false,
  danger = false,
  onPress,
}: {
  icon: IconSvgElement
  label: string
  detail?: string
  first?: boolean
  danger?: boolean
  onPress: () => void
}) {
  const [foreground, muted, dangerColor] = useThemeColor([
    "foreground",
    "muted",
    "danger",
  ])
  return (
    <PressableRow
      accessibilityRole="button"
      className="flex-row items-center gap-three pl-four"
      highlightClassName="bg-surface-tertiary"
      onPress={onPress}
    >
      <HugeiconsIcon
        color={danger ? dangerColor : foreground}
        icon={icon}
        size={19}
        strokeWidth={1.8}
      />
      <View
        className={`min-h-[52px] min-w-0 flex-1 flex-row items-center gap-two pr-four ${
          first ? "" : "border-t border-separator"
        }`}
      >
        <View className="min-w-0 flex-1 gap-px">
          <Text
            className={`text-[16px] ${danger ? "text-danger" : "text-foreground"}`}
          >
            {label}
          </Text>
          {detail ? (
            <Text className="text-xs text-muted" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        {danger ? null : (
          <HugeiconsIcon color={muted} icon={ArrowRight01Icon} size={15} />
        )}
      </View>
    </PressableRow>
  )
}

function AddAgentsSheet({
  isOpen,
  onOpenChange,
  here,
  onAdd,
  busy,
  workspaceSlug,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  here: string[]
  onAdd: (ids: string[]) => void
  busy: boolean
  workspaceSlug: string
}) {
  const agents = useAgents(workspaceSlug)
  return (
    <PickManySheet
      busy={busy}
      confirmLabel="Add"
      emptyText="Every agent is in this chat already. Make more on the web."
      isOpen={isOpen}
      items={agents
        .filter((agent) => !here.includes(agent.id))
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          detail: agent.role,
          face: (
            <AgentCreature creature={agentCreature(agent)} size={34} still />
          ),
        }))}
      max={MAX_CHANNEL_AGENTS - here.length}
      onConfirm={onAdd}
      onOpenChange={onOpenChange}
      title="Add agents"
    />
  )
}

function AddPeopleSheet({
  isOpen,
  onOpenChange,
  here,
  onAdd,
  busy,
  workspaceSlug,
}: {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  here: string[]
  onAdd: (ids: string[]) => void
  busy: boolean
  workspaceSlug: string
}) {
  const { members } = useWorkspaceMembers(workspaceSlug)
  return (
    <PickManySheet
      busy={busy}
      confirmLabel="Add"
      emptyText="Everyone in the workspace is in this chat."
      isOpen={isOpen}
      items={members
        .filter((member) => !member.isBot && !here.includes(member.userId))
        .map((member) => ({
          id: member.userId,
          name: member.name,
          face: (
            <Avatar
              avatarColor={member.avatarColor}
              className="size-9"
              image={member.image}
              name={member.name}
              size="sm"
            />
          ),
        }))}
      onConfirm={onAdd}
      onOpenChange={onOpenChange}
      title="Add people"
    />
  )
}
