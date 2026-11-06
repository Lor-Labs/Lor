import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { SeoArticle } from "@/app/components/seo-article"
import { GUIDES } from "@/app/lib/seo/guides"
import { BLOG_SECTION, findPage } from "@/app/lib/seo/pages"

export const dynamicParams = false

export function generateStaticParams() {
  return GUIDES.map(({ slug }) => ({ slug }))
}

async function load(params: Promise<{ slug: string }>) {
  const { slug } = await params
  return findPage(`${BLOG_SECTION.href}/${slug}`)
}

export async function generateMetadata({
  params,
}: PageProps<"/blog/[slug]">): Promise<Metadata> {
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

export default async function GuidePage({ params }: PageProps<"/blog/[slug]">) {
  const entry = await load(params)
  if (!entry) notFound()
  return <SeoArticle page={entry.page} section={BLOG_SECTION} />
}
