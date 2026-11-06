import { ClosingCTA } from "@/app/components/closing-cta"
import { PageCards } from "@/app/components/seo-article"
import { SiteFooter } from "@/app/components/site-footer"
import type { SeoPage } from "@/app/lib/seo/types"

export function SeoIndex({
  title,
  intro,
  entries,
}: {
  title: string
  intro: string
  entries: { href: string; page: SeoPage }[]
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <main id="main-content" className="flex-1">
        <section className="px-5 pt-32 pb-16 sm:px-8 md:pt-40 md:pb-24">
          <div className="mx-auto max-w-[1240px]">
            <h1 className="font-medium text-[clamp(2.5rem,5vw,4.25rem)] leading-[1.04] tracking-[-0.05em]">
              {title}
            </h1>
            <p className="mt-6 max-w-[52ch] text-pretty text-lg leading-relaxed text-foreground/70">
              {intro}
            </p>
            <PageCards pages={entries} />
          </div>
        </section>
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  )
}
