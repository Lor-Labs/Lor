import { COMPARISONS } from "@/app/lib/seo/compare"
import { seoOgImage } from "@/app/lib/seo/og-image"
import { COMPARE_SECTION, findPage } from "@/app/lib/seo/pages"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export function generateStaticParams() {
  return COMPARISONS.map(({ slug }) => ({ slug }))
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const entry = findPage(`${COMPARE_SECTION.href}/${slug}`)
  return seoOgImage(entry?.page, COMPARE_SECTION.name)
}
