import { Toaster } from "@repo/ui/components/sonner"
import { TooltipProvider } from "@repo/ui/components/tooltip"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { ThemeProvider } from "next-themes"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@repo/ui/globals.css"
import "streamdown/styles.css"
import "@/styles/fonts.css"
import { routeTree } from "@/routeTree.gen"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
    },
  },
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
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster richColors />
        </TooltipProvider>
      </ThemeProvider>
      {/*<ReactQueryDevtools initialIsOpen={false} buttonPosition="top-right" />*/}
    </QueryClientProvider>
  </StrictMode>
)
