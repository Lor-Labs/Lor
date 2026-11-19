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
  codexHarness: true,
  directMessages: false,
  voiceChannels: false,
}

// Harnesses hosted beta allows: Lor's own agent, Claude Code on the person's
// own Claude subscription and Codex on their own ChatGPT plan (neither draws
// on the shared credit pool for inference). The server enforces the same set
// in `assertHostedHarness`; clients use this to hide and refuse the rest.
export const HOSTED_BETA_HARNESSES: readonly string[] = [
  "pi",
  "claude_code",
  "codex",
]

export function isHarnessAllowedInBeta(harness: string): boolean {
  return HOSTED_BETA_HARNESSES.includes(harness)
}

export function isHarnessEnabled(harness: string): boolean {
  if (harness === "pi") return true
  if (harness === "claude_code") return features.claudeCodeHarness
  if (harness === "codex") return features.codexHarness
  return false
}

export class HarnessDisabledError extends Error {
  constructor() {
    super(
      "This agent is temporarily unavailable. Start a session with Lor instead."
    )
    this.name = "HarnessDisabledError"
  }
}

export function assertHarnessEnabled(harness: string): void {
  if (!isHarnessEnabled(harness)) throw new HarnessDisabledError()
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
