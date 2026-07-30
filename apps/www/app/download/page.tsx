import { ArrowUpRight, Download, Globe } from "lucide-react"
import type { Metadata } from "next"
import { Reveal } from "@/app/components/reveal"
import { SiteFooter } from "@/app/components/site-footer"
import { GITHUB_URL } from "@/app/lib/urls"

export const metadata: Metadata = {
  title: "Download Lor",
  description:
    "Download Lor for macOS. Windows, Linux, iOS, and Android are on the way.",
}

const RELEASES_URL = `${GITHUB_URL}/releases`
const MACOS_DMG_URL = "https://releases.lor.chat/latest/Lor_aarch64.dmg"
const APP_URL = "https://app.lor.chat"

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11" />
    </svg>
  )
}

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M3 12V6.75l6-1.32v6.48L3 12zm17-9v8.75l-10 .15V5.21L20 3zM3 13l6 .09v6.81l-6-1.15V13zm17 .25V22l-10-1.91V13.1l10 .15z" />
    </svg>
  )
}

function LinuxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.581 19.049c-.55-.446-.336-1.431-.907-1.917.553-3.365-.997-6.331-2.845-8.232-1.551-1.595-1.639-3.743-1.408-5.049.096-.553-.168-.918-.168-.918s-.199.04-.399.199c-.309.245-.62.678-.795 1.357-.273 1.065-.109 2.836.431 4.224.541 1.388.58 2.348.268 3.285-.312.937-.655 1.645-.862 2.724-.207 1.08-.135 1.983.018 2.716.153.733.478 1.53.478 1.53s-.293-.156-.621-.156c-.328 0-.738.156-.738.156s1.234 1.573 3.539 1.573c2.304 0 4.008-1.492 4.008-1.492zM8.584 19.5c.468 0 .553-.344.937-.344.384 0 .48.344.937.344.457 0 .936-.468.936-.468s-.288-.288-.576-.937c-.288-.648 0-1.404 0-1.404s-.732.12-1.297.12c-.564 0-1.296-.12-1.296-.12s.288.756 0 1.404c-.288.649-.577.937-.577.937s.468.468.936.468z" />
    </svg>
  )
}

function AndroidIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.523 15.341a.998.998 0 1 1 0-1.996.998.998 0 0 1 0 1.996m-11.046 0a.998.998 0 1 1 0-1.996.998.998 0 0 1 0 1.996m11.405-6.02 1.997-3.46a.416.416 0 0 0-.152-.567.416.416 0 0 0-.568.152l-2.022 3.503C15.598 8.24 13.853 7.842 12 7.842s-3.598.398-5.137 1.107L4.84 5.446a.416.416 0 0 0-.567-.152.416.416 0 0 0-.153.568l1.997 3.459C2.688 11.187.343 14.66 0 18.761h24c-.344-4.102-2.688-7.574-6.118-9.44" />
    </svg>
  )
}

type Platform = {
  name: string
  icon: (props: { className?: string }) => React.ReactNode
  subtitle: string
  description: string
  href?: string
  note?: string
}

const PLATFORMS: Platform[] = [
  {
    name: "macOS",
    icon: AppleIcon,
    subtitle: "Apple Silicon",
    description: "The .dmg installer for macOS 11 and up.",
    href: MACOS_DMG_URL,
    note: "Need Intel? Check all releases below.",
  },
  {
    name: "Windows",
    icon: WindowsIcon,
    subtitle: "Windows 10+",
    description: "A native Windows build is in the works.",
  },
  {
    name: "Linux",
    icon: LinuxIcon,
    subtitle: ".deb, .rpm, .AppImage",
    description: "A native Linux build is in the works.",
  },
]

const MOBILE_PLATFORMS = [
  {
    name: "iOS",
    icon: AppleIcon,
    subtitle: "iPhone and iPad",
    storeLabel: "Coming to the App Store",
  },
  {
    name: "Android",
    icon: AndroidIcon,
    subtitle: "Phones and tablets",
    storeLabel: "Coming to Google Play",
  },
]

export default function DownloadPage() {
  return (
    <div className="flex min-h-svh flex-col">
      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_75%_70%_at_50%_-10%,--theme(--color-merlin/.12),transparent)]"
          />
          <div className="relative mx-auto max-w-6xl px-6 pt-40 pb-16 md:pt-48">
            <Reveal>
              <h1 className="max-w-[16ch] text-balance font-semibold text-[clamp(2.5rem,5vw,3.75rem)] leading-[1.05] tracking-[-0.035em]">
                Lor, in a{" "}
                <span className="text-foreground/55">faster shell.</span>
              </h1>
              <p className="mt-5 max-w-[46ch] text-[16px] text-foreground/60 leading-relaxed">
                Native for macOS today. Windows, Linux, iOS, and Android are on
                the way.
              </p>
            </Reveal>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <Reveal>
            <div className="grid gap-2 md:grid-cols-3">
              {PLATFORMS.map((platform) => (
                <div
                  key={platform.name}
                  className="flex flex-col rounded-2xl border bg-card p-7 dark:bg-card/50"
                >
                  <platform.icon className="size-9 text-foreground" />
                  <h2 className="mt-6 font-medium text-base leading-tight md:text-lg">
                    <span>{platform.name}.</span>{" "}
                    <span className="text-muted-foreground">
                      {platform.description}
                    </span>
                  </h2>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    {platform.subtitle}
                  </p>
                  <div className="mt-8 flex flex-1 flex-col justify-end">
                    {platform.href ? (
                      <>
                        <a
                          href={platform.href}
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-merlin to-primary py-2.5 font-medium text-[14px] text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_10px_-2px_rgba(97,60,214,0.4)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 active:translate-y-0"
                        >
                          <Download className="size-4" strokeWidth={1.75} />
                          Download for {platform.name}
                        </a>
                        {platform.note ? (
                          <p className="mt-3 text-center text-[12px] text-muted-foreground">
                            {platform.note}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <span className="inline-flex items-center justify-center rounded-full border border-foreground/[0.1] py-2.5 font-medium text-[14px] text-muted-foreground">
                        Coming soon
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 text-center">
              <a
                href={RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                All releases on GitHub
                <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
              </a>
            </div>
          </Reveal>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <Reveal>
            <div className="grid gap-2 md:grid-cols-2">
              {MOBILE_PLATFORMS.map((platform) => (
                <div
                  key={platform.name}
                  className="flex items-center gap-5 rounded-2xl border bg-card p-7 dark:bg-card/50"
                >
                  <platform.icon className="size-8 shrink-0 text-foreground" />
                  <div>
                    <h2 className="font-medium text-base leading-tight">
                      <span>{platform.name} on your phone.</span>{" "}
                      <span className="text-muted-foreground">
                        {platform.subtitle}.
                      </span>
                    </h2>
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      {platform.storeLabel}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-28">
          <Reveal>
            <div className="flex flex-col items-start justify-between gap-6 rounded-2xl border bg-card p-8 md:flex-row md:items-center dark:bg-card/50">
              <div className="flex items-center gap-4">
                <Globe
                  className="size-6 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <h2 className="font-medium text-base leading-tight md:text-lg">
                  <span>Don&rsquo;t want to download?</span>{" "}
                  <span className="text-muted-foreground">
                    Lor runs in your browser, no install required.
                  </span>
                </h2>
              </div>
              <a
                href={APP_URL}
                className="inline-flex shrink-0 items-center gap-2 rounded-full border border-foreground/[0.12] bg-foreground/[0.03] py-2.5 px-5 font-medium text-[14px] text-foreground/85 transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
              >
                Open Lor in browser
                <ArrowUpRight className="size-3.5" strokeWidth={1.75} />
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
