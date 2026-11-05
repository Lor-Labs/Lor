import type { Metadata } from "next"
import { SeoIndex } from "@/app/components/seo-index"
import { GUIDE_ENTRIES } from "@/app/lib/seo/pages"

export const metadata: Metadata = {
  title: "Blog | Lor",
  description:
    "Guides for small teams choosing how to work with AI agents together: shared workspaces, agent platforms and where chat apps fit.",
  alternates: { canonical: "/blog" },
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
