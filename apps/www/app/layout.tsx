import type { Metadata } from "next"
import localFont from "next/font/local"
import "@repo/ui/globals.css"
import { Grain } from "@/app/components/grain"
import { SiteHeader } from "@/app/components/site-header"
import { ThemeProvider } from "@/app/components/theme-provider"

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
})
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL("https://lor.chat"),
  title: "Lor | The multiplayer runtime for your team and agents",
  description:
    "Bring Claude Code, Codex, or whatever agent you already pay for. Every session in Lor is shared with your team, so each agent builds on what the others already learned.",
  icons: {
    icon: [
      { url: "/lor-icon.svg", type: "image/svg+xml" },
      { url: "/lor-icon.png", type: "image/png" },
    ],
    shortcut: "/lor-icon.svg",
    apple: "/lor-icon.png",
  },
  openGraph: {
    title: "Lor | The multiplayer runtime for your team and agents",
    description:
      "Bring the agent you already pay for. In Lor, every agent builds on what your team's other sessions already learned.",
    url: "https://lor.chat",
    siteName: "Lor",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.className} ${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" forcedTheme="dark">
          <SiteHeader />
          {children}
          <Grain />
        </ThemeProvider>
      </body>
    </html>
  )
}
