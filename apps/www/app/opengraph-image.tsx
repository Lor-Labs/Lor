import { ImageResponse } from "next/og"

export const alt = "Lor — the multiplayer AI workspace"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OpengraphImage() {
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
        fontSize: 84,
        fontWeight: 600,
        letterSpacing: "-0.03em",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
        Lor
        <div
          style={{
            fontSize: 40,
            fontWeight: 400,
            color: "rgba(240,239,237,0.6)",
            letterSpacing: "-0.02em",
          }}
        >
          The multiplayer AI workspace.
        </div>
      </div>
      <div
        style={{
          marginTop: 28,
          fontSize: 30,
          fontWeight: 400,
          color: "rgba(240,239,237,0.55)",
          letterSpacing: "-0.01em",
        }}
      >
        Ask Lor anything. Get answers with citations. Open source.
      </div>
    </div>,
    size
  )
}
