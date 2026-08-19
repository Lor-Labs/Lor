import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { cn } from "@repo/ui/lib/utils"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import type { Message } from "@/lib/api-types"
import { connectorForName, connectorLogo } from "@/lib/connector-ui"

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
  const siteConnector = connectorForName(embed.siteName)
  const SiteMark = siteConnector ? connectorLogo(siteConnector) : null
  const showFooter =
    footerParts.length > 0 || Boolean(embed.siteName && !siteConnector)

  return (
    <div
      className={cn(
        "mt-1 max-w-lg overflow-hidden rounded border border-border/70 bg-[hsl(var(--card))]/60",
        "border-l-4",
        !embed.color && "border-l-primary/60",
        siteConnector &&
          "max-w-2xl rounded-none border-border/80 bg-muted/25 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.03)]",
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
              className="inline-flex w-fit items-center gap-2 text-xs font-semibold text-foreground/90 hover:underline"
            >
              {embed.author.iconUrl && (
                <img
                  src={embed.author.iconUrl}
                  alt={`${embed.author.name} avatar`}
                  className="size-5 rounded-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none"
                  }}
                />
              )}
              <span>{embed.author.name}</span>
            </a>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground/90">
              {embed.author.iconUrl && (
                <img
                  src={embed.author.iconUrl}
                  alt={`${embed.author.name} avatar`}
                  className="size-5 rounded-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = "none"
                  }}
                />
              )}
              {embed.author.name}
            </span>
          ))}
        {embed.eventLabel && !siteConnector && (
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
            {embed.eventLabel}
          </span>
        )}
        {siteConnector && embed.eventLabel && embed.title ? (
          <div className="line-clamp-2 text-sm leading-snug">
            <span className="font-semibold text-foreground">
              {embed.eventLabel}
            </span>
            <span className="px-1.5 text-muted-foreground/60" aria-hidden>
              ·
            </span>
            {embed.url ? (
              <a
                href={embed.url}
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-foreground/80 decoration-foreground/30 underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                {embed.title}
              </a>
            ) : (
              <span className="font-medium text-foreground/80">
                {embed.title}
              </span>
            )}
          </div>
        ) : (
          embed.title &&
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
          ))
        )}
        {embed.description && (
          <MessageMarkdown
            content={embed.description}
            mentions={[]}
            className={cn(
              "text-[13px] text-muted-foreground",
              siteConnector && "text-foreground/80"
            )}
          />
        )}
        {embed.fields && embed.fields.length > 0 && (
          <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-3">
            {embed.fields.map((field, index) => (
              <div
                key={`${field.name}-${index}`}
                className={cn("min-w-0", !field.inline && "col-span-full")}
              >
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
      {embed.thumbnail && !embed.image && (
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
      {showFooter && (
        <div className="flex items-center gap-1.5 border-t border-border/50 px-3 py-2">
          {SiteMark && (
            <SiteMark className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {[embed.siteName, ...footerParts].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
    </div>
  )
}
