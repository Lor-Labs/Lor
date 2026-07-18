import { useMemo, useState } from "react"
import { Pressable, Text, View } from "react-native"
import {
  type MemberListItem,
  MemberListSheet,
  workspaceMemberDetail,
} from "@/components/member-list-sheet"
import { Avatar } from "@/components/ui/avatar"
import type { ThreadMessageList, WorkspaceMember } from "@/lib/api-types"

type ThreadParticipant = ThreadMessageList["participants"][number]
export function ThreadParticipantStack({
  members,
  participants,
}: {
  members: WorkspaceMember[]
  participants: ThreadParticipant[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members]
  )
  const participantsWithPresence = useMemo(
    (): MemberListItem[] =>
      participants.map((participant) => {
        const member = memberById.get(participant.id)
        return {
          avatarColor: member?.avatarColor ?? participant.avatarColor ?? null,
          avatarName: member?.name ?? participant.name,
          detail: member ? workspaceMemberDetail(member) : "Thread participant",
          id: participant.id,
          image: participant.image,
          name: participantName(participant),
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
            name={participant.avatarName}
            avatarColor={participant.avatarColor}
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

      <MemberListSheet
        isOpen={isOpen}
        members={participantsWithPresence}
        onOpenChange={setIsOpen}
        title="Thread participants"
      />
    </>
  )
}

function PresenceAvatar({
  avatarColor,
  className = "",
  image,
  name,
  status,
  style,
}: {
  avatarColor: string | null
  className?: string
  image: string | null
  name: string
  status: WorkspaceMember["status"]
  style?: { zIndex: number }
}) {
  return (
    <View className={`relative ${className}`} style={style}>
      <View style={{ opacity: status === "offline" ? 0.5 : 1 }}>
        <Avatar
          avatarColor={avatarColor}
          className="border-2 border-background"
          image={image}
          name={name}
          size="xs"
        />
      </View>
    </View>
  )
}

function participantName(participant: ThreadParticipant) {
  return participant.displayUsername ?? participant.name
}
