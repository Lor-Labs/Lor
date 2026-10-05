import type {
  RealtimeVoiceBlock,
  VoiceRequestState,
} from "@repo/realtime-types/events"
import { useQuery } from "@tanstack/react-query"
import { useThemeColor } from "heroui-native/hooks"
import { cn } from "heroui-native/utils"
import { Pressable, Text, View } from "react-native"
import { ConnectorIcon } from "@/components/connector-icon"
import { MessageContent } from "@/components/message-content"
import { api } from "@/lib/api"
import { openExternalUrl } from "@/lib/open-url"

// What Lor composed for its window, read-only on the phone: the same blocks
// as web, with Linear and GitHub cards as compact rows.

// Cards stay live while shown, like web.
const CARDS_REFRESH_MS = 60_000

async function fetchCards(requestId: string) {
  const res = await api.v1.voice.requests[":requestId"].entities.$get({
    param: { requestId },
  })
  if (!res.ok) throw new Error("Failed to load cards")
  return (await res.json()).cards
}

type Cards = Awaited<ReturnType<typeof fetchCards>>

function useEntityCards(request: VoiceRequestState) {
  const refs = (request.result?.blocks ?? [])
    .flatMap((block) =>
      block.type === "linear_issues"
        ? block.issues
        : block.type === "github_pull_requests"
          ? block.pullRequests
          : []
    )
    .join(",")
  return useQuery({
    queryKey: ["voice-entity-cards", request.id, refs],
    enabled: refs !== "",
    refetchInterval: CARDS_REFRESH_MS,
    queryFn: () => fetchCards(request.id),
  })
}

const NO_MENTIONS: never[] = []

function markdownTable(columns: string[], rows: string[][]) {
  const cell = (value: string) =>
    value.replaceAll("|", "\\|").replaceAll("\n", " ")
  const line = (cells: string[]) =>
    `| ${columns.map((_, index) => cell(cells[index] ?? "")).join(" | ")} |`
  return [
    line(columns),
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map(line),
  ].join("\n")
}

function Title({ title }: { title: string | null }) {
  if (!title) return null
  return (
    <Text className="mb-two text-[14px] font-semibold text-foreground">
      {title}
    </Text>
  )
}

function Row({
  url,
  children,
}: {
  url?: string | null
  children: React.ReactNode
}) {
  const className =
    "gap-one rounded-lor-sm bg-surface-secondary px-three py-two"
  return url ? (
    <Pressable
      accessibilityRole="link"
      className={className}
      onPress={() => openExternalUrl(url)}
    >
      {children}
    </Pressable>
  ) : (
    <View className={className}>{children}</View>
  )
}

const ISSUE_STATE_CLASS: Record<string, string> = {
  started: "text-warning",
  completed: "text-accent",
}

const PULL_STATE: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "text-success" },
  draft: { label: "Draft", className: "text-muted" },
  merged: { label: "Merged", className: "text-accent" },
  closed: { label: "Closed", className: "text-danger" },
}

const REVIEW_LABEL: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  waiting: "Review requested",
}

const CHECKS_LABEL: Record<string, string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  running: "Checks running",
}

function Unloaded({
  refLabel,
  cards,
  failed,
  connected,
}: {
  refLabel: string
  cards: Cards | undefined
  failed: boolean
  connected: boolean | undefined
}) {
  const reason = !cards
    ? failed
      ? "couldn't load"
      : "loading…"
    : connected === false
      ? "not connected"
      : "couldn't load"
  return (
    <Row>
      <Text className="text-[14px] text-muted">
        {refLabel}: {reason}
      </Text>
    </Row>
  )
}

function EntityRows({
  block,
  cards,
  failed,
}: {
  block: Extract<
    RealtimeVoiceBlock,
    { type: "linear_issues" | "github_pull_requests" }
  >
  cards: Cards | undefined
  failed: boolean
}) {
  const [muted] = useThemeColor(["muted"])
  if (block.type === "linear_issues") {
    return block.issues.map((identifier) => {
      const issue = cards?.linear.issues.find(
        (entry) => entry.identifier === identifier
      )
      if (!issue) {
        return (
          <Unloaded
            key={identifier}
            cards={cards}
            connected={cards?.linear.connected}
            failed={failed}
            refLabel={identifier}
          />
        )
      }
      const details = [issue.priority, issue.assignee ?? "Unassigned"]
      return (
        <Row key={identifier} url={issue.url}>
          <View className="flex-row items-center gap-two">
            <ConnectorIcon color={muted} connector="linear" size={14} />
            <Text className="text-[13px] text-muted">{issue.identifier}</Text>
            {issue.status && (
              <Text
                className={cn(
                  "ml-auto text-[12px] font-medium",
                  ISSUE_STATE_CLASS[issue.state ?? ""] ?? "text-muted"
                )}
              >
                {issue.status}
              </Text>
            )}
          </View>
          <Text className="text-[15px] font-medium text-foreground">
            {issue.title}
          </Text>
          <Text className="text-[12px] text-muted">
            {details.filter(Boolean).join(" · ")}
          </Text>
        </Row>
      )
    })
  }
  return block.pullRequests.map((ref) => {
    const pull = cards?.github.pullRequests.find(
      (entry) => entry.ref.toLowerCase() === ref.toLowerCase()
    )
    if (!pull) {
      return (
        <Unloaded
          key={ref}
          cards={cards}
          connected={cards?.github.connected}
          failed={failed}
          refLabel={ref}
        />
      )
    }
    const state = PULL_STATE[pull.state]
    const details = [
      pull.author,
      pull.review && REVIEW_LABEL[pull.review],
      pull.checks && CHECKS_LABEL[pull.checks],
      `+${pull.additions} −${pull.deletions}`,
    ]
    return (
      <Row key={ref} url={pull.url}>
        <View className="flex-row items-center gap-two">
          <ConnectorIcon color={muted} connector="github" size={14} />
          <Text className="text-[13px] text-muted">{pull.ref}</Text>
          {state && (
            <Text
              className={cn("ml-auto text-[12px] font-medium", state.className)}
            >
              {state.label}
            </Text>
          )}
        </View>
        <Text className="text-[15px] font-medium text-foreground">
          {pull.title}
        </Text>
        <Text className="text-[12px] text-muted">
          {details.filter(Boolean).join(" · ")}
        </Text>
      </Row>
    )
  })
}

function Block({
  block,
  cards,
  failed,
}: {
  block: RealtimeVoiceBlock
  cards: Cards | undefined
  failed: boolean
}) {
  switch (block.type) {
    case "answer":
      return <MessageContent content={block.markdown} mentions={NO_MENTIONS} />
    case "table":
      return (
        <View>
          <Title title={block.title} />
          <MessageContent
            content={markdownTable(block.columns, block.rows)}
            mentions={NO_MENTIONS}
          />
        </View>
      )
    case "question":
      // Answered out loud on the phone ("Lor, the second one").
      return (
        <View className="gap-two">
          <Text className="text-[15px] font-semibold text-foreground">
            {block.prompt}
          </Text>
          {block.choices.map((choice, index) => (
            <Row key={`${index}-${choice}`}>
              <Text className="text-[15px] text-foreground">
                <Text className="text-muted">{index + 1} </Text>
                {choice}
              </Text>
            </Row>
          ))}
        </View>
      )
    case "list":
      return (
        <View>
          <Title title={block.title} />
          <View className="gap-two">
            {block.items.map((item, index) => (
              <Row key={`${index}-${item.title}`} url={item.url}>
                <Text className="text-[15px] font-medium text-foreground">
                  {item.title}
                </Text>
                {item.detail && (
                  <Text className="text-[13px] text-muted">{item.detail}</Text>
                )}
              </Row>
            ))}
          </View>
        </View>
      )
    case "details":
      return (
        <View>
          <Title title={block.title} />
          <View className="gap-one">
            {block.fields.map((field, index) => (
              <View
                key={`${index}-${field.label}`}
                className="flex-row gap-three"
              >
                <Text className="w-[35%] text-[14px] text-muted">
                  {field.label}
                </Text>
                <Text className="flex-1 text-[14px] text-foreground">
                  {field.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )
    case "linear_issues":
    case "github_pull_requests":
      return (
        <View>
          <Title title={block.title} />
          <View className="gap-two">
            <EntityRows block={block} cards={cards} failed={failed} />
          </View>
        </View>
      )
  }
}

export function LorBlocks({ request }: { request: VoiceRequestState }) {
  const cards = useEntityCards(request)
  return (
    <View className="gap-four">
      {(request.result?.blocks ?? []).map((block, index) => (
        <Block
          key={`${index}-${block.type}`}
          block={block}
          cards={cards.data}
          failed={cards.isError}
        />
      ))}
    </View>
  )
}
