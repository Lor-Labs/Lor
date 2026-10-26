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
  title: "Lor | Work with AI, together",
  description:
    "Research, build, and make decisions with AI in shared sessions. Lor brings your team's conversations, tools, and knowledge into the work, so anyone can pick it up.",
  icons: {
    icon: [
      { url: "/lor-icon.svg", type: "image/svg+xml" },
      { url: "/lor-icon.png", type: "image/png" },
    ],
    shortcut: "/lor-icon.svg",
    apple: "/lor-icon.png",
  },
  openGraph: {
    title: "Lor | Work with AI, together",
    description:
      "Bring your team's context into shared AI sessions. Go from a customer question to research, code, and review, with teammates who can pick up where you left off.",
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
