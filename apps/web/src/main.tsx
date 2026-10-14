import { AnchoredToastProvider, ToastProvider } from "@repo/ui/components/toast"
import { TooltipProvider } from "@repo/ui/components/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { MotionConfig } from "motion/react"
import { ThemeProvider } from "next-themes"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@repo/ui/globals.css"
import "streamdown/styles.css"
import "@/styles/fonts.css"
import { isTauri } from "@repo/auth/tauri-fetch"
import { routeTree } from "@/routeTree.gen"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
    },
  },
})

// A channel's details and messages seed its next visit (and the sidebar's
// warm-up in use-prefetch-channels), so they stay for the session instead of
// the 5-minute default for caches no page is using.
queryClient.setQueryDefaults(["channel"], { gcTime: Number.POSITIVE_INFINITY })
queryClient.setQueryDefaults(["messages"], {
  gcTime: Number.POSITIVE_INFINITY,
})

const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

// A deploy replaces hashed chunks, so open tabs fail lazy route imports.
// Reload once to pick up the new index.html; the guard avoids a reload loop
// when an asset is missing for some other reason.
window.addEventListener("vite:preloadError", (event) => {
  const lastReload = sessionStorage.getItem("chunk-reload-at")
  if (lastReload && Date.now() - Number(lastReload) < 30_000) return
  event.preventDefault()
  sessionStorage.setItem("chunk-reload-at", String(Date.now()))
  window.location.reload()
})

// In the desktop app, links to other origins must open in the system browser
// instead of navigating the webview.
if (isTauri) {
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented) return
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest("a[href]")
    if (!(anchor instanceof HTMLAnchorElement)) return
    const url = new URL(anchor.href, window.location.href)
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    if (url.origin === window.location.origin) return
    event.preventDefault()
    void import("@tauri-apps/plugin-opener").then(({ openUrl }) =>
      openUrl(url.href)
    )
  })
}

const rootElement = document.getElementById("root")
if (!rootElement) throw new Error("Root element not found")

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <ToastProvider>
          <AnchoredToastProvider>
            <TooltipProvider>
              {/* Reduced motion: transforms, size, and layout animations snap; opacity still fades. */}
              <MotionConfig reducedMotion="user">
                <RouterProvider router={router} />
              </MotionConfig>
            </TooltipProvider>
          </AnchoredToastProvider>
        </ToastProvider>
      </ThemeProvider>
      {/*<ReactQueryDevtools initialIsOpen={false} buttonPosition="top-right" />*/}
    </QueryClientProvider>
  </StrictMode>
)
