import {
  LaptopIcon,
  Logout01Icon,
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
import { usePageHint } from "@/components/hints/hints-provider"
import {
  sidebarMenuHeader,
  sidebarMenuIcon,
  sidebarMenuRow,
  sidebarMenuSeparator,
  sidebarMenuSurface,
} from "@/components/sidebar/sidebar-menu-styles"
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
            className={sidebarMenuSurface}
            side={isMobile ? "bottom" : "top"}
            align="start"
            sideOffset={6}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className={sidebarMenuHeader}>
                <UserAvatar
                  name={name}
                  src={session?.user.image}
                  size="sm"
                  className="rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[13px] text-foreground">
                    {name}
                  </div>
                  <div className="mt-0.5 truncate font-normal text-[11px] text-muted-foreground">
                    {email}
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className={sidebarMenuSeparator} />
            <DropdownMenuItem
              className={`${sidebarMenuRow} cursor-default`}
              closeOnClick={false}
            >
              Theme
              <div className="ml-auto">
                <ThemeSwitcher />
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator className={sidebarMenuSeparator} />
            <DropdownMenuGroup>
              <DropdownMenuItem
                className={sidebarMenuRow}
                onClick={() => openSettings("user")}
              >
                <HugeiconsIcon
                  icon={Settings01Icon}
                  className={sidebarMenuIcon}
                  strokeWidth={1.5}
                />
                Settings
                <DropdownMenuShortcut>{SETTINGS_SHORTCUT}</DropdownMenuShortcut>
              </DropdownMenuItem>
              {canDownloadDesktopApp && (
                <DropdownMenuItem
                  className={sidebarMenuRow}
                  onClick={() => {
                    downloadDesktopApp()
                    dismissDesktopHint()
                  }}
                >
                  <HugeiconsIcon
                    icon={LaptopIcon}
                    className={sidebarMenuIcon}
                    strokeWidth={1.5}
                  />
                  Download for Mac
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator className={sidebarMenuSeparator} />
            <DropdownMenuItem
              variant="destructive"
              className={sidebarMenuRow}
              onClick={handleLogout}
            >
              <HugeiconsIcon
                icon={Logout01Icon}
                className="size-4"
                strokeWidth={1.5}
              />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
