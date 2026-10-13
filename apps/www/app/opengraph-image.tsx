import { ImageResponse } from "next/og"

export const alt = "Lor: AI agents your whole team can steer"
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
      <div
        style={{
          fontSize: 40,
          fontWeight: 400,
          color: "rgba(240,239,237,0.6)",
          letterSpacing: "-0.02em",
        }}
      >
        Lor
      </div>
      <div style={{ marginTop: 16, fontSize: 72, lineHeight: 1.05 }}>
        AI agents your whole team can steer.
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
        Works when you ask or on a schedule. Everyone sees the work.
      </div>
    </div>,
    size
  )
}
