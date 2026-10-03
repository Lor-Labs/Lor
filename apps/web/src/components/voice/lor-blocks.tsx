import type { RealtimeVoiceBlock } from "@repo/realtime-types/events"
import { MessageMarkdown } from "@/components/chat/message-markdown"

const NO_MENTIONS: never[] = []

function markdownCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

function markdownTable(columns: string[], rows: string[][]) {
  const line = (cells: string[]) =>
    `| ${columns.map((_, index) => markdownCell(cells[index] ?? "")).join(" | ")} |`
  return [
    line(columns),
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map(line),
  ].join("\n")
}

function BlockTitle({ title }: { title: string | null }) {
  if (!title) return null
  return <h3 className="mb-2 text-sm font-medium">{title}</h3>
}

type OnChoose = (index: number) => void

function Block({
  block,
  onChoose,
}: {
  block: RealtimeVoiceBlock
  onChoose?: OnChoose
}) {
  switch (block.type) {
    case "answer":
      return <MessageMarkdown content={block.markdown} mentions={NO_MENTIONS} />
    case "question":
      // Numbered, so people can also answer "Lor, the second one".
      return (
        <div>
          <p className="font-medium">{block.prompt}</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {block.choices.map((choice, index) => (
              <li key={`${index}-${choice}`}>
                <button
                  type="button"
                  disabled={!onChoose}
                  onClick={() => onChoose?.(index)}
                  className="flex w-full cursor-pointer gap-2.5 rounded-lg bg-muted px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-muted"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  {choice}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )
    case "list":
      return (
        <div>
          <BlockTitle title={block.title} />
          <ul className="flex flex-col divide-y divide-border/60">
            {block.items.map((item, index) => (
              <li key={`${index}-${item.title}`} className="py-2">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium hover:underline"
                  >
                    {item.title}
                  </a>
                ) : (
                  <span className="text-sm font-medium">{item.title}</span>
                )}
                {item.detail && (
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )
    case "table":
      // Rendered as markdown so it matches the tables in Lor's chat answers.
      return (
        <div>
          <BlockTitle title={block.title} />
          <MessageMarkdown
            content={markdownTable(block.columns, block.rows)}
            mentions={NO_MENTIONS}
          />
        </div>
      )
    case "details":
      return (
        <div>
          <BlockTitle title={block.title} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {block.fields.map((field, index) => (
              <div key={`${index}-${field.label}`} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )
  }
}

// What Lor composed for its window, top to bottom. Question choices are
// clickable when `onChoose` is set.
export function LorBlocks({
  blocks,
  onChoose,
}: {
  blocks: RealtimeVoiceBlock[]
  onChoose?: OnChoose
}) {
  return (
    <div className="flex flex-col gap-5">
      {blocks.map((block, index) => (
        <Block
          key={`${index}-${block.type}`}
          block={block}
          onChoose={onChoose}
        />
      ))}
    </div>
  )
}
