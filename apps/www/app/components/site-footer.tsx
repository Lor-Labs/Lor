import Link from "next/link"
import {
  BLOG_SECTION,
  COMPARE_ENTRIES,
  COMPARE_SECTION,
  GUIDE_ENTRIES,
} from "@/app/lib/seo/pages"

const linkClass =
  "inline-flex min-h-8 items-center transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"

const COLUMNS = [
  { section: COMPARE_SECTION, entries: COMPARE_ENTRIES },
  { section: BLOG_SECTION, entries: GUIDE_ENTRIES },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-foreground/10 px-5 sm:px-8">
      <div className="mx-auto max-w-[1240px]">
        <nav
          aria-label="Footer"
          className="grid gap-8 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4"
        >
          {COLUMNS.map(({ section, entries }) => (
            <div key={section.href}>
              <Link href={section.href} className={`font-medium ${linkClass}`}>
                {section.name}
              </Link>
              <ul className="mt-2 text-muted-foreground">
                {entries.map(({ href, page }) => (
                  <li key={href}>
                    <Link href={href} className={linkClass}>
                      {page.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="flex items-center justify-between gap-4 border-t border-foreground/10 py-6 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Lor</p>
          <Link
            href="/#early-access"
            className="inline-flex min-h-11 items-center transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
          >
            Join the waitlist ↑
          </Link>
        </div>
      </div>
    </footer>
  )
}
