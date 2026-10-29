export function MentionBadge({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <span className="inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-md bg-red-600 px-1 text-[11px] font-bold leading-none text-white tabular-nums ring-1 ring-inset ring-white/15 transition-[scale,opacity] duration-200 ease-out starting:scale-50 starting:opacity-0 motion-reduce:transition-none">
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">
        {count} unread {count === 1 ? "mention" : "mentions"}
      </span>
    </span>
  )
}
