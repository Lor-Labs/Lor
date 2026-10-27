// Launch gates. Re-enable individually after approval and redeploy consumers.
// Signup and harness gates are also enforced on the server.
export const features: Readonly<{
  selfSignups: boolean
  claudeCodeHarness: boolean
  codexHarness: boolean
  directMessages: boolean
  voiceChannels: boolean
}> = {
  selfSignups: false,
  claudeCodeHarness: true,
  codexHarness: false,
  directMessages: false,
  voiceChannels: false,
}

export function isHarnessEnabled(harness: string): boolean {
  if (harness === "pi") return true
  if (harness === "claude_code") return features.claudeCodeHarness
  if (harness === "codex") return features.codexHarness
  return false
}

export function assertHarnessEnabled(harness: string): void {
  if (!isHarnessEnabled(harness)) {
    throw new Error(
      "This agent is temporarily unavailable. Start a session with Lor instead."
    )
  }
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
