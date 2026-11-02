import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { type ReactNode, useLayoutEffect, useRef, useState } from "react"
import { connectorLogo } from "@/lib/connector-ui"
import type { LinearIssueBlock } from "@/lib/linear-issue-block"

const LinearLogo = connectorLogo("linear")

// A pasted Linear issue (Copy as prompt), in the composer and in messages:
// its id, team and project, title, and the description folded to two lines.
export function LinearIssueCard({
  issue,
  description,
  onRemove,
}: {
  issue: LinearIssueBlock
  // Rendered by the caller as message markdown.
  description: ReactNode
  onRemove?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body || expanded) return
    const measure = () =>
      setOverflows(body.scrollHeight > body.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [expanded])
  const meta = [issue.team, issue.project].filter(Boolean).join(" · ")

  return (
    <div className="group/issue relative flex max-w-xl flex-col gap-1 rounded-xl border border-border/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LinearLogo className="size-3.5 shrink-0" />
        <span className="font-medium">{issue.identifier}</span>
        {meta && <span className="ms-auto truncate ps-2">{meta}</span>}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Remove issue"
            onClick={onRemove}
            className={cn(
              "-me-1.5 opacity-0 transition-opacity group-hover/issue:opacity-100 focus-visible:opacity-100",
              !meta && "ms-auto"
            )}
          >
            <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
          </Button>
        )}
      </div>
      {issue.title && (
        <div className="text-sm leading-snug font-medium text-foreground">
          {issue.title}
        </div>
      )}
      {issue.description && (
        <div
          ref={bodyRef}
          className={cn(
            "[&_.message-markdown]:text-muted-foreground",
            !expanded && "max-h-12 overflow-hidden",
            !expanded &&
              overflows &&
              "[mask-image:linear-gradient(to_bottom,black_40%,transparent)]"
          )}
        >
          {description}
        </div>
      )}
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="cursor-pointer self-start text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  )
}
