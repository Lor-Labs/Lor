import type { Metadata } from "next"
import { SeoIndex } from "@/app/components/seo-index"
import { COMPARE_ENTRIES } from "@/app/lib/seo/pages"

export const metadata: Metadata = {
  title: "Compare Lor | Lor",
  description:
    "How Lor compares with Slack, Microsoft Teams, ChatGPT Business and Claude Team for teams that work with AI together.",
  alternates: { canonical: "/compare" },
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
