export const sidebarMenuSurface =
  "w-60 min-w-0 max-w-(--available-width) rounded-xl border-foreground/10 shadow-[0_8px_24px_-8px_rgb(0_0_0/0.22)] motion-safe:transition-opacity motion-safe:duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0 [&>div]:p-1"
export const sidebarMenuRow =
  "min-h-9 gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] sm:min-h-8 sm:text-[13px]"
export const sidebarMenuIcon = "size-4 text-muted-foreground opacity-100"
export const sidebarMenuHeader = "flex items-center gap-2.5 px-2.5 py-2"
export const sidebarMenuSeparator = "mx-2.5 my-1 bg-foreground/8"
export const sidebarMenuSubTrigger = `${sidebarMenuRow} [&>svg:last-child]:size-3.5 [&>svg:last-child]:text-muted-foreground/60 [&>svg:last-child]:[stroke-width:1.5]`

// Sidebar row fills step hover < selected < pressed, so a selected row never
// reads as hovered. A row's press is its fill, so it skips the global dim.
export const sidebarRow =
  "transition-colors duration-150 ease-out active:bg-foreground/[0.09] active:opacity-100"
export const sidebarRowHover = "hover:bg-foreground/[0.04]"
export const sidebarRowSelected = "bg-foreground/[0.07]"
// Section headers are Title Case labels, never all caps.
export const sidebarSectionLabel =
  "text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
// Marks that appear on a row (selection bar, unread dot, badge) grow in.
export const sidebarRowMarkIn =
  "transition-[scale,opacity] duration-200 ease-out starting:scale-0 starting:opacity-0 motion-reduce:transition-none"
