import type { Metadata } from "next"
import { SeoIndex } from "@/app/components/seo-index"
import { COMPARE_ENTRIES } from "@/app/lib/seo/pages"

const title = "Compare Lor | Lor"
const description =
  "How Lor compares with Slack, Microsoft Teams, ChatGPT Business and Claude Team for teams that work with AI together."

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/compare" },
  openGraph: {
    title,
    description,
    url: "/compare",
    siteName: "Lor",
    type: "website",
    // Page-level openGraph replaces the inherited root image.
    images: { url: "/opengraph-image", width: 1200, height: 630 },
  },
}

export default function CompareIndex() {
  return (
    <SeoIndex
      title="Compare Lor"
      intro="Where Lor fits next to the chat apps and AI plans your team already uses, and where those tools are the better pick."
      entries={COMPARE_ENTRIES}
    />
  )
}
