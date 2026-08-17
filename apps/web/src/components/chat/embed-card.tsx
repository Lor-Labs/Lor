import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import type { Message } from "@/lib/api-types"

type Embed = Message["embeds"][number]

interface EmbedCardProps {
  embed: Embed
  className?: string
}

function formatTimestamp(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// Link previews and webhook cards (Discord embeds / Slack attachments) share
// this card. Sender-chosen accent colors are respected; description and field
// values render as markdown (both dialects allow it there).
export function EmbedCard({ embed, className }: EmbedCardProps) {
  const hasMeta = Boolean(embed.title || embed.description)
  const timestamp = embed.timestamp ? formatTimestamp(embed.timestamp) : null
  const footerParts = [embed.footer, timestamp].filter(Boolean)

  return (
    <div
      className={cn(
        "mt-1 max-w-lg overflow-hidden rounded border border-border/70 bg-[hsl(var(--card))]/60",
        "border-l-4",
        !embed.color && "border-l-primary/60",
        className
      )}
      style={embed.color ? { borderLeftColor: embed.color } : undefined}
    >
      <div className="flex min-w-0 flex-col gap-1.5 p-3">
        {embed.author?.name &&
          (embed.author.url ? (
            <a
              href={embed.author.url}
              target="_blank"
              rel="noreferrer noopener"
              className="w-fit text-xs font-semibold text-foreground/90 hover:underline"
            >
              {embed.author.name}
            </a>
          ) : (
            <span className="text-xs font-semibold text-foreground/90">
              {embed.author.name}
            </span>
          ))}
        {embed.title &&
          (embed.url ? (
            <a
              href={embed.url}
              target="_blank"
              rel="noreferrer noopener"
              className="line-clamp-2 text-sm font-semibold text-primary hover:underline"
            >
              {embed.title}
            </a>
          ) : (
            <span className="line-clamp-2 text-sm font-semibold">
              {embed.title}
            </span>
          ))}
        {embed.description && (
          <MessageMarkdown
            content={embed.description}
            mentions={[]}
            className="text-[13px] text-muted-foreground"
          />
        )}
        {embed.fields && embed.fields.length > 0 && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {embed.fields.map((field, index) => (
              <div key={`${field.name}-${index}`} className="min-w-0">
                {field.name && (
                  <div className="text-xs font-semibold text-foreground/90">
                    {field.name}
                  </div>
                )}
                {field.value && (
                  <MessageMarkdown
                    content={field.value}
                    mentions={[]}
                    className="text-[13px] text-muted-foreground"
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {!(hasMeta || embed.author || embed.fields?.length) && embed.url && (
          <a
            href={embed.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <HugeiconsIcon
              icon={LinkSquare02Icon}
              className="size-3.5"
              strokeWidth={2}
            />
            {embed.url}
          </a>
        )}
      </div>
      {embed.image && (
        <div className="px-3 pb-3">
          <img
            src={embed.image}
            alt={embed.title ?? "Embed image"}
            className="max-h-80 w-full rounded object-cover"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
          />
        </div>
      )}
      {embed.thumbnail &&
        !embed.image &&
        (embed.title || embed.description || embed.siteName) && (
          <div className="px-3 pb-3">
            <img
              src={embed.thumbnail}
              alt={embed.title ?? "Link preview"}
              className="w-full rounded object-cover"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          </div>
        )}
      {(embed.siteName || footerParts.length > 0) && (
        <div className="flex items-center gap-1.5 border-t border-border/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {embed.siteName ?? footerParts.join(" · ")}
          </span>
        </div>
      )}
    </div>
  )
}
