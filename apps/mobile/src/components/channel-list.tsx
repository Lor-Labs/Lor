import { Pressable, Text, View } from "react-native"
import { SectionLabel, Skeleton } from "@/components/ui/primitives"
import type { Channel, ChannelCategory } from "@/lib/api-types"

function ChannelRow({
  channel,
  onPress,
}: {
  channel: Channel
  onPress: (channel: Channel) => void
}) {
  return (
    <Pressable
      accessibilityLabel={`Open ${channel.name}`}
      accessibilityRole="button"
      className="min-h-10 flex-row items-center gap-two rounded-lor-sm px-three active:bg-lor-pressed dark:active:bg-lor-pressed-dark"
      onPress={() => onPress(channel)}
    >
      <Text className="w-[17px] text-xl font-normal leading-[22px] text-lor-text-tertiary dark:text-lor-text-tertiary-dark">
        #
      </Text>
      <Text
        className="shrink-0 text-[15px] font-semibold leading-[21px] text-lor-text dark:text-lor-text-dark"
        numberOfLines={1}
      >
        {channel.name ?? "untitled"}
      </Text>
      {channel.topic ? (
        <Text
          className="ml-one flex-1 text-xs font-medium leading-4 text-lor-text-secondary dark:text-lor-text-secondary-dark"
          numberOfLines={1}
        >
          {channel.topic}
        </Text>
      ) : null}
    </Pressable>
  )
}

function ChannelSection({
  title,
  channels,
  onPress,
}: {
  title: string
  channels: Channel[]
  onPress: (channel: Channel) => void
}) {
  if (channels.length === 0) return null
  return (
    <View className="gap-[2px]">
      <View className="mb-one flex-row items-center gap-[3px] px-one">
        <Text className="-mt-one text-[17px] leading-[17px] text-lor-text-tertiary dark:text-lor-text-tertiary-dark">
          ⌄
        </Text>
        <SectionLabel>{title}</SectionLabel>
      </View>
      {channels.map((channel) => (
        <ChannelRow channel={channel} key={channel.id} onPress={onPress} />
      ))}
    </View>
  )
}

export function ChannelList({
  data,
  isLoading,
  onPress,
}: {
  data?: { uncategorized: Channel[]; categories: ChannelCategory[] }
  isLoading: boolean
  onPress: (channel: Channel) => void
}) {
  if (isLoading) return <ChannelListSkeleton />
  if (!data) return null

  return (
    <View className="gap-six pb-seven">
      <ChannelSection
        channels={data.uncategorized}
        onPress={onPress}
        title="Channels"
      />
      {data.categories.map((category) => (
        <ChannelSection
          channels={category.channels}
          key={category.id}
          onPress={onPress}
          title={category.name ?? "Channels"}
        />
      ))}
    </View>
  )
}

function ChannelListSkeleton() {
  return (
    <View className="gap-six pb-seven">
      {[0, 1].map((section) => (
        <View className="gap-[2px]" key={section}>
          <Skeleton className="mb-two ml-one h-[10px] w-20" />
          {[0, 1, 2, 3].map((row) => (
            <View
              className="min-h-10 flex-row items-center gap-two px-three"
              key={row}
            >
              <Skeleton className="h-4 w-4" />
              <Skeleton
                className={
                  row === 0
                    ? "h-[13px] w-[44%]"
                    : row === 1
                      ? "h-[13px] w-[53%]"
                      : row === 2
                        ? "h-[13px] w-[62%]"
                        : "h-[13px] w-[71%]"
                }
              />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}
