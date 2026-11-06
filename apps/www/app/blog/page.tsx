import type { Metadata } from "next"
import { SeoIndex } from "@/app/components/seo-index"
import { GUIDE_ENTRIES } from "@/app/lib/seo/pages"

const title = "Blog | Lor"
const description =
  "Guides for small teams choosing how to work with AI agents together: shared workspaces, agent platforms and where chat apps fit."

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/blog" },
  openGraph: {
    title,
    description,
    url: "/blog",
    siteName: "Lor",
    type: "website",
    // Page-level openGraph replaces the inherited root image.
    images: { url: "/opengraph-image", width: 1200, height: 630 },
  },
}

export default function BlogIndex() {
  return (
    <SeoIndex
      title="Blog"
      intro="Guides for small teams working out how to use AI agents together."
      entries={GUIDE_ENTRIES}
    />
  )
}
