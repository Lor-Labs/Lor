import type { MetadataRoute } from "next"
import {
  BLOG_SECTION,
  COMPARE_ENTRIES,
  COMPARE_SECTION,
  GUIDE_ENTRIES,
  SITE_URL,
} from "@/app/lib/seo/pages"

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}${COMPARE_SECTION.href}`, priority: 0.7 },
    { url: `${SITE_URL}${BLOG_SECTION.href}`, priority: 0.7 },
    ...[...COMPARE_ENTRIES, ...GUIDE_ENTRIES].map(({ href, page }) => ({
      url: `${SITE_URL}${href}`,
      lastModified: page.checkedOn,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ]
}
