import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon"
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon"
import ExternalLinkIcon from "@hugeicons/core-free-icons/ExternalLinkIcon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { router } from "expo-router"
import { useThemeColor } from "heroui-native/hooks"
import { useState } from "react"
import { Pressable, ScrollView, Text, View } from "react-native"
import type { Message } from "@/lib/api-types"
import { openExternalUrl } from "@/lib/open-url"

type Embed = Message["embeds"][number]

export function isAttioRecording(embed: Embed): boolean {
  return (
    embed.siteName === "Attio" &&
    (Boolean(embed.meeting) || embed.eventLabel === "Call recording ready")
  )
}

export function MeetingRecordingCard({
  embed,
  message,
  onOpenThread,
}: {
  embed: Embed
  message: Message
  onOpenThread?: (message: Message) => void
}) {
  const muted = useThemeColor("muted")
  const [transcriptExpanded, setTranscriptExpanded] = useState(false)
  const meeting = embed.meeting
  const transcript = meeting?.transcript ?? embed.description
  const isExcerpt = !meeting || meeting.transcriptTruncated
  const duration = meeting
    ? `${meeting.durationMinutes} min`
    : embed.fields?.find((field) => field.name === "Duration")?.value
  const recordingUrl =
    embed.url && /^https?:\/\//i.test(embed.url) ? embed.url : null

  // Opens a new session about this recording with the question prefilled.
  function ask(prompt: string) {
    router.push({
      pathname: "/session/new",
      params: {
        channelId: message.channelId,
        aboutMessageId: message.id,
        draft: prompt || undefined,
      },
    })
  }

  return (
    <View className="my-two w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface">
      <View className="gap-three p-four">
        <View className="flex-row flex-wrap items-center gap-x-two gap-y-one">
          <View className="size-1.5 rounded-full bg-[#d01e48]" />
          <Text className="text-[11px] font-medium text-muted">
            Meeting recording
          </Text>
          {duration ? (
            <Text className="text-[11px] font-medium tabular-nums text-muted">
              · {duration}
            </Text>
          ) : null}
          {recordingUrl ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Open recording in Attio"
              className="min-h-11 flex-row items-center gap-one rounded-sm active:opacity-60"
              onPress={() => openExternalUrl(recordingUrl)}
            >
              <Text className="text-[11px] font-medium text-muted">
                Open in Attio
              </Text>
              <HugeiconsIcon color={muted} icon={ExternalLinkIcon} size={12} />
            </Pressable>
          ) : null}
        </View>
        <View className="gap-1.5">
          <Text className="text-base font-semibold leading-[22px] tracking-tight text-foreground">
            {embed.title ?? "Call recording"}
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
          <Text className="text-sm leading-5 text-muted">
            The recording is ready. Explore the discussion with Lor.
          </Text>
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
                    This is an excerpt of the recording.
                  </Text>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        ) : null}
      </View>
      {onOpenThread && !message.threadRootId ? (
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
