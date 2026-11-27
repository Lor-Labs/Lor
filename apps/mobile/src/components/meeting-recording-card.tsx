import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import type { Message } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

type Embed = Message["embeds"][number]

// Attio call recordings and Granola and Circleback meeting notes share one card.
export function isMeetingCard(embed: Embed): boolean {
  if (embed.siteName === "Granola" || embed.siteName === "Circleback") {
    return Boolean(embed.meeting)
  }
  return (
    embed.siteName === "Attio" &&
    (Boolean(embed.meeting) || embed.eventLabel === "Call recording ready")
  )
}

const MEETING_SITES = {
  Attio: { color: "#d01e48", notes: false },
  Granola: { color: "#b2c248", notes: true },
  Circleback: { color: "#f24e1d", notes: true },
} as const

function meetingCopy(embed: Embed) {
  const site =
    embed.siteName === "Granola" || embed.siteName === "Circleback"
      ? embed.siteName
      : "Attio"
  // Granola and Circleback send meeting notes; Attio a call recording.
  const { color, notes } = MEETING_SITES[site]
  return {
    site,
    color,
    kind: notes ? "Meeting notes" : "Meeting recording",
    fallbackTitle: notes ? "Meeting" : "Call recording",
    ready: notes
      ? "The notes are ready. Explore the meeting with Lor."
      : "The recording is ready. Explore the discussion with Lor.",
    excerpt: notes
      ? "This is an excerpt of the meeting."
      : "This is an excerpt of the recording.",
  }
}

export function MeetingRecordingCard({
  embed,
  message,
  onAskLor,
}: {
  embed: Embed
  message: Message
  // Asks the channel's agent in the chat, about this recording.
  onAskLor?: (message: Message, prompt?: string) => void
}) {
  const muted = useThemeColor("muted")
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)
  const meeting = embed.meeting
  const copy = meetingCopy(embed)
  const transcript = meeting?.transcript ?? embed.description
  const isExcerpt = !meeting || meeting.transcriptTruncated
  const duration = meeting?.durationMinutes
    ? `${meeting.durationMinutes} min`
    : embed.fields?.find((field) => field.name === "Duration")?.value
  const recordingUrl =
    embed.url && /^https?:\/\//i.test(embed.url) ? embed.url : null

  function ask(prompt: string) {
    onAskLor?.(message, prompt || undefined)
  }

  return (
    <View className="my-two w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface">
      <View className="gap-three p-four">
        <View className="flex-row flex-wrap items-center gap-x-two gap-y-one">
          <View
            className="size-1.5 rounded-full"
            style={{ backgroundColor: copy.color }}
          />
          <Text className="text-[11px] font-medium text-muted">
            {copy.kind}
          </Text>
          {duration ? (
            <Text className="text-[11px] font-medium tabular-nums text-muted">
              · {duration}
            </Text>
          ) : null}
          {recordingUrl ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open in ${copy.site}`}
              className="min-h-11 flex-row items-center gap-one rounded-sm active:opacity-60"
              onPress={() => openExternalUrl(recordingUrl)}
            >
              <Text className="text-[11px] font-medium text-muted">
                Open in {copy.site}
              </Text>
              <HugeiconsIcon color={muted} icon={ExternalLinkIcon} size={12} />
            </Pressable>
          ) : null}
        </View>
        <View className="gap-1.5">
          <Text className="text-base font-semibold leading-[22px] tracking-tight text-foreground">
            {embed.title ?? copy.fallbackTitle}
          </Text>
          {meeting?.participants?.length ? (
            <Text className="text-xs leading-[18px] text-muted">
              {meeting.participants.join(" · ")}
            </Text>
          ) : null}
        </View>
        {meeting?.summary ? (
          <Text className="text-sm leading-[21px] text-foreground/80">
            {meeting.summary}
          </Text>
        ) : (
          <Text className="text-sm leading-5 text-muted">{copy.ready}</Text>
        )}
        {transcript ? (
          <View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: transcriptExpanded }}
              className="min-h-11 flex-row items-center gap-one self-start rounded-sm active:opacity-60"
              onPress={() => setTranscriptExpanded((expanded) => !expanded)}
            >
              <HugeiconsIcon
                color={muted}
                icon={transcriptExpanded ? ArrowDown01Icon : ArrowRight01Icon}
                size={14}
              />
              <Text className="text-xs text-muted">
                {transcriptExpanded ? "Hide" : "View"} transcript
                {isExcerpt ? " excerpt" : ""}
              </Text>
            </Pressable>
            {transcriptExpanded ? (
              <ScrollView
                className="mt-one max-h-64 rounded-lg bg-surface-secondary"
                nestedScrollEnabled
                contentContainerStyle={{ padding: 12, gap: 12 }}
              >
                <Text selectable className="text-xs leading-[18px] text-muted">
                  {transcript}
                </Text>
                {isExcerpt ? (
                  <Text className="text-xs font-medium text-muted">
                    {copy.excerpt}
                  </Text>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        ) : null}
      </View>
      {onAskLor && !message.threadRootId ? (
        <View className="gap-2.5 border-t border-border bg-surface-secondary px-four py-three">
          <Text className="text-[11px] font-medium text-muted">
            Explore with Lor
          </Text>
          <View className="flex-row flex-wrap gap-two">
            {meeting?.followUps?.map((followUp) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={followUp.prompt}
                className="min-h-11 max-w-full justify-center rounded-lg border border-border bg-background px-2.5 py-1.5 active:opacity-60"
                key={followUp.prompt}
                onPress={() => ask(followUp.prompt)}
              >
                <Text className="text-xs leading-[18px] text-foreground">
                  {followUp.label} ↗
                </Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              className="min-h-11 justify-center rounded-lg border border-dashed border-border px-2.5 py-1.5 active:opacity-60"
              onPress={() => ask("")}
            >
              <Text className="text-xs text-muted">Ask a follow-up ↗</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  )
}
