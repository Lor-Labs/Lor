import ArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/ArrowDataTransferHorizontalIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { LOR_USER_ID } from "@repo/db/constants"
import { useThemeColor } from "heroui-native/hooks"
import type { ReactNode } from "react"
import { Pressable, Text, View } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"
import { Avatar } from "@/components/ui/avatar"
import { LorMark } from "@/components/voice/lor-window"
import type { Message } from "@/lib/api-types"
import type { MentionCandidate } from "@/lib/mentions"

// Where the composer's message goes: channel chat and human threads start a
// session on @Lor; inside a session a message goes to Lor or to the session's
// subscribers. Mirrors web's destination-bar.tsx.
export type ComposerDestination = "channel" | "thread" | "session"

export type PingedPerson = {
  id: string
  name: string
  image: string | null
  avatarColor: string | null
}

const MAX_SUBSCRIBER_FACES = 3
const swapIn = FadeIn.duration(160)
const swapOut = FadeOut.duration(120)

// The session routing rule as the sender sees it. The server decides the
// same way (sessionMessageRunsLor in apps/realtime lor-routing.ts): a plain
// message goes to Lor; addressing a teammate (mention, or reply to someone
// else) leaves Lor out unless Lor is addressed too.
export function composerRouting({
  destination,
  mentionedIds,
  replyingTo,
  currentUserId,
  candidates,
  manualToPeople,
  peopleOnly = false,
}: {
  destination: ComposerDestination | undefined
  mentionedIds: string[]
  replyingTo: Message | null | undefined
  currentUserId: string | undefined
  candidates: MentionCandidate[]
  manualToPeople: boolean
  // Session only: the agent can't answer this person (its harness is off, or
  // Claude Code without their subscription), so the server sends every
  // message to people.
  peopleOnly?: boolean
}) {
  const isSession = destination === "session"
  const pinged = new Map<string, PingedPerson>()
  for (const id of mentionedIds) {
    const candidate = candidates.find((item) => item.id === id)
    if (!candidate || id === LOR_USER_ID) continue
    pinged.set(id, {
      id,
      name: candidate.name,
      image: candidate.image ?? null,
      avatarColor: candidate.avatarColor ?? null,
    })
  }
  const replyAuthor = replyingTo?.author
  if (
    isSession &&
    replyAuthor &&
    replyAuthor.id !== LOR_USER_ID &&
    replyAuthor.id !== currentUserId
  ) {
    pinged.set(replyAuthor.id, {
      id: replyAuthor.id,
      name: replyAuthor.name,
      image: replyAuthor.image ?? null,
      avatarColor: null,
    })
  }
  const addressesLor =
    mentionedIds.includes(LOR_USER_ID) ||
    (isSession && replyingTo?.author.id === LOR_USER_ID)
  const toLor = isSession
    ? !peopleOnly && (addressesLor || (!manualToPeople && pinged.size === 0))
    : addressesLor
  return {
    toLor,
    pinged: [...pinged.values()],
    canSwitch: isSession && !peopleOnly && !addressesLor && pinged.size === 0,
  }
}

// In the toolbar under the text, so the field never moves while someone
// types "@Lor"; the Lor and people states fade into each other.
export function DestinationBar({
  destination,
  channelName,
  toLor,
  pinged,
  subscribers = [],
  onSwitch,
}: {
  destination: ComposerDestination
  channelName: string
  toLor: boolean
  pinged: PingedPerson[]
  // Session only: who a message to people reaches, without you.
  subscribers?: PingedPerson[]
  // Session only, when nothing in the message decides the destination.
  onSwitch?: () => void
}) {
  const isSession = destination === "session"
  // A session message reaches its subscribers, and the people it mentions
  // follow once it sends: mentioned first, so "+N" never hides them.
  const reached = [
    ...pinged.map(
      (person) =>
        subscribers.find((subscriber) => subscriber.id === person.id) ?? person
    ),
    ...subscribers.filter(
      (subscriber) => !pinged.some((person) => person.id === subscriber.id)
    ),
  ]
  const extraFaces = reached.length - MAX_SUBSCRIBER_FACES
  return (
    <View className="min-w-0 flex-1 flex-row items-center">
      {toLor ? (
        <Animated.View
          className="min-w-0 flex-1 flex-row items-center gap-two"
          entering={swapIn}
          exiting={swapOut}
          key="lor"
        >
          {/* Quiet in a session, where Lor is the default; chat and threads
              tint it, since there it changes what the send does. */}
          <DestinationPill onSwitch={onSwitch} tinted={!isSession}>
            <LorMark size={14} />
            <Text
              className={`shrink text-xs font-medium ${
                isSession ? "text-muted" : "text-accent"
              }`}
              numberOfLines={1}
            >
              {isSession
                ? "To Lor"
                : destination === "thread"
                  ? "New session from this thread"
                  : `New session in #${channelName}`}
            </Text>
          </DestinationPill>
          {pinged.length > 0 ? (
            <PingedPeople
              label={isSession ? "Notifies" : "Adds"}
              people={pinged}
            />
          ) : null}
        </Animated.View>
      ) : (
        <Animated.View
          className="min-w-0 flex-1 flex-row items-center gap-two"
          entering={swapIn}
          exiting={swapOut}
          key="people"
        >
          {isSession ? (
            <DestinationPill
              accessibilityLabel={
                reached.length > 0
                  ? `To ${reached.map((person) => person.name).join(", ")}`
                  : undefined
              }
              onSwitch={onSwitch}
            >
              <Text className="text-xs font-medium text-muted">
                {reached.length > 0 ? "To" : "To subscribers"}
              </Text>
              {reached.length > 0 ? (
                <Faces people={reached.slice(0, MAX_SUBSCRIBER_FACES)} />
              ) : null}
              {extraFaces > 0 ? (
                <Text className="text-xs font-medium text-muted">
                  +{extraFaces}
                </Text>
              ) : null}
            </DestinationPill>
          ) : null}
          {!isSession && pinged.length > 0 ? (
            <PingedPeople label="Notifies" people={pinged} />
          ) : null}
        </Animated.View>
      )}
    </View>
  )
}

function DestinationPill({
  accessibilityLabel,
  onSwitch,
  tinted = false,
  children,
}: {
  accessibilityLabel?: string
  onSwitch?: () => void
  tinted?: boolean
  children: ReactNode
}) {
  const muted = useThemeColor("muted")
  const className = `min-h-7 shrink flex-row items-center gap-[6px] rounded-lor-sm px-two ${
    tinted ? "bg-accent-soft" : ""
  }`
  if (!onSwitch) {
    return (
      <View
        accessibilityLabel={accessibilityLabel}
        accessible={Boolean(accessibilityLabel)}
        className={className}
      >
        {children}
      </View>
    )
  }
  return (
    <Pressable
      accessibilityHint="Switches who this message goes to"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className={`${className} active:bg-default`}
      hitSlop={6}
      onPress={onSwitch}
    >
      {children}
      <HugeiconsIcon
        color={muted}
        icon={ArrowDataTransferHorizontalIcon}
        size={12}
      />
    </Pressable>
  )
}

function PingedPeople({
  people,
  label,
}: {
  people: PingedPerson[]
  label: string
}) {
  return (
    <View className="min-w-0 shrink flex-row items-center gap-[6px]">
      <Faces people={people.slice(0, 3)} />
      <Text className="shrink text-xs text-muted" numberOfLines={1}>
        {label} {people.map((person) => person.name.split(" ")[0]).join(", ")}
      </Text>
    </View>
  )
}

function Faces({ people }: { people: PingedPerson[] }) {
  const background = useThemeColor("background")
  return (
    <View className="flex-row">
      {people.map((person, index) => (
        <Avatar
          avatarColor={person.avatarColor}
          className={index === 0 ? "size-4" : "-ml-one size-4"}
          fallback={person.name.charAt(0).toUpperCase()}
          image={person.image}
          key={person.id}
          name={person.name}
          size="xs"
          style={{ borderColor: background, borderWidth: 1 }}
        />
      ))}
    </View>
  )
}
