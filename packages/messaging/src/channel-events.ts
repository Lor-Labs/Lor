// Plain-text rendering of a channel event, stored as the message content.
// Clients render events from eventType/eventPayload; this string is the
// search + stale-client fallback, so it must always read as a full sentence.

export type ChannelEventContentInput =
  | {
      eventType: "channel_created"
      actorName: string
      viaProposal?: boolean
      originChannelName?: string
    }
  | {
      eventType: "channel_renamed"
      actorName: string
      from: string
      to: string
    }
  | { eventType: "member_added"; actorName: string; memberNames: string[] }
  | { eventType: "member_removed"; actorName: string; memberName: string }
  | { eventType: "member_left"; actorName: string }
  | {
      eventType: "loop_created"
      actorName: string
      loopName: string
      viaProposal?: boolean
    }
  | {
      eventType: "loop_paused"
      loopName: string
      reason: "failures" | "out_of_credits"
    }
  | { eventType: "loop_completed"; actorName: string; loopName: string }
  | { eventType: "loop_run"; loopName: string }
  | {
      eventType: "session_continued"
      actorName: string
      repoFullName: string | null
      // The new session's anchor: Lor reads it with read_thread.
      threadRootId: string
    }
  | {
      eventType: "session_committed"
      actorName: string
      sha: string
      subject: string
      branch: string | null
      fileCount: number
    }
  | {
      eventType: "session_pushed"
      actorName: string
      repoFullName: string
      branch: string
      commitCount: number
      headSha: string
    }
  | {
      eventType: "session_forked"
      actorName: string
      // The reply it was forked at, and the new session's anchor (Lor reads
      // it with read_thread).
      fromMessageId: string
      threadRootId: string
    }
  | {
      eventType: "session_rewound"
      actorName: string
      toMessageId: string
      code: boolean
    }
  | {
      eventType: "session_setup_changed"
      actorName: string
      // Undefined: unchanged. Null: no environment.
      environmentName?: string | null
      // Set when the sandbox was replaced at this size.
      sandboxMemoryMb?: number
    }
  | {
      eventType: "session_reviewed"
      reviewer: string
      reviewerBot: boolean
      state: "approved" | "changes_requested" | "commented"
      pullRequestNumber: number
      repoFullName: string
    }
  | {
      eventType: "session_pr_opened" | "session_pr_merged"
      actorName: string
      pullRequestNumber: number
      pullRequestUrl: string
      headBranch: string
      baseBranch: string
      repoFullName: string
    }

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export function channelEventContent(input: ChannelEventContentInput): string {
  switch (input.eventType) {
    case "channel_created":
      if (input.viaProposal) {
        return input.originChannelName
          ? `${input.actorName} created this channel from an approved change proposal in #${input.originChannelName}`
          : `${input.actorName} created this channel from an approved change proposal`
      }
      return `${input.actorName} created this channel`
    case "channel_renamed":
      return `${input.actorName} renamed the channel from #${input.from} to #${input.to}`
    case "member_added":
      return `${input.actorName} added ${joinNames(input.memberNames)}`
    case "member_removed":
      return `${input.actorName} removed ${input.memberName}`
    case "member_left":
      return `${input.actorName} left the channel`
    case "loop_created":
      return input.viaProposal
        ? `${input.actorName} created the loop "${input.loopName}" from an approved change proposal`
        : `${input.actorName} created the loop "${input.loopName}"`
    case "loop_paused":
      return input.reason === "out_of_credits"
        ? `The loop "${input.loopName}" was paused — out of credits`
        : `The loop "${input.loopName}" was paused after repeated failures`
    case "loop_completed":
      return `${input.actorName} completed the loop "${input.loopName}"`
    case "loop_run":
      return `The loop "${input.loopName}" ran on schedule`
    case "session_continued":
      return `${input.actorName} continued this session in a new code session${input.repoFullName ? ` on ${input.repoFullName}` : ""} (message ${input.threadRootId})`
    case "session_committed":
      return `${input.actorName} committed ${input.fileCount} ${input.fileCount === 1 ? "file" : "files"}${input.branch ? ` to ${input.branch}` : ""}: "${input.subject}" (${input.sha.slice(0, 7)})`
    case "session_pushed":
      return `${input.actorName} pushed ${input.commitCount} ${input.commitCount === 1 ? "commit" : "commits"} to ${input.branch} on ${input.repoFullName} (${input.headSha.slice(0, 7)})`
    case "session_forked":
      return `${input.actorName} forked this session at Lor's reply ${input.fromMessageId} into a new session (message ${input.threadRootId})`
    // Posted as Lor, so Lor's own conversation leaves it out; review text is
    // untrusted and reaches Lor only through a person's Fix with Lor.
    case "session_reviewed":
      return `${input.reviewer}${input.reviewerBot ? " (bot)" : ""} ${input.state === "approved" ? "approved" : input.state === "changes_requested" ? "requested changes on" : "reviewed"} pull request #${input.pullRequestNumber} on ${input.repoFullName}`
    // Lor reads these. The PR title is left out: it is untrusted text.
    case "session_pr_opened":
      return `${input.actorName} opened pull request #${input.pullRequestNumber} from ${input.headBranch} into ${input.baseBranch} on ${input.repoFullName} (${input.pullRequestUrl})`
    case "session_pr_merged":
      return `${input.actorName} merged pull request #${input.pullRequestNumber} from ${input.headBranch} into ${input.baseBranch} on ${input.repoFullName} (${input.pullRequestUrl})`
    // Lor reads it: a replaced sandbox lost everything outside the restore.
    case "session_setup_changed": {
      const parts: string[] = []
      if (input.environmentName !== undefined) {
        parts.push(
          input.environmentName
            ? `set this session's environment to "${input.environmentName}"`
            : "removed this session's environment"
        )
      }
      if (input.sandboxMemoryMb !== undefined) {
        parts.push(
          `replaced this session's sandbox with a ${input.sandboxMemoryMb / 1024} GB one: the work folder comes back from Lor's last turn, and installed packages, running servers and files outside the repo are gone`
        )
      }
      return `${input.actorName} ${parts.join(", and ")}`
    }
    // Lor reads this as the next turn's first line: it says what happened,
    // never what the rewound turns said.
    case "session_rewound":
      return `${input.actorName} rewound this session to Lor's reply ${input.toMessageId}: Lor continues from that reply, and what came after it is set aside${input.code ? "; the work folder is back to that turn's files, branch and commits" : "; files in Lor's sandbox stay as they are"}. Anything already pushed to GitHub or sent elsewhere stays as it is.`
  }
}
