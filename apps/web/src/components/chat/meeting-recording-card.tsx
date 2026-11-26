import { useNavigate, useParams } from "@tanstack/react-router"
import type { Message } from "@/lib/api-types"

type Embed = Message["embeds"][number]

// Attio call recordings and Granola meeting notes share one card.
export function isMeetingCard(embed: Embed): boolean {
  if (embed.siteName === "Granola") return Boolean(embed.meeting)
  return (
    embed.siteName === "Attio" &&
    (Boolean(embed.meeting) || embed.eventLabel === "Call recording ready")
  )
}

function meetingCopy(embed: Embed) {
  const granola = embed.siteName === "Granola"
  return {
    site: granola ? "Granola" : "Attio",
    color: granola ? "#b2c248" : "#d01e48",
    kind: granola ? "Meeting notes" : "Meeting recording",
    fallbackTitle: granola ? "Meeting" : "Call recording",
    ready: granola
      ? "The notes are ready. Explore the meeting with Lor."
      : "The recording is ready. Explore the discussion with Lor.",
    excerpt: granola
      ? "This is an excerpt of the meeting."
      : "This is an excerpt of the recording.",
  }
}

export function MeetingRecordingCard({
  embed,
  message,
}: {
  embed: Embed
  message: Message
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const navigate = useNavigate()
  const meeting = embed.meeting
  const copy = meetingCopy(embed)
  const transcript = meeting?.transcript ?? embed.description
  const summary = meeting?.summary
  const duration = meeting?.durationMinutes
    ? `${meeting.durationMinutes} min`
    : embed.fields?.find((field) => field.name === "Duration")?.value
  const canAsk = Boolean(workspaceSlug && !message.threadRootId)

  // Asks the channel's agent in the chat: a reply to this recording with
  // "@Lor <question>" in the composer.
  function ask(prompt: string) {
    if (!workspaceSlug) return
    void navigate({
      to: "/$workspaceSlug/$channelId",
      params: { workspaceSlug, channelId: message.channelId },
      search: { about: message.id, draft: prompt },
    })
  }

  return (
    <article className="my-2 max-w-2xl overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground">
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: copy.color }}
            aria-hidden="true"
          />
          <span>{copy.kind}</span>
          {duration && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{duration}</span>
            </>
          )}
          {embed.url && /^https?:\/\//i.test(embed.url) && (
            <a
              href={embed.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Open in {copy.site} <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">
            {embed.title ?? copy.fallbackTitle}
          </h3>
          {!!meeting?.participants?.length && (
            <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {meeting.participants.join(" · ")}
            </p>
          )}
        </div>
        {summary ? (
          <p className="text-sm leading-relaxed text-foreground/80 [overflow-wrap:anywhere]">
            {summary}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{copy.ready}</p>
        )}
        {transcript && (
          <details>
            <summary className="w-fit cursor-pointer rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              {meeting && !meeting.transcriptTruncated
                ? "View transcript"
                : "View transcript excerpt"}
            </summary>
            <div className="mt-3 max-h-64 overflow-y-auto overscroll-contain rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {transcript}
              </p>
              {(!meeting || meeting.transcriptTruncated) && (
                <p className="mt-3 font-medium">{copy.excerpt}</p>
              )}
            </div>
          </details>
        )}
      </div>
      {canAsk && (
        <div className="space-y-2.5 border-t border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            Explore with Lor
          </p>
          <div className="flex flex-wrap gap-2">
            {meeting?.followUps?.map((followUp) => (
              <button
                key={followUp.prompt}
                type="button"
                title={followUp.prompt}
                onClick={() => ask(followUp.prompt)}
                className="max-w-full cursor-pointer rounded-lg border border-border/80 bg-background px-2.5 py-1.5 text-left text-xs leading-relaxed text-foreground/85 transition-colors hover:border-foreground/25 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring active:bg-accent [overflow-wrap:anywhere]"
              >
                {followUp.label}{" "}
                <span aria-hidden="true" className="text-muted-foreground">
                  ↗
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => ask("")}
              className="cursor-pointer rounded-lg border border-dashed border-border bg-transparent px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:bg-accent"
            >
              Ask a follow-up <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
