import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet"
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon"
import UserAdd01Icon from "@hugeicons/core-free-icons/UserAdd01Icon"
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { Fragment, useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { KeyboardController } from "react-native-keyboard-controller"
import { Avatar } from "@/components/ui/avatar"
import { triggerHaptic } from "@/components/ui/haptics"
import {
  type ThreadSubscriber,
  useChannelPeople,
  useThreadSubscribers,
} from "@/hooks/use-thread-subscribers"
import type { AgentSession } from "@/lib/api-types"
import { authClient } from "@/lib/auth-client"

const VISIBLE_SUBSCRIBERS = 3

// Session and thread header: the subscriber faces, opening a sheet to follow,
// leave, and change who follows. Mirrors web's thread-subscribers.tsx.
export function ThreadSubscribers({
  workspaceSlug,
  channelId,
  channelName,
  threadRootId,
  session,
}: {
  workspaceSlug: string
  channelId: string
  channelName: string
  threadRootId: string
  // Set on a session, so following it moves its Channels-tab row at once.
  session?: AgentSession
}) {
  const muted = useThemeColor("muted")
  const background = useThemeColor("background")
  const [isOpen, setIsOpen] = useState(false)
  const { subscribers, setSubscribed, subscribeEveryone } =
    useThreadSubscribers({ workspaceSlug, channelId, threadRootId, session })
  const visible = subscribers.slice(0, VISIBLE_SUBSCRIBERS)
  const overflow = subscribers.length - visible.length

  return (
    <>
      <Pressable
        accessibilityHint="Opens the subscriber list"
        accessibilityLabel={`${subscribers.length} ${subscribers.length === 1 ? "subscriber" : "subscribers"}`}
        accessibilityRole="button"
        className="min-h-9 flex-row items-center rounded-full px-one active:bg-surface-secondary"
        hitSlop={6}
        onPress={() => setIsOpen(true)}
      >
        {subscribers.length > 0 ? (
          <>
            {visible.map((person, index) => (
              <Avatar
                avatarColor={person.avatarColor}
                className={index === 0 ? "size-6" : "-ml-two size-6"}
                fallback={person.name.charAt(0).toUpperCase()}
                image={person.image}
                key={person.id}
                name={person.name}
                size="xs"
                style={{ borderColor: background, borderWidth: 2 }}
              />
            ))}
            {overflow > 0 ? (
              <Text className="ml-one text-xs font-semibold text-muted">
                +{overflow}
              </Text>
            ) : null}
          </>
        ) : (
          <HugeiconsIcon color={muted} icon={UserAdd01Icon} size={18} />
        )}
      </Pressable>
      <SubscribersSheet
        channelId={channelId}
        channelName={channelName}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        onSubscribeEveryone={subscribeEveryone}
        onToggle={setSubscribed}
        subscribers={subscribers}
        workspaceSlug={workspaceSlug}
      />
    </>
  )
}

function SubscribersSheet({
  workspaceSlug,
  channelId,
  channelName,
  isOpen,
  onOpenChange,
  subscribers,
  onToggle,
  onSubscribeEveryone,
}: {
  workspaceSlug: string
  channelId: string
  channelName: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  subscribers: ThreadSubscriber[]
  onToggle: (person: ThreadSubscriber, subscribed: boolean) => void
  onSubscribeEveryone: (people: ThreadSubscriber[]) => void
}) {
  const [accentForeground, muted, placeholder] = useThemeColor([
    "accent-foreground",
    "muted",
    "field-placeholder",
  ])
  const { data: auth } = authClient.useSession()
  const currentUserId = auth?.user.id
  const people = useChannelPeople(workspaceSlug, channelId)
  const [query, setQuery] = useState("")
  // Frozen while the sheet is open, so rows don't jump as you tick them.
  const [subscribedAtOpen, setSubscribedAtOpen] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [wasOpen, setWasOpen] = useState(false)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setSubscribedAtOpen(new Set(subscribers.map((person) => person.id)))
      setQuery("")
    }
  }

  const subscribedIds = new Set(subscribers.map((person) => person.id))
  const everyoneSubscribed =
    people.length > 0 && people.every((person) => subscribedIds.has(person.id))
  // Subscribed people first, then everyone else, split by a rule. People who
  // lost channel access stay listed so they can be removed.
  const groups = useMemo(() => {
    const byId = new Map<string, ThreadSubscriber>()
    for (const subscriber of subscribers) byId.set(subscriber.id, subscriber)
    for (const person of people) {
      if (!byId.has(person.id)) byId.set(person.id, person)
    }
    const needle = query.trim().toLowerCase()
    const all = [...byId.values()]
      .filter((person) => !needle || person.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
    return [
      all.filter((person) => subscribedAtOpen.has(person.id)),
      all.filter((person) => !subscribedAtOpen.has(person.id)),
    ].filter((group) => group.length > 0)
  }, [subscribers, people, query, subscribedAtOpen])

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange}>
      <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
        <BottomSheet.Overlay className="bg-neutral-950/50" />
        <BottomSheet.Content
          enableDynamicSizing={false}
          keyboardBehavior="interactive"
          keyboardBlurBehavior="restore"
          // The composer's keyboard would cover the list.
          onAnimate={(fromIndex, toIndex) => {
            if (fromIndex !== -1 || toIndex < 0) return
            requestAnimationFrame(() => {
              void KeyboardController.dismiss().catch(() => undefined)
            })
          }}
          snapPoints={["70%", "92%"]}
        >
          <View className="flex-row items-start gap-three px-one pb-three">
            <View className="min-w-0 flex-1 gap-px">
              <BottomSheet.Title>Subscribers</BottomSheet.Title>
              <BottomSheet.Description>
                They see it under #{channelName} and get its notifications.
              </BottomSheet.Description>
            </View>
            <BottomSheet.Close />
          </View>
          <BottomSheetTextInput
            accessibilityLabel="Find people"
            autoCapitalize="none"
            className="mx-one mb-two min-h-11 rounded-lor-sm border border-border bg-surface px-three text-base text-foreground"
            onChangeText={setQuery}
            placeholder="Find people"
            placeholderTextColor={placeholder}
            value={query}
          />
          <BottomSheetScrollView
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Puts it under the channel for every member without posting
                in the chat. */}
            {!everyoneSubscribed && people.length > 1 && !query ? (
              <Pressable
                accessibilityRole="button"
                className="min-h-12 flex-row items-center gap-three rounded-lor-sm px-three active:bg-surface-secondary"
                onPress={() => {
                  triggerHaptic("soft")
                  onSubscribeEveryone(people)
                }}
              >
                <View className="size-5" />
                <View className="size-7 items-center justify-center">
                  <HugeiconsIcon color={muted} icon={UserGroupIcon} size={16} />
                </View>
                <Text className="min-w-0 flex-1 text-[15px] text-foreground">
                  Everyone in #{channelName}
                </Text>
              </Pressable>
            ) : null}
            {groups.length === 0 ? (
              <Text className="px-three py-three text-[15px] text-muted">
                No people found
              </Text>
            ) : null}
            {groups.map((group, index) => (
              <Fragment key={index === 0 ? "first" : "second"}>
                {index > 0 ? (
                  <View className="mx-three my-one h-px bg-separator" />
                ) : null}
                {group.map((person) => {
                  const subscribed = subscribedIds.has(person.id)
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: subscribed }}
                      className="min-h-12 flex-row items-center gap-three rounded-lor-sm px-three active:bg-surface-secondary"
                      key={person.id}
                      onPress={() => {
                        triggerHaptic("soft")
                        onToggle(person, !subscribed)
                      }}
                    >
                      <View
                        className={`size-5 items-center justify-center rounded-[6px] border ${
                          subscribed
                            ? "border-accent bg-accent"
                            : "border-border"
                        }`}
                      >
                        {subscribed ? (
                          <HugeiconsIcon
                            color={accentForeground}
                            icon={Tick02Icon}
                            size={12}
                            strokeWidth={3}
                          />
                        ) : null}
                      </View>
                      <Avatar
                        avatarColor={person.avatarColor}
                        className="size-7"
                        fallback={person.name.charAt(0).toUpperCase()}
                        image={person.image}
                        name={person.name}
                        size="xs"
                      />
                      <Text
                        className="min-w-0 flex-1 text-[15px] text-foreground"
                        numberOfLines={1}
                      >
                        {person.name}
                        {person.id === currentUserId ? (
                          <Text className="text-muted"> (you)</Text>
                        ) : null}
                      </Text>
                    </Pressable>
                  )
                })}
              </Fragment>
            ))}
          </BottomSheetScrollView>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  )
}
