"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { LorMark } from "@/app/components/lor-mark"

const NAV_LINKS = [
  { href: "/#why", label: "Why Lor" },
  { href: "/#workspace", label: "The workspace" },
  { href: "/#vision", label: "What you can do" },
  { href: "/#faq", label: "FAQ" },
]

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) =>
      setScrolled(!entry?.isIntersecting)
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <div
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-8 h-px w-px"
      />
      <header
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            setMenuOpen(false)
            menuButtonRef.current?.focus()
          }
        }}
        className={`fixed inset-x-0 top-0 z-50 border-b px-5 transition-colors duration-200 sm:px-8 ${scrolled || menuOpen ? "border-foreground/10 bg-background/95 backdrop-blur-xl" : "border-transparent bg-background/70"}`}
      >
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
            onClick={() => setMenuOpen(false)}
            className="flex min-h-11 items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
          >
            <LorMark className="w-8" />
            <span className="text-2xl font-semibold tracking-tight">Lor</span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-8 lg:flex"
          >
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="py-3 text-sm text-foreground/60 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/#early-access"
              onClick={() => setMenuOpen(false)}
              className="inline-flex min-h-11 items-center rounded-full bg-foreground px-5 text-[13px] font-medium text-background transition-transform duration-200 hover:bg-foreground/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
            >
              Join the waitlist
            </Link>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMenuOpen(!menuOpen)}
              className="relative flex size-11 cursor-pointer items-center justify-center rounded-full border border-foreground/15 focus-visible:outline-2 focus-visible:outline-agent lg:hidden"
            >
              <span
                aria-hidden="true"
                className={`absolute h-px w-4 bg-foreground transition-transform duration-200 motion-reduce:transition-none ${menuOpen ? "rotate-45" : "-translate-y-1"}`}
              />
              <span
                aria-hidden="true"
                className={`absolute h-px w-4 bg-foreground transition-transform duration-200 motion-reduce:transition-none ${menuOpen ? "-rotate-45" : "translate-y-1"}`}
              />
            </button>
          </div>
        </div>
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          hidden={!menuOpen}
          className="border-t border-foreground/10 py-3 lg:hidden"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="block rounded-lg px-2 py-3 text-base text-foreground/75 hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-agent"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  )
}
