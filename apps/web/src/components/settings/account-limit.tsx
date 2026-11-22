export function AccountLimit({ until }: { until: string | null }) {
  if (!until || new Date(until).getTime() <= Date.now()) return null
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Usage limit reached · Retry after {new Date(until).toLocaleString()}
    </p>
  )
}
