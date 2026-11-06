import { COMPARISONS } from "@/app/lib/seo/compare"
import { GUIDES } from "@/app/lib/seo/guides"
import type { SeoPage } from "@/app/lib/seo/types"

export const SITE_URL = "https://lor.chat"

export const COMPARE_SECTION = { name: "Compare", href: "/compare" }
export const BLOG_SECTION = { name: "Blog", href: "/blog" }

export const COMPARE_ENTRIES = COMPARISONS.map((page) => ({
  href: `${COMPARE_SECTION.href}/${page.slug}`,
  page,
}))
export const GUIDE_ENTRIES = GUIDES.map((page) => ({
  href: `${BLOG_SECTION.href}/${page.slug}`,
  page,
}))

export function findPage(
  href: string
): { href: string; page: SeoPage } | undefined {
  return [...COMPARE_ENTRIES, ...GUIDE_ENTRIES].find(
    (entry) => entry.href === href
  )
}
