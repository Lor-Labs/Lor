import { GITHUB_URL } from "@/app/lib/urls"

type LinkGroup = {
  title: string
  links: { label: string; href: string; external?: boolean }[]
}

const GROUPS: LinkGroup[] = [
  {
    title: "Product",
    links: [
      { label: "Lor", href: "/#lor" },
      { label: "Connectors", href: "/#integrations" },
      { label: "Memory", href: "/#memory" },
      { label: "Pricing", href: "/#pricing" },
      { label: "Download", href: "/download" },
      { label: "Self-host", href: "/#open-source" },
    ],
  },
  {
    title: "Open Source",
    links: [
      { label: "GitHub", href: GITHUB_URL, external: true },
      {
        label: "License (AGPL-3.0)",
        href: `${GITHUB_URL}/blob/main/LICENSE`,
        external: true,
      },
      {
        label: "Contribute",
        href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md`,
        external: true,
      },
      {
        label: "Roadmap",
        href: `${GITHUB_URL}/issues`,
        external: true,
      },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Docs", href: `${GITHUB_URL}#readme`, external: true },
      {
        label: "Changelog",
        href: `${GITHUB_URL}/releases`,
        external: true,
      },
    ],
  },
]

type Social = {
  label: string
  href: string
  icon: React.ReactNode
}

const SOCIALS: Social[] = [
  {
    label: "GitHub",
    href: GITHUB_URL,
    icon: <GitHubIcon />,
  },
]

export function SiteFooter() {
  return (
    <footer className="w-full border-t border-foreground/[0.06] bg-background">
      <div className="mx-auto max-w-6xl px-6">
        {/* Top: link groups + socials */}
        <div className="flex flex-col justify-between gap-12 py-10 lg:flex-row lg:gap-8 lg:py-14">
          <div className="grid flex-1 grid-cols-2 gap-8 md:grid-cols-3 lg:gap-12">
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

          <div className="flex shrink-0 flex-col gap-10">
            <div className="flex gap-3">
              {SOCIALS.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={social.label}
                  className="inline-flex size-9 items-center justify-center rounded-md border border-foreground/[0.12] bg-background text-foreground/85 transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>
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

      {/* Full-width divider + bottom row */}
      <div className="border-t border-foreground/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 py-5 text-xs text-muted-foreground md:flex-row">
          <p>© {new Date().getFullYear()} Lor. Built in the open.</p>
          <span className="inline-flex items-center gap-2 px-2 py-1 text-xs">
            <span className="relative flex size-2 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            <span>All Systems Normal</span>
          </span>
        </div>
      </div>
    </footer>
  )
}

// ---------------------------------------------------------------------------
// Brand icons (fill="currentColor", 16×16)
// ---------------------------------------------------------------------------

function GitHubIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className="size-4"
      aria-hidden
    >
      <title>GitHub</title>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}
