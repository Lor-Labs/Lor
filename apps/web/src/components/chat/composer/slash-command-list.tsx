import {
  BookOpen01Icon,
  CommandLineIcon,
  SourceCodeSquareIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { forwardRef } from "react"
import {
  type SuggestionListRef,
  useSuggestionList,
} from "@/components/chat/composer/use-suggestion-list"
import { connectorLogo } from "@/lib/connector-ui"

const LinearLogo = connectorLogo("linear")

export interface SlashCommandItem {
  id: string
  label: string
  description: string
  language?: string
  search?: string
  // A session harness's own command or skill: inserted as this text.
  insert?: string
}

export interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

function CommandIcon({ id }: { id: SlashCommandItem["id"] }) {
  if (id === "linear-issue") return <LinearLogo className="size-4" />
  if (id.startsWith("harness:") || id.startsWith("skill:")) {
    return (
      <HugeiconsIcon
        icon={id.startsWith("skill:") ? BookOpen01Icon : CommandLineIcon}
        className="size-4"
        strokeWidth={2}
      />
    )
  }
  if (id.startsWith("code-block")) {
    return (
      <HugeiconsIcon
        icon={SourceCodeSquareIcon}
        className="size-4"
        strokeWidth={2}
      />
    )
  }

  return null
}

export const SlashCommandList = forwardRef<
  SuggestionListRef,
  SlashCommandListProps
>(function SlashCommandList({ items, command }, ref) {
  const { selectedIndex, getRowProps } = useSuggestionList(items, command, ref)

  if (items.length === 0) return null

  return (
    <div className="max-h-60 overflow-y-auto p-1">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          {...getRowProps(index)}
          className={cn(
            "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left",
            index === selectedIndex && "bg-accent text-accent-foreground"
          )}
          // Select on click, not mousedown: a command that opens a popover
          // (Linear Issue) would be closed again by this same click.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => command(item)}
        >
          <span className="mt-0.5 text-muted-foreground">
            <CommandIcon id={item.id} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{item.label}</span>
            <span className="block text-xs text-muted-foreground">
              {item.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
})
