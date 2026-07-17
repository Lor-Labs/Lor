import { BottomSheetScrollView } from "@gorhom/bottom-sheet"
import UserGroupIcon from "@hugeicons/core-free-icons/UserGroupIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { BottomSheet } from "heroui-native/bottom-sheet"
import { useThemeColor } from "heroui-native/hooks"
import { useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Avatar, type AvatarSize } from "@/components/ui/avatar"
import { SectionLabel } from "@/components/ui/section-label"
import type { ThreadMessageList, WorkspaceMember } from "@/lib/api-types"

type ThreadParticipant = ThreadMessageList["participants"][number]
type PresenceStatus = WorkspaceMember["status"]

type ParticipantWithPresence = ThreadParticipant & {
  member?: WorkspaceMember
  status: PresenceStatus
}

export function ThreadParticipantStack({
  members,
  participants,
}: {
  members: WorkspaceMember[]
  participants: ThreadParticipant[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const foreground = useThemeColor("foreground")
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members]
  )
  const participantsWithPresence = useMemo(
    () =>
      participants.map((participant) => {
        const member = memberById.get(participant.id)
        return {
          ...participant,
          member,
          status: member?.status ?? "offline",
        }
      }),
    [memberById, participants]
  )

  if (participants.length === 0) return null

  const visibleParticipants = participantsWithPresence.slice(0, 5)
  const overflowCount = participants.length - visibleParticipants.length
  const onlineParticipants = participantsWithPresence.filter(
    (participant) => participant.status === "online"
  )
  const offlineParticipants = participantsWithPresence.filter(
    (participant) => participant.status === "offline"
  )

  return (
    <>
      <Pressable
        accessibilityHint="Opens the full participant list"
        accessibilityLabel={`${participants.length} thread ${participants.length === 1 ? "participant" : "participants"}, ${onlineParticipants.length} online`}
        accessibilityRole="button"
        className="ml-auto flex-row items-center justify-end rounded-lor-sm py-one pl-two active:opacity-70"
        hitSlop={8}
        onPress={() => setIsOpen(true)}
      >
        {visibleParticipants.map((participant, index) => (
          <PresenceAvatar
            className={index === 0 ? "" : "-ml-two"}
            image={participant.image}
            key={participant.id}
            name={participantName(participant)}
            size="xs"
            status={participant.status}
            style={{ zIndex: visibleParticipants.length - index }}
          />
        ))}
        {overflowCount > 0 ? (
          <View className="ml-two min-h-7 items-center justify-center rounded-lor-sm bg-surface-secondary px-two">
            <Text className="text-xs font-semibold text-muted">
              +{overflowCount} more
            </Text>
          </View>
        ) : null}
      </Pressable>

      <BottomSheet isOpen={isOpen} onOpenChange={setIsOpen}>
        <BottomSheet.Portal unstable_accessibilityContainerViewIsModal>
          <BottomSheet.Overlay className="bg-neutral-950/50" />
          <BottomSheet.Content
            enableDynamicSizing={false}
            snapPoints={["58%", "88%"]}
          >
            <BottomSheetScrollView
              contentContainerStyle={{ gap: 24, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            >
              <View className="flex-row items-start gap-three px-one">
                <View className="size-10 items-center justify-center rounded-lor-sm bg-surface-secondary">
                  <HugeiconsIcon
                    color={foreground}
                    icon={UserGroupIcon}
                    size={20}
                    strokeWidth={1.8}
                  />
                </View>
                <View className="min-w-0 flex-1 gap-px">
                  <BottomSheet.Title>Thread participants</BottomSheet.Title>
                  <BottomSheet.Description>
                    {participants.length}{" "}
                    {participants.length === 1 ? "person" : "people"} ·{" "}
                    {onlineParticipants.length} online
                  </BottomSheet.Description>
                </View>
                <BottomSheet.Close />
              </View>

              {onlineParticipants.length > 0 ? (
                <ParticipantSection
                  label={`Online · ${onlineParticipants.length}`}
                  participants={onlineParticipants}
                />
              ) : null}

              {offlineParticipants.length > 0 ? (
                <ParticipantSection
                  label={`Offline · ${offlineParticipants.length}`}
                  participants={offlineParticipants}
                />
              ) : null}
            </BottomSheetScrollView>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </>
  )
}

function ParticipantSection({
  label,
  participants,
}: {
  label: string
  participants: ParticipantWithPresence[]
}) {
  return (
    <View className="gap-two px-one">
      <SectionLabel>{label}</SectionLabel>
      <View className="overflow-hidden rounded-lor-lg bg-surface-secondary">
        {participants.map((participant, index) => (
          <View key={participant.id}>
            {index > 0 ? (
              <View className="ml-[68px] h-px bg-separator" />
            ) : null}
            <ParticipantRow participant={participant} />
          </View>
        ))}
      </View>
    </View>
  )
}

function ParticipantRow({
  participant,
}: {
  participant: ParticipantWithPresence
}) {
  const name = participantName(participant)
  const detail = participant.member
    ? participant.member.isBot
      ? "App"
      : participant.member.isOwner
        ? "Workspace owner"
        : formatRole(participant.member.role)
    : "Thread participant"

  return (
    <View
      accessibilityLabel={`${name}, ${detail}, ${participant.status}`}
      className="min-h-[68px] flex-row items-center gap-three px-three py-two"
    >
      <PresenceAvatar
        image={participant.image}
        name={name}
        size="sm"
        status={participant.status}
      />
      <View className="min-w-0 flex-1 gap-px">
        <Text
          className="text-[15px] font-semibold text-foreground"
          numberOfLines={1}
        >
          {name}
        </Text>
        <Text className="text-xs text-muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View className="flex-row items-center gap-two">
        <View
          className={`size-two rounded-full ${participant.status === "online" ? "bg-success" : "bg-danger"}`}
        />
        <Text className="text-xs font-medium capitalize text-muted">
          {participant.status}
        </Text>
      </View>
    </View>
  )
}

function PresenceAvatar({
  className = "",
  image,
  name,
  size,
  status,
  style,
}: {
  className?: string
  image: string | null
  name: string
  size: AvatarSize
  status: PresenceStatus
  style?: { zIndex: number }
}) {
  return (
    <View className={`relative ${className}`} style={style}>
      <View style={{ opacity: status === "offline" ? 0.5 : 1 }}>
        <Avatar
          className={size === "xs" ? "border-2 border-background" : undefined}
          image={image}
          name={name}
          size={size}
        />
      </View>
    </View>
  )
}

function participantName(participant: ThreadParticipant) {
  return participant.displayUsername ?? participant.name
}

function formatRole(role: string) {
  return role
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
