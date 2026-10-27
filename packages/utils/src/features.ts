// Launch gates. Re-enable either feature here and rebuild the affected apps.
// These control product visibility, not API authorization.
export const features: Readonly<{
  directMessages: boolean
  voiceChannels: boolean
}> = {
  directMessages: false,
  voiceChannels: false,
}

export function isChannelFeatureEnabled(channel: { type: string }): boolean {
  if (channel.type === "voice") return features.voiceChannels
  if (channel.type === "dm" || channel.type === "group_dm") {
    return features.directMessages
  }
  return true
}

export function visibleChannels<
  Channel extends { type: string },
  Category extends { channels: Channel[] },
>(data: { uncategorized: Channel[]; categories: Category[] }) {
  return {
    ...data,
    uncategorized: data.uncategorized.filter(isChannelFeatureEnabled),
    categories: data.categories.map((category) => ({
      ...category,
      channels: category.channels.filter(isChannelFeatureEnabled),
    })),
  }
}
