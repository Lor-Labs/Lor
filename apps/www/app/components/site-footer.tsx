type LinkGroup = {
  title: string
  links: { label: string; href: string; external?: boolean }[]
}

const GROUPS: LinkGroup[] = [
  {
    title: "Lor",
    links: [
      { label: "Why Lor", href: "/#why" },
      { label: "The workspace", href: "/#workspace" },
      { label: "What you can do", href: "/#vision" },
      { label: "Early access", href: "/#early-access" },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="w-full border-t border-foreground/[0.06] bg-background">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-8 py-10 md:grid-cols-3 lg:gap-12 lg:py-14">
          {GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-4">
              <h4 className="text-xs uppercase tracking-wider text-foreground">
                {group.title}
              </h4>
              <ul className="flex flex-col gap-2">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                      {...(link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Giant stroked wordmark — bleeds into the bottom row */}
        <div className="-mt-4 mask-b-from-20 overflow-hidden md:-mt-28 md:mask-b-from-50">
          <span
            aria-hidden
            className="pointer-events-none inline-block w-full translate-y-1/3 select-none text-center font-extrabold text-[28vw] text-foreground leading-none tracking-tighter opacity-20"
            style={{
              WebkitTextStroke: "1px currentColor",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Lor
          </span>
        </div>
      </div>

      <div className="border-t border-foreground/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-5 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Lor</p>
        </div>
      </div>
    </footer>
  )
}
