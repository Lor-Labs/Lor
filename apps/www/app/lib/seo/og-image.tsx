import { ImageResponse } from "next/og"
import type { SeoPage } from "@/app/lib/seo/types"

// Matches the root opengraph-image, with the page title as the headline.
export function seoOgImage(page: SeoPage | undefined, section: string) {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: 80,
        backgroundColor: "#121110",
        backgroundImage:
          "radial-gradient(ellipse 80% 70% at 50% -20%, rgba(139,92,246,0.35), rgba(18,17,16,0))",
        color: "#f0efed",
        fontWeight: 600,
        letterSpacing: "-0.03em",
      }}
    >
      <div
        style={{
          fontSize: 40,
          fontWeight: 400,
          color: "rgba(240,239,237,0.6)",
          letterSpacing: "-0.02em",
        }}
      >
        {`Lor · ${section}`}
      </div>
      <div style={{ marginTop: 16, fontSize: 68, lineHeight: 1.08 }}>
        {page?.title ?? "Work with AI, together."}
      </div>
    </div>,
    { width: 1200, height: 630 }
  )
}
