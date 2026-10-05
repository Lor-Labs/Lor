import type {
  RealtimeVoiceBlock,
  VoiceRequestState,
} from "@repo/realtime-types/events"
import { useQuery } from "@tanstack/react-query"
import { Pressable, Text, View } from "react-native"
import { MessageContent } from "@/components/message-content"
import { EntityCardList } from "@/components/voice/lor-entity-cards"
import {
  entityCardsQueryKey,
  entityRefs,
  isSimulatedRequest,
} from "@/hooks/use-voice-requests"
import { api } from "@/lib/api"
import { openExternalUrl } from "@/lib/open-url"

// What Lor composed for its window, read-only on the phone: the same blocks
// as web.

// Cards stay live while shown, like web.
const CARDS_REFRESH_MS = 60_000

async function fetchCards(requestId: string) {
  const res = await api.v1.voice.requests[":requestId"].entities.$get({
    param: { requestId },
  })
  if (!res.ok) throw new Error("Failed to load cards")
  return (await res.json()).cards
}

export type EntityCards = Awaited<ReturnType<typeof fetchCards>>
type Cards = EntityCards

function useEntityCards(request: VoiceRequestState) {
  const refs = entityRefs(request)
  return useQuery({
    queryKey: entityCardsQueryKey(request.id, refs),
    // The simulator seeds its cards into the cache instead.
    enabled: refs !== "" && !isSimulatedRequest(request),
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
      return (
        <View>
          <Title title={block.title} />
          <EntityCardList cards={cards} failed={failed} issues={block.issues} />
        </View>
      )
    case "github_pull_requests":
      return (
        <View>
          <Title title={block.title} />
          <EntityCardList
            cards={cards}
            failed={failed}
            pullRequests={block.pullRequests}
          />
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
