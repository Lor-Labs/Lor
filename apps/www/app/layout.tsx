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
  title: "Lor | The open source multiplayer AI workspace for teams",
  description:
    "Lor is the open source multiplayer AI workspace for teams, powered entirely by open models. $20 per user per month with pooled AI credits, or self-host free under AGPL-3.0.",
  icons: {
    icon: [
      { url: "/lor-icon.svg", type: "image/svg+xml" },
      { url: "/lor-icon.png", type: "image/png" },
    ],
    shortcut: "/lor-icon.svg",
    apple: "/lor-icon.png",
  },
  openGraph: {
    title: "Lor | The open source multiplayer AI workspace for teams",
    description:
      "The multiplayer AI workspace for teams. Open source, open models only, self-hostable under AGPL.",
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
