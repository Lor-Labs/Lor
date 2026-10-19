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
    "Lor is where your team talks and gets work done. Bring AI into the conversation, pull in an engineer, and turn an idea into something everyone can use.",
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
      "Work with AI and your team in the same place. Bring someone into a conversation, build something together, and pick up where they left off.",
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
