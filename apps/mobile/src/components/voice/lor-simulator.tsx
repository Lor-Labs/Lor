import TestTube01Icon from "@hugeicons/core-free-icons/TestTube01Icon"
import { HugeiconsIcon } from "@hugeicons/react-native"
import { useLocalParticipant } from "@livekit/react-native"
import type {
  RealtimeVoiceBlock,
  VoiceRequestState,
} from "@repo/realtime-types/events"
import { mergeVoiceRequest } from "@repo/realtime-types/voice-requests"
import { type QueryClient, useQueryClient } from "@tanstack/react-query"
import { useThemeColor } from "heroui-native/hooks"
import { Alert } from "react-native"
import { IconButton } from "@/components/ui/icon-button"
import type { EntityCards } from "@/components/voice/lor-blocks"
import {
  entityCardsQueryKey,
  entityRefs,
  simulatedRequestId,
  voiceRequestsQueryKey,
} from "@/hooks/use-voice-requests"

// Dev only: plays scripted requests to Lor through Lor's window on this
// phone, so its layout can be tuned without speaking or a live connector.
// Nothing reaches the server or other devices.

const SAMPLE_CARDS: EntityCards = {
  linear: {
    connected: true,
    issues: [
      {
        id: "sample-412",
        identifier: "ENG-412",
        title: "Session refresh drops the auth cookie",
        url: "https://linear.app",
        state: "started",
        status: "In Progress",
        priority: "Urgent",
        assignee: "Jacob",
        team: "Engineering",
        project: "Release 0.7",
        labels: ["Bug", "Auth"],
        createdAt: "2026-09-28T16:00:00.000Z",
        updatedAt: "2026-10-03T09:00:00.000Z",
        startedAt: "2026-10-01T10:00:00.000Z",
        completedAt: null,
        dueDate: "2026-10-08",
        visuals: {
          priority: 1,
          assigneeAvatarUrl: null,
          labels: [
            { name: "Bug", color: "#eb5757" },
            { name: "Auth", color: "#4cb782" },
          ],
        },
      },
      {
        id: "sample-415",
        identifier: "ENG-415",
        title: "Retry the Deepgram stream on close code 1011",
        url: "https://linear.app",
        state: "unstarted",
        status: "Todo",
        priority: "Medium",
        assignee: null,
        team: "Engineering",
        project: "Release 0.7",
        labels: ["Voice"],
        createdAt: "2026-09-30T16:00:00.000Z",
        updatedAt: "2026-10-02T09:00:00.000Z",
        startedAt: null,
        completedAt: null,
        dueDate: null,
        visuals: {
          priority: 3,
          assigneeAvatarUrl: null,
          labels: [{ name: "Voice", color: "#bb87fc" }],
        },
      },
    ],
  },
  github: {
    connected: true,
    pullRequests: [
      {
        ref: "acme/app#142",
        title: "Refresh tokens on reconnect",
        url: "https://github.com",
        state: "open",
        author: "jacob",
        authorAvatarUrl: null,
        additions: 128,
        deletions: 34,
        review: "approved",
        checks: "passing",
        updatedAt: "2026-10-03T09:00:00.000Z",
      },
      {
        ref: "acme/app#151",
        title: "Move session storage to Redis",
        url: "https://github.com",
        state: "draft",
        author: "alice",
        authorAvatarUrl: null,
        additions: 412,
        deletions: 220,
        review: "changes_requested",
        checks: "failing",
        updatedAt: "2026-10-03T08:00:00.000Z",
      },
    ],
  },
}

type Ending =
  | { status: "done"; blocks: RealtimeVoiceBlock[] }
  | { status: "failed" }
  | { status: "awaiting_approval"; approval: VoiceRequestState["approval"] }

type Scenario = { label: string; heard: string; ending: Ending }

const SCENARIOS: Scenario[] = [
  {
    label: "Answers",
    heard: "Lor, what did we decide about pricing last week?",
    ending: {
      status: "done",
      blocks: [
        {
          type: "answer",
          markdown:
            "You kept **$20 per seat** and moved the free tier to 3 seats. Alice wanted annual-only discounts; that was left open.",
        },
      ],
    },
  },
  {
    label: "Linear issues and PRs",
    heard: "Lor, what's still open for the release?",
    ending: {
      status: "done",
      blocks: [
        {
          type: "linear_issues",
          title: "Release 0.7",
          issues: ["ENG-412", "ENG-415", "ENG-999"],
        },
        {
          type: "github_pull_requests",
          title: null,
          pullRequests: ["acme/app#142", "acme/app#151"],
        },
      ],
    },
  },
  {
    label: "Table",
    heard: "Lor, how are the open bugs split by team?",
    ending: {
      status: "done",
      blocks: [
        {
          type: "table",
          title: "Open bugs",
          columns: ["Team", "Open", "Urgent"],
          rows: [
            ["Platform", "7", "2"],
            ["Web", "4", "0"],
            ["Mobile", "5", "1"],
          ],
        },
      ],
    },
  },
  {
    label: "List and details",
    heard: "Lor, pull up the tickets I created yesterday",
    ending: {
      status: "done",
      blocks: [
        {
          type: "details",
          title: "Release 0.7",
          fields: [
            { label: "Open", value: "6 tickets" },
            { label: "Due", value: "Friday" },
          ],
        },
        {
          type: "list",
          title: "Created yesterday",
          items: [
            {
              title: "ENG-412 Session refresh drops the auth cookie",
              detail: "In progress · Jacob",
              url: null,
            },
            {
              title: "ENG-415 Retry Deepgram stream on 1011",
              detail: "Todo · unassigned",
              url: null,
            },
          ],
        },
      ],
    },
  },
  {
    label: "Asks which one",
    heard: "Lor, open the auth PR",
    ending: {
      status: "done",
      blocks: [
        {
          type: "question",
          prompt: "Two open pull requests touch auth. Which one?",
          choices: [
            "#142 Refresh tokens on reconnect",
            "#151 Move session storage to Redis",
          ],
        },
      ],
    },
  },
  {
    label: "Needs approval",
    heard: "Lor, file a ticket for the Deepgram retry",
    ending: {
      status: "awaiting_approval",
      approval: {
        approvalId: "dev-sim-approval",
        label: "Create Linear issue “Retry the Deepgram stream on 1011”",
        toolName: "create_linear_issue",
        approvers: [{ userId: "dev-sim", name: "Alice" }],
      },
    },
  },
  {
    label: "Fails",
    heard: "Lor, check the deploy logs",
    ending: { status: "failed" },
  },
]

const LISTEN_MS = 1_500
const WORK_MS = 2_000

function play(
  queryClient: QueryClient,
  sessionId: string,
  participantId: string,
  scenario: Scenario
) {
  const id = simulatedRequestId()
  const createdAt = new Date().toISOString()
  const queryKey = voiceRequestsQueryKey(sessionId)
  const set = (patch: Partial<VoiceRequestState>) => {
    const list = queryClient.getQueryData<VoiceRequestState[]>(queryKey) ?? []
    // Cancelled from the window: the scenario stops.
    if (list.find((entry) => entry.id === id)?.status === "cancelled") return
    const request: VoiceRequestState = {
      id,
      sessionId,
      participantId,
      userId: participantId,
      heardText: scenario.heard,
      status: "listening",
      result: null,
      finishedAt: null,
      dismissedAt: null,
      stagedAt: null,
      approval: null,
      createdAt,
      ...list.find((entry) => entry.id === id),
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    queryClient.setQueryData<VoiceRequestState[]>(queryKey, (current) =>
      mergeVoiceRequest(current ?? [], request)
    )
  }

  set({ status: "listening" })
  setTimeout(() => set({ status: "working" }), LISTEN_MS)
  setTimeout(() => {
    const { ending } = scenario
    if (ending.status === "done") {
      const finished: Partial<VoiceRequestState> = {
        status: "done",
        result: { blocks: ending.blocks },
        finishedAt: new Date().toISOString(),
      }
      const refs = entityRefs({ result: { blocks: ending.blocks } })
      if (refs) {
        queryClient.setQueryData(entityCardsQueryKey(id, refs), SAMPLE_CARDS)
      }
      set(finished)
    } else if (ending.status === "failed") {
      set({ status: "failed", finishedAt: new Date().toISOString() })
    } else {
      set({ status: "awaiting_approval", approval: ending.approval })
    }
  }, LISTEN_MS + WORK_MS)
}

// A test-tube button in the call controls, only in development builds.
export function LorSimulatorButton({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient()
  const { localParticipant } = useLocalParticipant()
  const [foreground] = useThemeColor(["foreground"])
  if (!__DEV__) return null

  const open = () =>
    Alert.alert("Simulate Lor (dev)", undefined, [
      ...SCENARIOS.map((scenario) => ({
        text: scenario.label,
        onPress: () =>
          play(queryClient, sessionId, localParticipant.identity, scenario),
      })),
      { text: "Cancel", style: "cancel" as const },
    ])

  return (
    <IconButton
      accessibilityLabel="Simulate a request to Lor"
      onPress={open}
      variant="secondary"
    >
      <HugeiconsIcon
        color={foreground}
        icon={TestTube01Icon}
        size={20}
        strokeWidth={2}
      />
    </IconButton>
  )
}
