"use client"

import {
  MotionNavigationMenu,
  MotionNavigationMenuItem,
  MotionNavigationMenuLink,
  MotionNavigationMenuList,
} from "@repo/ui/components/unlumen-ui/motion-navigation-menu"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { LorMark } from "@/app/components/lor-mark"

const EASE = "cubic-bezier(0.16,1,0.3,1)"
// Shared transition: 500ms on every animated property so the whole header
// "settles" together as the page scrolls.
const T = `transition-all duration-500 ease-[${EASE}]`

// Anchors match the section ids on the home page.
const NAV_LINKS = [
  { href: "/#why", label: "Why Lor" },
  { href: "/#week", label: "How it works" },
]

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Sentinel lives just below the top edge. When it leaves the viewport,
  // the pill condenses + materializes — no scroll listeners.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setScrolled(!entry?.isIntersecting),
      { threshold: 0, rootMargin: "0px" }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <>
      <div
        ref={sentinelRef}
        aria-hidden
        className="pointer-events-none absolute top-8 h-px w-px"
      />

      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
        <header
          data-scrolled={scrolled}
          className={[
            "pointer-events-auto flex items-center rounded-full",
            T,
            scrolled
              ? "gap-x-2 border border-foreground/[0.07] bg-background/55 py-1.5 pl-3 pr-1.5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl backdrop-saturate-150"
              : "gap-x-4 border border-transparent bg-transparent py-2.5 pl-5 pr-2.5 shadow-none",
          ].join(" ")}
        >
          {/* Left: brand */}
          <Link
            href="/"
            aria-label="Lor home"
            className={`group inline-flex items-center px-1 ${T} ${
              scrolled ? "gap-1.5" : "gap-2"
            }`}
          >
            <LorMark className={scrolled ? "size-5" : "size-6"} />
            <span
              className={`font-semibold text-foreground tracking-tight ${T} ${
                scrolled ? "text-[17px]" : "text-[20px]"
              }`}
            >
              Lor
            </span>
          </Link>

          {/* Divider — fades in only once condensed */}
          <span
            aria-hidden
            className={`mx-1 h-5 w-px bg-foreground/[0.08] max-md:hidden ${T} ${
              scrolled ? "opacity-100" : "opacity-0"
            }`}
          />

          {/* Center: nav. Hidden on phones, where it overflows the pill. */}
          <MotionNavigationMenu
            springStiffness={350}
            springDamping={32}
            gooey
            className="max-md:hidden"
          >
            <MotionNavigationMenuList
              highlightClassName="rounded-full bg-foreground/[0.07]"
              className={`${T} ${scrolled ? "gap-0" : "gap-1"}`}
            >
              {NAV_LINKS.map((link) => (
                <MotionNavigationMenuItem key={link.href}>
                  <MotionNavigationMenuLink
                    href={link.href}
                    className={`font-medium text-foreground/75 hover:text-foreground ${T} ${
                      scrolled
                        ? "px-3 py-1.5 text-[13px]"
                        : "px-4 py-2 text-[14px]"
                    }`}
                  >
                    {link.label}
                  </MotionNavigationMenuLink>
                </MotionNavigationMenuItem>
              ))}
            </MotionNavigationMenuList>
          </MotionNavigationMenu>

          {/* Divider */}
          <span
            aria-hidden
            className={`mx-1 h-5 w-px bg-foreground/[0.08] max-md:hidden ${T} ${
              scrolled ? "opacity-100" : "opacity-0"
            }`}
          />

          {/* Right: CTA */}
          <a
            href="/#early-access"
            className={`inline-flex items-center rounded-full bg-foreground font-medium text-background hover:bg-foreground/90 active:scale-[0.97] ${T} ${
              scrolled ? "px-3.5 py-1.5 text-[12.5px]" : "px-4 py-2 text-[14px]"
            }`}
          >
            Get early access
          </a>
        </header>
      </div>
    </>
  )
}
