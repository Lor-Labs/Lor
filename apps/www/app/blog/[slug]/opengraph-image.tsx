import { GUIDES } from "@/app/lib/seo/guides"
import { seoOgImage } from "@/app/lib/seo/og-image"
import { BLOG_SECTION, findPage } from "@/app/lib/seo/pages"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export function generateStaticParams() {
  return GUIDES.map(({ slug }) => ({ slug }))
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const entry = findPage(`${BLOG_SECTION.href}/${slug}`)
  return seoOgImage(entry?.page, BLOG_SECTION.name)
}
