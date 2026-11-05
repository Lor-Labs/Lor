import Link from "next/link"
import { Fragment, type ReactNode } from "react"

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g

const linkClass =
  "text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-agent"

export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const [whole, label, href] = match
    parts.push(
      <Fragment key={`t${last}`}>{text.slice(last, match.index)}</Fragment>
    )
    parts.push(
      href?.startsWith("/") ? (
        <Link key={match.index} href={href} className={linkClass}>
          {label}
        </Link>
      ) : (
        <a
          key={match.index}
          href={href}
          className={linkClass}
          rel="noopener"
          target="_blank"
        >
          {label}
        </a>
      )
    )
    last = match.index + whole.length
  }
  parts.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>)
  return parts
}

/** Strips `[label](href)` to `label` for meta tags and JSON-LD. */
export function plainText(text: string) {
  return text.replace(LINK, "$1")
}
