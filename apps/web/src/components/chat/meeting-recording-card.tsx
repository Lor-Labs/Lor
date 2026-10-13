import { useNavigate, useParams } from "@tanstack/react-router"
import type { Message } from "@/lib/api-types"

type Embed = Message["embeds"][number]

export function isAttioRecording(embed: Embed): boolean {
  return (
    embed.siteName === "Attio" &&
    (Boolean(embed.meeting) || embed.eventLabel === "Call recording ready")
  )
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
  const transcript = meeting?.transcript ?? embed.description
  const summary = meeting?.summary
  const duration = meeting
    ? `${meeting.durationMinutes} min`
    : embed.fields?.find((field) => field.name === "Duration")?.value
  const canAsk = Boolean(workspaceSlug && !message.threadRootId)

  // Opens a new session about this recording with the question prefilled.
  function ask(prompt: string) {
    if (!workspaceSlug) return
    void navigate({
      to: "/$workspaceSlug/session/new",
      params: { workspaceSlug },
      search: {
        channelId: message.channelId,
        about: message.id,
        draft: prompt,
      },
    })
  }

  return (
    <article className="my-2 max-w-2xl overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground">
          <span
            className="size-1.5 rounded-full bg-[#d01e48]"
            aria-hidden="true"
          />
          <span>Meeting recording</span>
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
              Open in Attio <span aria-hidden="true">↗</span>
            </a>
          )}
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground [overflow-wrap:anywhere]">
            {embed.title ?? "Call recording"}
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
          <p className="text-sm text-muted-foreground">
            The recording is ready. Explore the discussion with Lor.
          </p>
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
                <p className="mt-3 font-medium">
                  This is an excerpt of the recording.
                </p>
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
