import Search01Icon from "@hugeicons/core-free-icons/Search01Icon"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import * as Clipboard from "expo-clipboard"
import * as Crypto from "expo-crypto"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { Spinner } from "heroui-native/spinner"
import { useToast } from "heroui-native/toast"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Text, TextInput, View } from "react-native"
import { KeyboardAwareScrollView } from "react-native-keyboard-controller"
import { AgentCreature } from "@/components/agent-creature"
import { ChatAvatar } from "@/components/chat-avatar"
import { Avatar } from "@/components/ui/avatar"
import { triggerHaptic } from "@/components/ui/haptics"
import { PressableScale } from "@/components/ui/pressable-scale"
import { Screen } from "@/components/ui/screen"
import { useSocket } from "@/context/socket-context"
import { useWorkspace } from "@/context/workspace-context"
import { agentCreature, useAgents } from "@/hooks/use-agents"
import { useChannelPermissions } from "@/hooks/use-channel-permissions"
import { chatsKey } from "@/hooks/use-chats"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import { api, responseMessage } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

// Starting a chat (reference/agents-and-chats.md, decisions 31 and 35): who
// is in it, what it is called, and a first message if there is one. It
// starts with the people picked, not everyone; anyone else can still find
// it and join. Left unnamed, it is called by who is in it. As web's
// new-chat-view.tsx, in a sheet like a new message.

const LIST = new Intl.ListFormat("en", { type: "conjunction" })
// Past this many people the picker gets a search field.
const SEARCH_FROM = 12

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name
const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((item) => item !== id) : [...list, id]

export default function NewChatScreen() {
  const [accent, muted, placeholder] = useThemeColor([
    "accent",
    "muted",
    "field-placeholder",
  ])
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const socket = useSocket()
  const { workspace } = useWorkspace()
  const workspaceSlug = workspace?.slug ?? ""
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const agents = useAgents(workspaceSlug)
  // Picking a chat's agents takes channel:update. Without it the chat
  // starts with the workspace's first agent, as a new chat always has.
  const canPickAgents = useChannelPermissions(workspace?.id).canUpdateChannel
  const { members } = useWorkspaceMembers(workspaceSlug)
  const everyone = members.filter(
    (member) => !member.isBot && member.userId !== me
  )

  const [agentIds, setAgentIds] = useState<string[]>([])
  const [peopleIds, setPeopleIds] = useState<string[]>([])
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [query, setQuery] = useState("")
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const pickedAgents = agentIds.flatMap(
    (id) => agents.find((agent) => agent.id === id) ?? []
  )
  const pickedPeople = peopleIds.flatMap(
    (id) => everyone.find((member) => member.userId === id) ?? []
  )
  const needle = query.trim().toLowerCase()
  const shownPeople = everyone.filter(
    (member) =>
      !needle ||
      peopleIds.includes(member.userId) ||
      member.name.toLowerCase().includes(needle)
  )

  const membersName = LIST.format([
    ...pickedAgents.map((agent) => agent.name),
    ...pickedPeople.map((member) => firstName(member.name)),
  ])
  const agentNames = LIST.format(pickedAgents.map((agent) => agent.name))
  const several = pickedAgents.length > 1
  let hint = "Pick who is in it. You can change that later."
  if (pickedAgents.length === 1 && pickedPeople.length === 0) {
    hint = `Just you and ${agentNames}.`
  } else if (pickedAgents.length > 0) {
    hint = `${agentNames} ${several ? "read" : "reads"} along and ${several ? "answer" : "answers"} when mentioned.`
  } else if (pickedPeople.length > 0) {
    hint = canPickAgents
      ? "No agent in it yet. You can add one later."
      : "Anyone else in the workspace can find it and join."
  }

  const start = useMutation({
    mutationFn: async () => {
      const res = await api.v1.workspaces[":workspaceSlug"].channels.$post({
        param: { workspaceSlug },
        json: {
          type: "text",
          name: name.trim() || null,
          memberIds: peopleIds,
          ...(canPickAgents ? { agentIds } : {}),
        },
      })
      if (!res.ok)
        throw new Error(await responseMessage(res, "Couldn't start the chat"))
      const chat = await res.json()
      const first = text.trim()
      if (first) {
        // The chat exists either way: a first message that fails says so
        // rather than losing the chat.
        const sent = socket?.connected
          ? await socket
              .timeout(12_000)
              .emitWithAck("message:send", {
                channelId: chat.id,
                content: first,
                nonce: Crypto.randomUUID(),
              })
              .then((result) => result.ok)
              .catch(() => false)
          : false
        if (!sent) return { chat, unsent: first }
      }
      return { chat, unsent: null }
    },
    onSuccess: async ({ chat, unsent }) => {
      triggerHaptic("success")
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["channels", workspaceSlug],
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) }),
      ])
      // Cancelled or swiped away while it was being made: don't navigate.
      const stillOpen = mountedRef.current
      if (unsent) {
        if (!stillOpen) void Clipboard.setStringAsync(unsent)
        toast.show({
          variant: "warning",
          label: "The chat was made, but your message wasn't sent",
          description: stillOpen
            ? "It's in the composer to send again."
            : "It was copied so you can send it again.",
        })
      }
      if (!stillOpen) return
      router.dismiss()
      // An unsent first message opens as the chat's composer draft.
      router.push({
        pathname: "/channel/[channelId]",
        params: { channelId: chat.id, ...(unsent ? { draft: unsent } : {}) },
      } as never)
    },
    onError: (error) => {
      triggerHaptic("error")
      toast.show({ variant: "danger", label: error.message })
    },
  })
  const busy = start.isPending
  // Someone in it, or a name: a chat with neither says nothing about itself.
  const ready =
    pickedAgents.length + pickedPeople.length > 0 || name.trim().length > 0
  const submit = () => {
    if (ready && !busy) start.mutate()
  }

  return (
    <Screen className="bg-background" edges={["top", "bottom"]}>
      <View className="min-h-[56px] flex-row items-center px-two">
        <PressableScale
          accessibilityRole="button"
          className="min-h-11 justify-center px-three"
          feedback="dim"
          onPress={() => router.back()}
        >
          <Text className="text-[17px] text-accent">Cancel</Text>
        </PressableScale>
        <Text
          accessibilityRole="header"
          className="flex-1 text-center text-[17px] font-semibold text-foreground"
        >
          New chat
        </Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || busy }}
          className="min-h-11 min-w-[64px] items-end justify-center px-three"
          disabled={!ready || busy}
          feedback="dim"
          onPress={submit}
        >
          {busy ? (
            <Spinner size="sm" />
          ) : (
            <Text
              className="text-[17px] font-semibold"
              style={{ color: ready ? accent : muted }}
            >
              Start
            </Text>
          )}
        </PressableScale>
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerClassName="gap-six px-four pb-eight pt-four"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center gap-four">
          <ChatAvatar
            agents={pickedAgents.map((agent) => ({
              id: agent.id,
              creature: agentCreature(agent),
            }))}
            grow
            people={pickedPeople.map((member) => ({
              id: member.userId,
              name: member.name,
              image: member.image,
              avatarColor: member.avatarColor,
            }))}
            size={64}
            total={pickedAgents.length + pickedPeople.length}
          />
          <View className="min-w-0 flex-1 gap-one">
            <TextInput
              accessibilityLabel="Chat name"
              className="min-h-10 p-0 text-[22px] font-bold tracking-[-0.4px] text-foreground"
              maxLength={100}
              onChangeText={setName}
              // Left empty, the chat is called by who is in it.
              placeholder={membersName || "New chat"}
              placeholderTextColor={placeholder}
              returnKeyType="done"
              selectionColor={accent}
              value={name}
            />
            <Text className="text-[13px] leading-[18px] text-muted">
              {hint}
            </Text>
          </View>
        </View>

        {canPickAgents && agents.length > 0 ? (
          <View className="gap-two">
            <Label>Agents</Label>
            <View className="flex-row flex-wrap gap-two">
              {agents.map((agent) => (
                <Pick
                  face={
                    <AgentCreature
                      creature={agentCreature(agent)}
                      size={26}
                      still
                    />
                  }
                  key={agent.id}
                  name={agent.name}
                  note={agent.role}
                  onToggle={() => setAgentIds((list) => toggle(list, agent.id))}
                  picked={agentIds.includes(agent.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {everyone.length > 0 ? (
          <View className="gap-two">
            <Label>People</Label>
            {everyone.length > SEARCH_FROM ? (
              <View className="h-10 flex-row items-center gap-two rounded-[12px] bg-surface-secondary px-three">
                <HugeiconsIcon color={muted} icon={Search01Icon} size={15} />
                <TextInput
                  accessibilityLabel="Find someone"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 p-0 text-[16px] text-foreground"
                  onChangeText={setQuery}
                  placeholder="Find someone"
                  placeholderTextColor={placeholder}
                  selectionColor={accent}
                  value={query}
                />
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-two">
              {shownPeople.map((member) => (
                <Pick
                  face={
                    <Avatar
                      avatarColor={member.avatarColor}
                      className="size-[26px]"
                      image={member.image}
                      name={member.name}
                      size="xs"
                    />
                  }
                  key={member.userId}
                  name={member.name}
                  onToggle={() =>
                    setPeopleIds((list) => toggle(list, member.userId))
                  }
                  picked={peopleIds.includes(member.userId)}
                />
              ))}
              {shownPeople.length === 0 ? (
                <Text className="py-two text-sm text-muted">
                  Nobody by that name.
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        <View className="gap-two">
          <Label>First message</Label>
          <TextInput
            accessibilityLabel="First message"
            className="min-h-[96px] rounded-lor-lg bg-surface-secondary px-four pb-three pt-three text-[16px] leading-[22px] text-foreground"
            maxLength={2000}
            multiline
            onChangeText={setText}
            placeholder="Say what it's for, or start it empty"
            placeholderTextColor={placeholder}
            selectionColor={accent}
            textAlignVertical="top"
            value={text}
          />
        </View>
      </KeyboardAwareScrollView>
    </Screen>
  )
}

function Label({ children }: { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      className="px-one text-[13px] font-semibold text-muted"
    >
      {children}
    </Text>
  )
}

// A person or agent to put in the chat: a chip that ticks when picked.
function Pick({
  face,
  name,
  note,
  picked,
  onToggle,
}: {
  face: ReactNode
  name: string
  note?: string | null
  picked: boolean
  onToggle: () => void
}) {
  const foreground = useThemeColor("foreground")
  return (
    <PressableScale
      accessibilityLabel={note ? `${name}, ${note}` : name}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: picked }}
      className={`h-10 flex-row items-center gap-two rounded-full border pl-[6px] pr-three ${
        picked
          ? "border-foreground/25 bg-surface-tertiary"
          : "border-border bg-transparent"
      }`}
      onPress={() => {
        triggerHaptic("selection")
        onToggle()
      }}
      scale={0.95}
    >
      {face}
      <Text
        className={`text-[15px] ${picked ? "font-semibold text-foreground" : "text-foreground"}`}
        numberOfLines={1}
      >
        {name}
      </Text>
      {note ? (
        <Text className="max-w-[120px] text-xs text-muted" numberOfLines={1}>
          {note}
        </Text>
      ) : null}
      {picked ? (
        <HugeiconsIcon
          color={foreground}
          icon={Tick02Icon}
          size={14}
          strokeWidth={2.6}
        />
      ) : null}
    </PressableScale>
  )
}
