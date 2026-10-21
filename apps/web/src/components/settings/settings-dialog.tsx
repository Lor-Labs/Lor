import {
  ComputerTerminal01Icon,
  GlobeIcon,
  KeyboardIcon,
  Message01Icon,
  Notification01Icon,
  PaintBrush01Icon,
  Search01Icon,
  Settings01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui/components/breadcrumb"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@repo/ui/components/sidebar"
import { listen } from "@tauri-apps/api/event"
import { useEffect, useMemo, useState } from "react"
import { AppearanceSettings } from "@/components/settings/appearance-settings"
import { LorSettings } from "@/components/settings/lor-settings"
import { MyAccountSettings } from "@/components/settings/my-account-settings"
import { NotificationSettings } from "@/components/settings/notification-settings"
import { useAppVersion } from "@/hooks/use-app-version"
import { useSettings } from "@/hooks/use-settings"

interface SettingsNav {
  id: string
  name: string
  icon: IconSvgElement
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

const settingsNav = [
  { id: "account", name: "My Account", icon: UserIcon },
  { id: "appearance", name: "Appearance", icon: PaintBrush01Icon },
  { id: "notifications", name: "Notifications", icon: Notification01Icon },
  { id: "lor", name: "Lor", icon: ComputerTerminal01Icon },
  { id: "messages", name: "Messages & Media", icon: Message01Icon },
  { id: "language", name: "Language & Region", icon: GlobeIcon },
  { id: "accessibility", name: "Accessibility", icon: KeyboardIcon },
  { id: "advanced", name: "Advanced", icon: Settings01Icon },
] as const satisfies readonly SettingsNav[]

export function SettingsDialog() {
  const { target, tab, open, close, setTab } = useSettings()
  const isOpen = target === "user"
  const [search, setSearch] = useState("")
  const appVersion = useAppVersion()

  useEffect(() => {
    if (isTauri) {
      let disposed = false
      let stopListening: (() => void) | undefined

      listen("open-settings", () => open("user"))
        .then((unlisten) => {
          if (disposed) {
            unlisten()
          } else {
            stopListening = unlisten
          }
        })
        .catch((error) => {
          console.error("[settings] failed to register desktop menu:", error)
        })

      return () => {
        disposed = true
        stopListening?.()
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        open("user")
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [open])

  const activeItem =
    settingsNav.find((item) => item.id === tab) ?? settingsNav[0]

  const filteredNav = useMemo(() => {
    if (!search.trim()) return settingsNav
    const q = search.toLowerCase()
    return settingsNav.filter((item) => item.name.toLowerCase().includes(q))
  }, [search])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="overflow-hidden p-0 md:max-h-[700px] md:max-w-[850px] lg:max-w-[1000px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your settings here.
        </DialogDescription>
        <SidebarProvider className="min-h-0 items-start">
          <Sidebar collapsible="none" className="hidden border-r md:flex">
            <SidebarHeader>
              <div className="relative">
                <HugeiconsIcon
                  icon={Search01Icon}
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={2}
                />
                <Input
                  placeholder="Search settings..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8"
                  autoFocus={false}
                  tabIndex={-1}
                />
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {filteredNav.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === activeItem.id}
                          onClick={() => setTab(item.id)}
                        >
                          <HugeiconsIcon icon={item.icon} strokeWidth={2} />
                          <span>{item.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[660px] flex-1 flex-col overflow-hidden">
            <header className="flex h-14 shrink-0 items-center border-b px-4">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    <span className="text-muted-foreground">Settings</span>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{activeItem.name}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </header>
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              {activeItem.id === "account" ? (
                <MyAccountSettings />
              ) : activeItem.id === "appearance" ? (
                <AppearanceSettings />
              ) : activeItem.id === "notifications" ? (
                <NotificationSettings />
              ) : activeItem.id === "lor" ? (
                <LorSettings />
              ) : (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  {activeItem.name} settings coming soon.
                </div>
              )}
            </div>
            {appVersion ? (
              <footer className="shrink-0 border-t px-4 py-2 text-xs text-muted-foreground">
                Lor v{appVersion}
              </footer>
            ) : null}
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}
