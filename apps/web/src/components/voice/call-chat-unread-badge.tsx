export function CallChatUnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="pointer-events-none absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 font-semibold text-[11px] text-primary-foreground tabular-nums">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> unread messages</span>
    </span>
  )
}
