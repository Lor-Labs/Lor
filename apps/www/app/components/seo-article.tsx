import Link from "next/link"
import { ClosingCTA } from "@/app/components/closing-cta"
import { plainText, RichText } from "@/app/components/rich-text"
import { SiteFooter } from "@/app/components/site-footer"
import { findPage, SITE_URL } from "@/app/lib/seo/pages"
import type { Block, SeoPage } from "@/app/lib/seo/types"

const focusRing =
  "focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"

export function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(iso))
}

function BlockView({ block }: { block: Block }) {
  if (block.type === "p") {
    return (
      <p className="text-pretty text-[17px] leading-relaxed text-foreground/75">
        <RichText text={block.text} />
      </p>
    )
  }
  if (block.type === "list") {
    return (
      <ul className="space-y-3 text-[17px] leading-relaxed text-foreground/75">
        {block.items.map((item) => (
          <li key={item} className="relative pl-5">
            <span
              aria-hidden="true"
              className="absolute top-[0.7em] left-0 size-1.5 rounded-full bg-foreground/30"
            />
            <RichText text={item} />
          </li>
        ))}
      </ul>
    )
  }
  const [corner, ...products] = block.columns
  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] border-collapse text-left text-[15px] leading-relaxed">
        <thead>
          <tr className="border-b border-foreground/15">
            <th scope="col" className="w-[28%] py-3 pr-4 font-medium">
              {corner}
            </th>
            {products.map((column) => (
              <th key={column} scope="col" className="py-3 pr-4 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map(([label, ...cells]) => (
            <tr key={label} className="border-b border-foreground/10 align-top">
              <th
                scope="row"
                className="py-3 pr-4 font-normal text-muted-foreground"
              >
                {label}
              </th>
              {cells.map((cell, index) => (
                <td
                  key={`${label}-${products[index]}`}
                  className="py-3 pr-4 text-foreground/80"
                >
                  <RichText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function jsonLd(page: SeoPage, section: { name: string; href: string }) {
  const url = `${SITE_URL}${section.href}/${page.slug}`
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: page.title,
        description: page.description,
        datePublished: page.published,
        dateModified: page.checkedOn,
        mainEntityOfPage: url,
        author: { "@type": "Organization", name: "Lor", url: SITE_URL },
        publisher: {
          "@type": "Organization",
          name: "Lor",
          url: SITE_URL,
          logo: `${SITE_URL}/lor-icon.png`,
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: page.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: plainText(faq.answer) },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { name: "Lor", item: SITE_URL },
          { name: section.name, item: `${SITE_URL}${section.href}` },
          { name: page.label, item: url },
        ].map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          ...crumb,
        })),
      },
    ],
  }
}

export function SeoArticle({
  page,
  section,
}: {
  page: SeoPage
  section: { name: string; href: string }
}) {
  const related = page.related.flatMap((href) => findPage(href) ?? [])
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD built from static page data, with < escaped
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd(page, section)).replace(
            /</g,
            "\\u003c"
          ),
        }}
      />
      <main id="main-content" className="flex-1">
        <article className="px-5 pt-32 pb-16 sm:px-8 md:pt-40 md:pb-24">
          <header className="mx-auto max-w-[1240px]">
            <nav
              aria-label="Breadcrumb"
              className="text-sm text-muted-foreground"
            >
              <ol className="flex flex-wrap items-center gap-2">
                <li>
                  <Link
                    href={section.href}
                    className={`transition-colors hover:text-foreground ${focusRing}`}
                  >
                    {section.name}
                  </Link>
                </li>
                <li aria-hidden="true">/</li>
                <li aria-current="page" className="text-foreground/70">
                  {page.label}
                </li>
              </ol>
            </nav>
            <h1 className="mt-6 max-w-[22ch] text-balance font-medium text-[clamp(2.5rem,5vw,4.25rem)] leading-[1.04] tracking-[-0.05em]">
              {page.title}
            </h1>
            <div className="mt-8 max-w-[62ch] space-y-5">
              {page.intro.map((paragraph) => (
                <p
                  key={paragraph}
                  className="text-pretty text-lg leading-relaxed text-foreground/70"
                >
                  <RichText text={paragraph} />
                </p>
              ))}
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Last updated{" "}
              <time dateTime={page.checkedOn}>
                {formatDate(page.checkedOn)}
              </time>
              .
            </p>
          </header>

          <div className="mx-auto mt-14 grid max-w-[1240px] grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-20">
            <nav aria-label="On this page" className="hidden lg:block">
              <div className="sticky top-10">
                <p className="text-sm font-medium">On this page</p>
                <ol className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                  {[
                    { id: "short-version", heading: "The short version" },
                    ...page.sections,
                    { id: "faq", heading: "FAQ" },
                    { id: "sources", heading: "Sources" },
                  ].map(({ id, heading }) => (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        className={`transition-colors hover:text-foreground ${focusRing}`}
                      >
                        {heading}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </nav>

            <div className="max-w-[760px] space-y-16">
              <section
                id="short-version"
                aria-labelledby="short-version-heading"
                className="scroll-mt-8 rounded-2xl border border-foreground/10 bg-foreground/[0.03] p-6 md:p-8"
              >
                <h2
                  id="short-version-heading"
                  className="text-xl font-medium tracking-[-0.02em]"
                >
                  The short version
                </h2>
                <div className="mt-5">
                  <BlockView block={{ type: "list", items: page.summary }} />
                </div>
              </section>

              {page.sections.map((item) => (
                <section
                  key={item.id}
                  id={item.id}
                  aria-labelledby={`${item.id}-heading`}
                  className="scroll-mt-8"
                >
                  <h2
                    id={`${item.id}-heading`}
                    className="text-balance text-2xl font-medium tracking-[-0.03em] md:text-3xl"
                  >
                    {item.heading}
                  </h2>
                  <div className="mt-6 space-y-5">
                    {item.blocks.map((block, index) => (
                      <BlockView key={index} block={block} />
                    ))}
                  </div>
                </section>
              ))}

              <section
                id="faq"
                aria-labelledby="faq-heading"
                className="scroll-mt-8"
              >
                <h2
                  id="faq-heading"
                  className="text-2xl font-medium tracking-[-0.03em] md:text-3xl"
                >
                  FAQ
                </h2>
                <div className="mt-6 divide-y divide-foreground/10 border-y border-foreground/10">
                  {page.faqs.map(({ question, answer }) => (
                    <details key={question} className="py-5">
                      <summary
                        className={`cursor-pointer text-lg font-medium ${focusRing}`}
                      >
                        {question}
                      </summary>
                      <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-muted-foreground">
                        <RichText text={answer} />
                      </p>
                    </details>
                  ))}
                </div>
              </section>

              <section
                id="sources"
                aria-labelledby="sources-heading"
                className="scroll-mt-8"
              >
                <h2
                  id="sources-heading"
                  className="text-xl font-medium tracking-[-0.02em]"
                >
                  Sources
                </h2>
                <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {page.sources.map((source) => (
                    <li key={source.url}>
                      <a
                        href={source.url}
                        rel="noopener nofollow"
                        target="_blank"
                        className={`underline decoration-foreground/20 underline-offset-4 transition-colors hover:text-foreground ${focusRing}`}
                      >
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        </article>

        {related.length > 0 && (
          <section
            aria-labelledby="related-heading"
            className="border-t border-foreground/10 px-5 py-12 sm:px-8 md:py-16"
          >
            <div className="mx-auto max-w-[1240px]">
              <h2
                id="related-heading"
                className="text-2xl font-medium tracking-[-0.03em]"
              >
                Keep reading
              </h2>
              <PageCards pages={related} />
            </div>
          </section>
        )}
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  )
}

export function PageCards({
  pages,
}: {
  pages: { href: string; page: SeoPage }[]
}) {
  return (
    <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {pages.map(({ href, page }) => (
        <li key={href}>
          <Link
            href={href}
            className={`flex h-full flex-col rounded-2xl border border-foreground/10 p-6 transition-colors hover:border-foreground/25 hover:bg-foreground/[0.03] ${focusRing}`}
          >
            <span className="text-lg font-medium tracking-[-0.02em]">
              {page.label}
            </span>
            <span className="mt-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">
              {page.description}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
