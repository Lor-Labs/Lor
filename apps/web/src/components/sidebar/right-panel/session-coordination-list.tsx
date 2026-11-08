import { AlertCircleIcon, Megaphone01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { timeAgo } from "@repo/utils/date"
import { Link } from "@tanstack/react-router"
import type { SessionCoordinationEntry } from "@/hooks/use-agent-session"

// A code session's view of the shared coordination log: what its agent and
// other sessions' agents announced about the same files, and the overlap
// notes they got. Read-only by design: the log is append-only, so it's a
// record people can trust. reference/agent-coordination.md

const PATHS_SHOWN = 3

export function SessionCoordinationList({
  entries,
  workspaceSlug,
}: {
  entries: SessionCoordinationEntry[]
  workspaceSlug: string
}) {
  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-2 text-sm">
          <HugeiconsIcon
            icon={entry.kind === "intent" ? Megaphone01Icon : AlertCircleIcon}
            className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={2}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
              {entry.own ? (
                <span className="font-medium text-foreground">
                  This session
                </span>
              ) : (
                <Link
                  to="/$workspaceSlug/session/$sessionId"
                  params={{ workspaceSlug, sessionId: entry.session.id }}
                  className="min-w-0 truncate font-medium text-foreground hover:underline"
                >
                  {entry.session.ownerName
                    ? `${entry.session.ownerName} · ${entry.session.title}`
                    : entry.session.title}
                </Link>
              )}
              <span className="shrink-0">{timeAgo(entry.at)}</span>
            </div>
            <p className="mt-0.5 text-foreground/90">{entry.summary}</p>
            <PathList paths={entry.paths} />
            {entry.otherSession && entry.own && (
              <Link
                to="/$workspaceSlug/session/$sessionId"
                params={{ workspaceSlug, sessionId: entry.otherSession.id }}
                className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Open {entry.otherSession.title}
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function PathList({ paths }: { paths: string[] }) {
  const more = paths.length - PATHS_SHOWN
  return (
    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
      {paths.slice(0, PATHS_SHOWN).join(", ")}
      {more > 0 ? ` and ${more} more` : ""}
    </p>
  )
}
