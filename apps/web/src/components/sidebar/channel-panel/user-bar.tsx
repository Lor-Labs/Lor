import {
  LaptopIcon,
  Settings01Icon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@repo/ui/components/menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@repo/ui/components/sidebar"
import { ThemeSwitcher } from "@repo/ui/components/unlumen-ui/theme-switcher"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { LogOut } from "lucide-react"
import { usePageHint } from "@/components/hints/hints-provider"
import { UserAvatar } from "@/components/ui/user-avatar"
import { useSettings } from "@/hooks/use-settings"
import {
  canDownloadDesktopApp,
  downloadDesktopApp,
} from "@/lib/desktop-download"

// The shortcut handler in settings-dialog accepts metaKey || ctrlKey, so the
// label has to follow the platform rather than always showing ⌘ (the desktop
// app ships on Windows and Linux too).
const SETTINGS_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘,"
    : "Ctrl+,"

export function UserBar() {
  const { data: session } = authClient.useSession()
  const { open: openSettings } = useSettings()
  const { isMobile } = useSidebar()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const name = session?.user.name ?? "User"
  const email = session?.user.email ?? ""
  const { dismiss: dismissDesktopHint } = usePageHint("desktop_app")

  // Go to /login explicitly, with no return path: the next person to sign in
  // in this tab may be a different account, which must neither inherit this
  // account's page nor see its cached queries.
  const handleLogout = async () => {
    try {
      await authClient.signOut()
    } catch (err) {
      console.error("Sign out failed:", err)
      return
    }
    queryClient.clear()
    await navigate({ to: "/login", replace: true })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <div className="relative shrink-0">
              <UserAvatar
                name={name}
                src={session?.user.image}
                size="sm"
                className="rounded-lg"
              />
              <div className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-[2px] border-sidebar bg-emerald-500" />
            </div>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {email}
              </span>
            </div>
            <HugeiconsIcon
              icon={UnfoldMoreIcon}
              className="ml-auto size-4 text-muted-foreground"
              strokeWidth={2}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-60 min-w-0 max-w-(--available-width) rounded-lg"
            side={isMobile ? "bottom" : "top"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserAvatar
                    name={name}
                    src={session?.user.image}
                    size="sm"
                    className="rounded-lg"
                  />
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-default" closeOnClick={false}>
              Theme
              <div className="ml-auto">
                <ThemeSwitcher />
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => openSettings("user")}>
                <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
                Settings
                <DropdownMenuShortcut>{SETTINGS_SHORTCUT}</DropdownMenuShortcut>
              </DropdownMenuItem>
              {canDownloadDesktopApp && (
                <DropdownMenuItem
                  onClick={() => {
                    downloadDesktopApp()
                    dismissDesktopHint()
                  }}
                >
                  <HugeiconsIcon icon={LaptopIcon} strokeWidth={2} />
                  Download for Mac
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
