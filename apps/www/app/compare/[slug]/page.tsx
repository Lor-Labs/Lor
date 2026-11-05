import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SeoArticle } from "@/app/components/seo-article"
import { COMPARISONS } from "@/app/lib/seo/compare"
import { COMPARE_SECTION, findPage } from "@/app/lib/seo/pages"

export const dynamicParams = false

export function generateStaticParams() {
  return COMPARISONS.map(({ slug }) => ({ slug }))
}

async function load(params: Promise<{ slug: string }>) {
  const { slug } = await params
  return findPage(`${COMPARE_SECTION.href}/${slug}`)
}

export async function generateMetadata({
  params,
}: PageProps<"/compare/[slug]">): Promise<Metadata> {
  const entry = await load(params)
  if (!entry) return {}
  const { href, page } = entry
  return {
    title: page.metaTitle,
    description: page.description,
    alternates: { canonical: href },
    openGraph: {
      title: page.metaTitle,
      description: page.description,
      url: href,
      type: "article",
    },
  }
}

export default async function ComparePage({
  params,
}: PageProps<"/compare/[slug]">) {
  const entry = await load(params)
  if (!entry) notFound()
  return <SeoArticle page={entry.page} section={COMPARE_SECTION} />
}
