import Link from "next/link"
import { LorMark } from "@/app/components/lor-mark"

export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-50 px-5 sm:px-8">
      <a
        href="#main-content"
        className="sr-only rounded bg-foreground p-3 text-background focus:not-sr-only focus:absolute focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-20 max-w-[1240px] items-center justify-between gap-4">
        <Link
          href="/"
          aria-label="Lor home"
          className="flex min-h-11 items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
        >
          <LorMark className="w-8" />
          <span className="text-2xl font-semibold tracking-tight">Lor</span>
        </Link>
        <nav
          aria-label="Main navigation"
          className="flex items-center gap-4 sm:gap-6"
        >
          <Link
            href="/#vision"
            className="hidden min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent md:inline-flex"
          >
            What you can do
          </Link>
          <Link
            href="/#faq"
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
          >
            FAQ
          </Link>
          <Link
            href="/#early-access"
            className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent sm:px-5"
          >
            Join the waitlist
          </Link>
        </nav>
      </div>
    </header>
  )
}
