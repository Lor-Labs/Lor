import Link from "next/link"

export function SiteFooter() {
  return (
    <footer className="border-t border-foreground/10 px-5 sm:px-8">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 py-6 text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} Lor</p>
        <Link
          href="/#early-access"
          className="inline-flex min-h-11 items-center transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
        >
          Join the waitlist ↑
        </Link>
      </div>
    </footer>
  )
}
