import {
  Archive02Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  HashtagIcon,
  MoreHorizontalIcon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarGroup } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { type ReactNode, useState } from "react"

// /design: candidate session headers, each in a mock session pane with the
// first turns under it. Static sample data; nothing calls the API.

const SESSION = {
  title: "Fix flaky checkout test",
  channel: "engineering",
  startedBy: "Maren Okafor",
  started: "2h ago",
}
const SUBSCRIBERS = ["Maren Okafor", "Teo Lindqvist", "Priya Raman"]

export function SessionHeaderVariants() {
  const [working, setWorking] = useState(true)
  return (
    <div className="space-y-12">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          Same session in each. Hover the panes; variant C reveals its actions
          on hover.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setWorking((value) => !value)}
        >
          {working ? "Lor idle" : "Lor working"}
        </Button>
      </div>

      <Variant
        letter="A"
        name="Title as the document's heading"
        note="A slim icon strip on top; the title opens the document, with one quiet line of context under it."
      >
        <Pane>
          <div className="flex h-11 items-center gap-1 px-3">
            <NavControls />
            <div className="ml-auto flex items-center gap-0.5">
              <Subscribers />
              <IconButton icon={Archive02Icon} label="Archive" />
              <IconButton icon={MoreHorizontalIcon} label="More" />
              <PanelToggle />
            </div>
          </div>
          <Document>
            <h1 className="font-semibold text-[26px] leading-tight tracking-tight">
              {SESSION.title}
            </h1>
            <Meta working={working} className="mt-2" />
            <div className="mt-6 border-border/50 border-t" />
            <Turns />
          </Document>
        </Pane>
      </Variant>

      <Variant
        letter="B"
        name="Breadcrumb bar"
        note="One line: where it lives, then what it is. Archive moves into the menu; a dot pulses while Lor works."
      >
        <Pane>
          <div className="flex h-12 items-center gap-2 border-border/50 border-b px-3">
            <NavControls />
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground">
                <HugeiconsIcon
                  icon={HashtagIcon}
                  className="size-3.5"
                  strokeWidth={2}
                />
                {SESSION.channel}
              </span>
              <span className="text-muted-foreground/50">/</span>
              <span className="truncate font-medium">{SESSION.title}</span>
              {working && <WorkingDot />}
            </div>
            <div className="ml-auto flex items-center gap-0.5">
              <Subscribers />
              <IconButton icon={MoreHorizontalIcon} label="More" />
              <PanelToggle />
            </div>
          </div>
          <Document>
            <Turns />
          </Document>
        </Pane>
      </Variant>

      <Variant
        letter="C"
        name="Floating actions"
        note="No bar at all. The heading starts the page; the actions appear top-right when you point near them."
      >
        <Pane className="group/pane">
          <div className="absolute top-2.5 left-3">
            <NavControls />
          </div>
          <div className="absolute top-2.5 right-3 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/pane:opacity-100">
            <Subscribers />
            <IconButton icon={Archive02Icon} label="Archive" />
            <IconButton icon={MoreHorizontalIcon} label="More" />
            <PanelToggle />
          </div>
          <Document className="pt-16">
            <Meta working={working} />
            <h1 className="mt-1.5 font-semibold text-[28px] leading-tight tracking-tight">
              {SESSION.title}
            </h1>
            <Turns className="mt-8" />
          </Document>
        </Pane>
      </Variant>
    </div>
  )
}

function Variant({
  letter,
  name,
  note,
  children,
}: {
  letter: string
  name: string
  note: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-mono text-muted-foreground text-xs">
          {letter}
        </span>
        <h3 className="font-medium text-sm">{name}</h3>
      </div>
      <p className="mb-4 max-w-2xl text-muted-foreground text-sm">{note}</p>
      {children}
    </div>
  )
}

// A main pane like the app's: rounded, on the page background.
function Pane({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "relative h-[420px] overflow-hidden rounded-xl border border-border/60 bg-background",
        className
      )}
    >
      {children}
    </div>
  )
}

function Document({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn("mx-auto max-w-2xl px-8 pt-8", className)}>
      {children}
    </div>
  )
}

function NavControls() {
  return (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      <span className="flex size-7 items-center justify-center">
        <SidebarToggleIcon isOpen className="size-[18px]" />
      </span>
      <span className="flex size-7 items-center justify-center opacity-60">
        <HugeiconsIcon
          icon={ArrowLeft02Icon}
          className="size-4"
          strokeWidth={2}
        />
      </span>
      <span className="flex size-7 items-center justify-center opacity-30">
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          className="size-4"
          strokeWidth={2}
        />
      </span>
    </div>
  )
}

function IconButton({ icon, label }: { icon: IconSvgElement; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} className="size-4" strokeWidth={2} />
    </button>
  )
}

function PanelToggle() {
  return (
    <span className="flex size-7 items-center justify-center text-muted-foreground">
      <SidebarToggleIcon isOpen className="size-[18px] -scale-x-100" />
    </span>
  )
}

// Subscribers own Subscribe/Unsubscribe in their menu; the header keeps only
// the faces.
function Subscribers() {
  return (
    <button
      type="button"
      aria-label="Subscribers"
      className="flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
    >
      <AvatarGroup className="-space-x-1">
        {SUBSCRIBERS.map((name) => (
          <Face key={name} name={name} className="size-5 text-[9px]" />
        ))}
      </AvatarGroup>
      <HugeiconsIcon
        icon={UserAdd01Icon}
        className="size-3.5"
        strokeWidth={2}
      />
    </button>
  )
}

function Face({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={cn("shrink-0", className)}>
      <AvatarFallback fallbackSeed={name} className="font-semibold">
        {getAvatarInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

function Meta({
  working,
  className,
}: {
  working: boolean
  className?: string
}) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-sm",
        className
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        <HugeiconsIcon
          icon={HashtagIcon}
          className="size-3.5"
          strokeWidth={2}
        />
        {SESSION.channel}
      </span>
      <span aria-hidden="true">·</span>
      <span>Started by {SESSION.startedBy}</span>
      <span aria-hidden="true">·</span>
      <span>{SESSION.started}</span>
      {working && (
        <>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5 text-agent">
            <WorkingDot />
            Lor is working
          </span>
        </>
      )}
    </p>
  )
}

function WorkingDot() {
  return (
    <span className="relative flex size-1.5">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-agent opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-1.5 rounded-full bg-agent" />
    </span>
  )
}

function Turns({ className }: { className?: string }) {
  return (
    <div className={cn("mt-6 space-y-5", className)}>
      <Turn name="Maren Okafor">
        <span className="rounded bg-agent/10 px-1 text-agent">@Lor</span> the
        checkout test fails about one run in five on CI. Can you find out why?
      </Turn>
      <Turn lor>
        It's a race in the cart fixture: the test reads the total before the
        discount webhook lands. I'll make the fixture wait for the webhook and
        open a draft PR.
      </Turn>
    </div>
  )
}

function Turn({
  name,
  lor,
  children,
}: {
  name?: string
  lor?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      {lor ? (
        <img
          src="/lor-icon.png"
          alt=""
          className="size-7 shrink-0 rounded-full"
        />
      ) : (
        <Face name={name ?? ""} className="size-7 text-[11px]" />
      )}
      <p className="min-w-0 flex-1 text-[15px] text-foreground/90 leading-6">
        {children}
      </p>
    </div>
  )
}
