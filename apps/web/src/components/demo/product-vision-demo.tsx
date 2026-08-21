import {
  AiBrain01Icon,
  Archive03Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  FolderOpenIcon,
  HashtagIcon,
  MoreHorizontalIcon,
  Notification01Icon,
  PlusSignIcon,
  RepeatIcon,
  Search01Icon,
  SentIcon,
  SourceCodeIcon,
  Tick02Icon,
  UnfoldMoreIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Button } from "@repo/ui/components/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@repo/ui/components/sidebar"
import { SidebarToggleIcon } from "@repo/ui/components/unlumen-ui/sidebar-toggle-icon"
import { cn } from "@repo/ui/lib/utils"
import { AnimatePresence, motion } from "framer-motion"
import { memo, useCallback, useEffect, useState } from "react"
import { MerlinMessageBody } from "@/components/chat/merlin-message-body"
import { MessageMarkdown } from "@/components/chat/message-markdown"
import {
  DesktopSidebarTitlebar,
  HeaderNavControls,
} from "@/components/desktop-titlebar"
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar"
import type { MerlinToolCallView, Message } from "@/lib/api-types"

export const LAST_SCENE = 5
const MERLIN_ID = "00000000-0000-4000-8000-000000000001"

const sceneMeta = [
  { id: 1, label: "Project folder", panelTitle: "Mobile launch" },
  { id: 2, label: "Mention Merlin", panelTitle: "Project members" },
  { id: 3, label: "Cowork", panelTitle: "Launch room" },
  { id: 4, label: "Loop", panelTitle: "Morning launch check" },
  { id: 5, label: "Archive", panelTitle: "Project memory" },
] as const

const people = {
  mara: {
    name: "Mara Voss",
    role: "Product",
    image: "/demo/mara.jpg",
    fallback: "MV",
  },
  eli: {
    name: "Eli Mercer",
    role: "Engineering",
    image: "/demo/eli.jpg",
    fallback: "EM",
  },
  samira: {
    name: "Samira Vale",
    role: "Marketing",
    image: "/demo/samira.jpg",
    fallback: "SV",
  },
  owen: {
    name: "Owen Park",
    role: "Design",
    image: "/demo/owen.jpg",
    fallback: "OP",
  },
  merlin: {
    name: "Merlin",
    role: "AI coworker",
    image: "/lor-mark.svg",
    fallback: "M",
  },
} as const

type Person = (typeof people)[keyof typeof people]

const merlinMentions: Message["mentions"] = [
  {
    id: MERLIN_ID,
    name: "Merlin",
    username: "merlin",
    displayUsername: "merlin",
    image: "/lor-mark.svg",
    avatarColor: null,
  },
]

const coworkToolCalls = [
  {
    toolCallId: "project-context",
    toolName: "search_messages",
    label: "Read 4 project channels",
    at: 0,
    order: 0,
    status: "ok",
  },
  {
    toolCallId: "linear-blockers",
    toolName: "linear_search",
    label: "Checked 14 Linear issues",
    at: 0,
    order: 1,
    status: "ok",
  },
  {
    toolCallId: "release-branch",
    toolName: "github_search",
    label: "Inspected northstar/mobile release branch",
    at: 0,
    order: 2,
    status: "ok",
  },
] satisfies MerlinToolCallView[]

type ProductVisionDemoProps = {
  scene: number
  recording: boolean
  onSceneChange: (scene: number) => void
  onRecordingChange: (recording: boolean) => void
}

export function ProductVisionDemo({
  scene,
  recording,
  onSceneChange,
  onRecordingChange,
}: ProductVisionDemoProps) {
  const [approved, setApproved] = useState(false)
  const [loopCreated, setLoopCreated] = useState(false)

  const goToScene = useCallback(
    (nextScene: number) => {
      onSceneChange(Math.min(LAST_SCENE, Math.max(1, nextScene)))
    },
    [onSceneChange]
  )

  useEffect(() => {
    if (scene === 3) setApproved(false)
    if (scene === 4) setLoopCreated(false)
  }, [scene])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === "ArrowLeft") {
        event.preventDefault()
        goToScene(scene - 1)
        return
      }
      if (event.key === "ArrowRight") {
        event.preventDefault()
        goToScene(scene + 1)
        return
      }
      if (event.key === "Escape" && recording) {
        onRecordingChange(false)
        return
      }
      const requestedScene = Number(event.key)
      if (requestedScene >= 1 && requestedScene <= LAST_SCENE) {
        goToScene(requestedScene)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [goToScene, onRecordingChange, recording, scene])

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-sidebar text-foreground">
      <SidebarProvider
        className="h-full min-h-0 overflow-hidden"
        style={{ "--sidebar-width": "240px" } as React.CSSProperties}
      >
        <DemoSidebar scene={scene} onSceneChange={goToScene} />
        <SidebarInset className="min-w-0 md:my-2 md:mr-2 md:rounded-xl md:border md:border-border/60 md:shadow-none">
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden md:rounded-[inherit]">
            <DemoChannelHeader scene={scene} />
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={scene}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="absolute inset-0"
                >
                  {scene === 1 && <ProjectFolderScene />}
                  {scene === 2 && <MentionScene onSend={() => goToScene(3)} />}
                  {scene === 3 && <CoworkScene approved={approved} />}
                  {scene === 4 && (
                    <LoopScene
                      created={loopCreated}
                      onCreate={() => setLoopCreated(true)}
                    />
                  )}
                  {scene === 5 && <ArchiveScene />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </SidebarInset>
        <DemoRightPanel
          scene={scene}
          approved={approved}
          onApprove={() => setApproved(true)}
          loopCreated={loopCreated}
        />
      </SidebarProvider>

      {!recording && (
        <DemoControls
          scene={scene}
          onSceneChange={goToScene}
          onRecording={() => onRecordingChange(true)}
        />
      )}
    </div>
  )
}

function DemoSidebar({
  scene,
  onSceneChange,
}: {
  scene: number
  onSceneChange: (scene: number) => void
}) {
  const activeChannel =
    scene === 3 ? "launch-room" : scene === 5 ? "archived" : "launch-brief"

  return (
    <Sidebar variant="inset">
      <DesktopSidebarTitlebar />
      <SidebarHeader className="gap-1 p-0 pb-1">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            <SidebarMenuButton size="lg" className="hover:bg-sidebar-accent">
              <WorkspaceAvatar
                name="Northstar"
                className="size-8 rounded-lg text-sm"
              />
              <div className="flex min-w-0 flex-1 items-center text-left text-sm leading-tight">
                <span className="truncate font-semibold">Northstar</span>
              </div>
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="px-2 pt-3 pb-1">
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <HugeiconsIcon
              icon={Search01Icon}
              className="size-3.5"
              strokeWidth={2}
            />
            Search Northstar
            <span className="ml-auto text-[10px]">⌘K</span>
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 pb-2">
        <ChannelGroup label="Halls">
          <ChannelRow icon={HashtagIcon} label="general" />
          <ChannelRow icon={HashtagIcon} label="ops" unread />
          <ChannelRow icon={HashtagIcon} label="incidents" />
        </ChannelGroup>

        {scene < 5 && (
          <ChannelGroup label="Mobile launch" project>
            <ChannelRow
              icon={HashtagIcon}
              label="launch-brief"
              active={activeChannel === "launch-brief"}
              onClick={() => onSceneChange(1)}
            />
            <ChannelRow icon={HashtagIcon} label="engineering" />
            <ChannelRow icon={HashtagIcon} label="marketing" />
            <ChannelRow
              icon={VolumeHighIcon}
              label="launch-room"
              active={activeChannel === "launch-room"}
              onClick={() => onSceneChange(3)}
              live
            />
          </ChannelGroup>
        )}

        <ChannelGroup label="Billing refresh" project collapsed />
        <ChannelGroup label="SOC 2 renewal" project collapsed />

        {scene === 5 && (
          <ChannelGroup label="Archived projects" collapsed={false}>
            <ChannelRow
              icon={Archive03Icon}
              label="Mobile launch"
              active={activeChannel === "archived"}
              muted
            />
          </ChannelGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <div className="relative shrink-0">
                <Avatar className="size-8 rounded-lg">
                  <AvatarImage src={people.mara.image} alt={people.mara.name} />
                  <AvatarFallback
                    fallbackSeed={people.mara.name}
                    className="rounded-lg text-xs"
                  >
                    {people.mara.fallback}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-emerald-500" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Mara Voss</span>
                <span className="truncate text-xs text-muted-foreground">
                  mara@northstar.co
                </span>
              </div>
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                className="ml-auto size-4 text-muted-foreground"
                strokeWidth={2}
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function ChannelGroup({
  label,
  project = false,
  collapsed = false,
  children,
}: {
  label: string
  project?: boolean
  collapsed?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="group/category flex w-full items-center gap-0.5 px-1 pb-1">
        <button
          type="button"
          className="flex flex-1 items-center gap-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={cn("size-3 shrink-0", collapsed && "-rotate-90")}
            strokeWidth={2}
          />
          {project && (
            <HugeiconsIcon
              icon={FolderOpenIcon}
              className="mr-1 size-3"
              strokeWidth={2}
            />
          )}
          <span className="truncate">{label}</span>
          {project && (
            <span className="ml-1 rounded-sm bg-primary/10 px-1 py-px text-[8px] font-semibold tracking-normal text-primary">
              PROJECT
            </span>
          )}
        </button>
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Add to ${label}`}
            className="text-muted-foreground opacity-0 group-hover/category:opacity-100"
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          </Button>
        )}
      </div>
      {!collapsed && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

function ChannelRow({
  icon,
  label,
  active = false,
  unread = false,
  live = false,
  muted = false,
  onClick,
}: {
  icon: IconSvgElement
  label: string
  active?: boolean
  unread?: boolean
  live?: boolean
  muted?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
        muted && "opacity-60"
      )}
    >
      <HugeiconsIcon
        icon={icon}
        className="size-4 shrink-0 opacity-60"
        strokeWidth={2}
      />
      <span className="truncate">{label}</span>
      {unread && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
      {live && (
        <span className="ml-auto text-[9px] font-semibold uppercase tracking-wide text-success">
          4 live
        </span>
      )}
    </button>
  )
}

function DemoChannelHeader({ scene }: { scene: number }) {
  const isVoice = scene === 3
  const isArchived = scene === 5

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <HeaderNavControls className="-ml-2" withDivider />
      <HugeiconsIcon
        icon={
          isVoice ? VolumeHighIcon : isArchived ? Archive03Icon : HashtagIcon
        }
        className="size-5 shrink-0 text-muted-foreground"
        strokeWidth={2}
      />
      <span className="font-semibold">
        {isVoice
          ? "launch-room"
          : isArchived
            ? "Mobile launch"
            : "launch-brief"}
      </span>
      <div className="mx-2 hidden h-4 w-px bg-border sm:block" />
      <span className="hidden truncate text-sm text-muted-foreground sm:block">
        {isVoice
          ? "Live launch coordination"
          : isArchived
            ? "Archived project · channels locked"
            : "Plan, decisions, and launch coordination"}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <div className="mr-2 hidden -space-x-2 lg:flex">
          {[people.mara, people.eli, people.samira, people.owen].map(
            (person) => (
              <PersonAvatar key={person.name} person={person} size="xs" />
            )
          )}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Search channel">
          <HugeiconsIcon
            icon={Search01Icon}
            className="size-4"
            strokeWidth={2}
          />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Channel options">
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            className="size-4"
            strokeWidth={2}
          />
        </Button>
      </div>
    </div>
  )
}

function ProjectFolderScene() {
  return (
    <ChannelCanvas
      composer={<DemoComposer placeholder="Message #launch-brief" />}
    >
      <ChannelStart />
      <SystemEvent>
        <FolderOpenIconGlyph /> Mobile launch project started · archives after
        release
      </SystemEvent>
      <DemoMessage
        person={people.mara}
        time="9:08 AM"
        content="I added engineering, marketing, the launch room, and the release tools to this project."
      />
      <DemoMessage
        person={people.eli}
        time="9:10 AM"
        content="The northstar/mobile repo and Mobile Launch Linear project are scoped here now."
      />
      <DemoMessage
        person={people.samira}
        time="9:12 AM"
        content="Perfect. Campaign assets and the launch brief are in #marketing."
      />
    </ChannelCanvas>
  )
}

function MentionScene({ onSend }: { onSend: () => void }) {
  return (
    <ChannelCanvas composer={<DemoComposer draft onSend={onSend} />}>
      <ChannelStart />
      <DemoMessage
        person={people.samira}
        time="9:12 AM"
        content="The App Store assets are ready. The campaign can move once engineering confirms the final build."
      />
      <DemoMessage
        person={people.eli}
        time="9:18 AM"
        content="Release candidate is in TestFlight. Two QA issues are still open in Linear."
      />
    </ChannelCanvas>
  )
}

function CoworkScene({ approved }: { approved: boolean }) {
  return (
    <ChannelCanvas
      composer={<DemoComposer placeholder="Message #launch-room" />}
    >
      <DemoMessage
        person={people.mara}
        time="9:21 AM"
        content={`<@${MERLIN_ID}> Get the mobile launch ready for Friday. Coordinate engineering and marketing, surface blockers, and ask for approval before changing scope.`}
        mentions={merlinMentions}
      />
      <DemoMessage person={people.merlin} time="9:22 AM" merlin>
        <MerlinMessageBody
          content="I found two open QA blockers and a conflict between the TestFlight freeze and the fixed campaign handoff. I’m comparing release scope now."
          toolCalls={coworkToolCalls}
          reasoningSegments={[]}
          mentions={[]}
          streaming
        />
      </DemoMessage>
      <DemoMessage
        person={people.samira}
        time="9:24 AM"
        content="The campaign date cannot move. Reduce first-release scope if QA needs the time."
        note="Steering Merlin's current answer"
      />
      <DemoMessage
        person={people.eli}
        time="9:25 AM"
        content="Offline mode is the safest item to move without changing the launch story."
      />
      {approved && (
        <DemoMessage
          person={people.mara}
          time="9:26 AM"
          content="Approved — move offline mode to v1.1 and keep Friday's release."
        />
      )}
    </ChannelCanvas>
  )
}

function LoopScene({
  created,
  onCreate,
}: {
  created: boolean
  onCreate: () => void
}) {
  return (
    <ChannelCanvas
      composer={<DemoComposer placeholder="Message #launch-brief" />}
    >
      <DemoMessage
        person={people.mara}
        time="10:04 AM"
        content={`<@${MERLIN_ID}> Check launch blockers every weekday morning across Linear, GitHub, and this project. Post here until the mobile app ships.`}
        mentions={merlinMentions}
      />
      <DemoMessage person={people.merlin} time="10:04 AM" merlin>
        <MessageMarkdown
          content="I can keep this channel updated until the launch outcome is reached."
          mentions={[]}
        />
        <LoopArtifact created={created} onCreate={onCreate} />
      </DemoMessage>
    </ChannelCanvas>
  )
}

function ArchiveScene() {
  return (
    <ChannelCanvas
      composer={
        <div className="shrink-0 px-4 pb-3">
          <div className="flex items-center justify-center rounded-lg border border-input bg-muted/40 px-3 py-3">
            <span className="text-sm text-muted-foreground">
              This project is archived. Its channels are read-only.
            </span>
          </div>
        </div>
      }
    >
      <SystemEvent>
        <Archive03IconGlyph /> Mobile launch archived · 4 channels locked
      </SystemEvent>
      <DemoMessage person={people.merlin} time="4:42 PM" merlin>
        <MessageMarkdown
          content={
            "**Mobile launch shipped on schedule.**\n\nThe team moved offline mode to v1.1 to protect QA time while keeping the fixed campaign handoff. I saved the decision, its rationale, and the supporting project context to company memory."
          }
          mentions={[]}
        />
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 py-1 pr-2.5 pl-2 text-xs text-muted-foreground">
            <HugeiconsIcon
              icon={AiBrain01Icon}
              className="size-3.5 text-primary"
              strokeWidth={2}
            />
            Saved to memory
            <span className="font-mono text-[11px] text-foreground/85">
              /projects/mobile-launch
            </span>
          </span>
        </div>
      </DemoMessage>
    </ChannelCanvas>
  )
}

function ChannelCanvas({
  children,
  composer,
}: {
  children: React.ReactNode
  composer: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-end gap-5 pb-3">
          {children}
        </div>
      </div>
      {composer}
    </div>
  )
}

function ChannelStart() {
  return (
    <div className="px-6 pb-3">
      <div className="flex size-14 items-center justify-center rounded-full bg-accent text-foreground">
        <HugeiconsIcon
          icon={HashtagIcon}
          className="size-7"
          strokeWidth={2.25}
        />
      </div>
      <h2 className="mt-3 text-2xl font-extrabold">
        Welcome to #launch-brief!
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This channel coordinates the Mobile launch project.
      </p>
    </div>
  )
}

function SystemEvent({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 text-[11px] text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <span className="flex items-center gap-1.5">{children}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

function DemoMessage({
  person,
  time,
  content,
  mentions = [],
  note,
  merlin = false,
  children,
}: {
  person: Person
  time: string
  content?: string
  mentions?: Message["mentions"]
  note?: string
  merlin?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="group relative px-4 py-0.5 transition-colors hover:bg-muted/40">
      <div className="flex gap-3">
        <Avatar
          size="lg"
          className={cn(merlin && "border border-merlin/25 bg-merlin/10")}
        >
          <AvatarImage
            src={person.image}
            alt={person.name}
            className={cn(merlin && "object-contain p-2")}
          />
          <AvatarFallback fallbackSeed={person.name} className="font-semibold">
            {person.fallback}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "text-sm font-semibold leading-snug",
                merlin && "text-merlin"
              )}
            >
              {person.name}
            </span>
            <span className="text-xs text-muted-foreground">{time}</span>
          </div>
          {content && <MessageMarkdown content={content} mentions={mentions} />}
          {children}
          {note && (
            <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md bg-merlin/10 px-1.5 py-0.5 text-[11px] text-merlin">
              {note}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function DemoComposer({
  draft = false,
  placeholder,
  onSend,
}: {
  draft?: boolean
  placeholder?: string
  onSend?: () => void
}) {
  return (
    <div className="shrink-0 px-4 pb-3">
      <div className="rounded-lg border border-input bg-muted/40">
        <div className="flex items-center gap-2 px-3 py-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Open attachment menu"
          >
            <HugeiconsIcon
              icon={PlusSignIcon}
              className="size-4"
              strokeWidth={2}
            />
          </Button>
          <div className="relative min-w-0 flex-1 text-sm leading-6 text-foreground/90">
            {draft ? (
              <>
                <span className="rounded bg-primary/15 px-1 py-0.5 font-medium text-primary">
                  @merlin
                </span>{" "}
                Get the mobile launch ready for Friday. Coordinate engineering
                and marketing, surface blockers, and ask for approval before
                changing scope.
                <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
              </>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              "size-7",
              draft
                ? "text-primary hover:text-primary"
                : "text-muted-foreground"
            )}
            onClick={onSend}
            disabled={!draft}
            aria-label="Send message"
          >
            <HugeiconsIcon icon={SentIcon} size={16} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function LoopArtifact({
  created,
  onCreate,
}: {
  created: boolean
  onCreate: () => void
}) {
  return (
    <div className="mt-3 max-w-xl overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <HugeiconsIcon
          icon={RepeatIcon}
          className="size-4 text-primary"
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Morning launch check</p>
          <p className="text-[10px] text-muted-foreground">
            Every weekday at 9:00 AM · until the mobile app ships
          </p>
        </div>
        {created && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-success">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" />
            Active
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Uses</span>
        <span>Linear</span>
        <span>GitHub</span>
        <span>Project channels</span>
        {!created && (
          <Button size="xs" className="ml-auto" onClick={onCreate}>
            Create Loop
          </Button>
        )}
      </div>
    </div>
  )
}

function DemoRightPanel({
  scene,
  approved,
  onApprove,
  loopCreated,
}: {
  scene: number
  approved: boolean
  onApprove: () => void
  loopCreated: boolean
}) {
  const currentScene = sceneMeta.find((item) => item.id === scene)
  if (!currentScene) return null

  return (
    <aside className="hidden h-full w-[300px] shrink-0 overflow-hidden bg-sidebar text-sidebar-foreground md:mb-2 md:mr-2 md:flex md:flex-col md:rounded-b-xl">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 px-4">
        <div className="min-w-0 truncate text-base font-semibold tracking-tight">
          {currentScene.panelTitle}
        </div>
        <button
          type="button"
          aria-label="Collapse side panel"
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          <SidebarToggleIcon
            isOpen
            className="size-4 -scale-x-100"
            strokeWidth={1.5}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {scene === 1 && <ProjectPanel />}
        {scene === 2 && <MembersPanel />}
        {scene === 3 && (
          <VoicePanel approved={approved} onApprove={onApprove} />
        )}
        {scene === 4 && <LoopPanel created={loopCreated} />}
        {scene === 5 && <MemoryPanel />}
      </div>
    </aside>
  )
}

function ProjectPanel() {
  return (
    <div className="divide-y divide-border/70">
      <PanelSection label="Outcome">
        <p>Ship Northstar Mobile by Friday without moving the campaign date.</p>
      </PanelSection>
      <PanelSection label="Project channels">
        <PanelRow icon={HashtagIcon} label="launch-brief" value="Everyone" />
        <PanelRow icon={HashtagIcon} label="engineering" value="6" />
        <PanelRow icon={HashtagIcon} label="marketing" value="4" />
        <PanelRow icon={VolumeHighIcon} label="launch-room" value="Voice" />
      </PanelSection>
      <PanelSection label="Scoped connections">
        <PanelRow
          icon={SourceCodeIcon}
          label="GitHub"
          value="northstar/mobile"
        />
        <PanelRow icon={Tick02Icon} label="Linear" value="Mobile launch" />
        <PanelRow icon={BookOpen01Icon} label="Notion" value="Launch brief" />
      </PanelSection>
      <PanelSection label="Project lifecycle">
        <PanelRow icon={Clock01Icon} label="Archives" value="After launch" />
      </PanelSection>
    </div>
  )
}

function MembersPanel() {
  return (
    <div className="space-y-1 px-3 py-3">
      {[people.mara, people.eli, people.samira, people.owen].map((person) => (
        <MemberRow key={person.name} person={person} status="Online" />
      ))}
      <MemberRow person={people.merlin} status="Ready" />
    </div>
  )
}

function VoicePanel({
  approved,
  onApprove,
}: {
  approved: boolean
  onApprove: () => void
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-1 px-3 py-3">
        <MemberRow person={people.mara} status="Speaking" speaking />
        <MemberRow person={people.eli} status="Listening" />
        <MemberRow person={people.samira} status="Listening" />
        <MemberRow person={people.owen} status="Listening" />
        <MemberRow person={people.merlin} status="Working" working />
      </div>
      <div className="mt-auto border-t border-border/70 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <HugeiconsIcon
            icon={Notification01Icon}
            className="size-4 text-warning"
          />
          Approval required
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Move offline mode to v1.1 so QA can protect Friday’s release.
        </p>
        {approved ? (
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-success">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
            Approved by Mara
          </div>
        ) : (
          <div className="mt-3 flex gap-2">
            <Button size="xs" onClick={onApprove}>
              Approve
            </Button>
            <Button size="xs" variant="outline">
              Redirect
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function LoopPanel({ created }: { created: boolean }) {
  return (
    <div className="divide-y divide-border/70">
      <PanelSection label="Status">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              created ? "bg-success" : "bg-muted-foreground/50"
            )}
          />
          <span className="font-medium text-foreground">
            {created ? "Active" : "Ready to create"}
          </span>
        </div>
      </PanelSection>
      <PanelSection label="Schedule">
        <PanelRow icon={Clock01Icon} label="Runs" value="Weekdays, 9 AM" />
        <PanelRow icon={HashtagIcon} label="Posts in" value="launch-brief" />
      </PanelSection>
      <PanelSection label="Channel access">
        <PanelRow icon={Tick02Icon} label="Linear" value="Inherited" />
        <PanelRow icon={SourceCodeIcon} label="GitHub" value="Inherited" />
        <PanelRow
          icon={FolderOpenIcon}
          label="Project memory"
          value="Inherited"
        />
      </PanelSection>
      <PanelSection label="Stops when">
        <p>Merlin confirms the mobile app has shipped.</p>
      </PanelSection>
    </div>
  )
}

function MemoryPanel() {
  return (
    <div className="divide-y divide-border/70">
      <PanelSection label="Synthesis">
        <div className="flex items-center gap-2 text-success">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />
          <span className="font-medium">Complete</span>
        </div>
      </PanelSection>
      <PanelSection label="Captured">
        <PanelRow icon={Tick02Icon} label="Decisions" value="18" />
        <PanelRow icon={BookOpen01Icon} label="Artifacts" value="11" />
        <PanelRow icon={AiBrain01Icon} label="Memories" value="24" />
      </PanelSection>
      <PanelSection label="Cross-channel connection">
        <p>
          The fixed marketing handoff changed engineering scope. Offline mode
          moved to v1.1 so the launch date could hold.
        </p>
      </PanelSection>
      <PanelSection label="Available to Merlin">
        <p>
          The project is gone from active chat, but its decisions and context
          remain searchable.
        </p>
      </PanelSection>
    </div>
  )
}

function PanelSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="px-4 py-4 text-xs leading-5 text-muted-foreground">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-foreground/55">
        {label}
      </h3>
      {children}
    </section>
  )
}

function PanelRow({
  icon,
  label,
  value,
}: {
  icon: IconSvgElement
  label: string
  value: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 py-1.5">
      <HugeiconsIcon
        icon={icon}
        className="size-3.5 shrink-0"
        strokeWidth={2}
      />
      <span className="text-foreground/85">{label}</span>
      <span className="ml-auto max-w-32 truncate text-right text-[11px]">
        {value}
      </span>
    </div>
  )
}

function MemberRow({
  person,
  status,
  speaking = false,
  working = false,
}: {
  person: Person
  status: string
  speaking?: boolean
  working?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-foreground/[0.04]">
      <PersonAvatar person={person} size="sm" speaking={speaking} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{person.name}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {person.role}
        </p>
      </div>
      <span
        className={cn(
          "text-[11px]",
          speaking
            ? "text-success"
            : working
              ? "text-merlin"
              : "text-muted-foreground"
        )}
      >
        {status}
      </span>
    </div>
  )
}

function DemoControls({
  scene,
  onSceneChange,
  onRecording,
}: {
  scene: number
  onSceneChange: (scene: number) => void
  onRecording: () => void
}) {
  return (
    <div className="fixed bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-popover/95 p-1 shadow-lg backdrop-blur-md">
      <span className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        Concept
      </span>
      {sceneMeta.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSceneChange(item.id)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-xs transition-colors",
            scene === item.id
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {item.id}. {item.label}
        </button>
      ))}
      <Button size="xs" onClick={onRecording} className="ml-1">
        Record
        <HugeiconsIcon icon={ArrowRight01Icon} className="size-3" />
      </Button>
    </div>
  )
}

function FolderOpenIconGlyph() {
  return (
    <HugeiconsIcon icon={FolderOpenIcon} className="size-3.5" strokeWidth={2} />
  )
}

function Archive03IconGlyph() {
  return (
    <HugeiconsIcon icon={Archive03Icon} className="size-3.5" strokeWidth={2} />
  )
}

const PersonAvatar = memo(function PersonAvatar({
  person,
  size,
  speaking = false,
}: {
  person: Person
  size: "xs" | "sm"
  speaking?: boolean
}) {
  return (
    <div className="relative shrink-0">
      {speaking && (
        <motion.span
          animate={{ scale: [1, 1.2, 1], opacity: [0.7, 0, 0.7] }}
          transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY }}
          className="absolute inset-0 rounded-full border-2 border-success"
        />
      )}
      <Avatar
        className={cn(
          size === "xs" ? "size-6" : "size-8",
          speaking && "ring-2 ring-success ring-offset-2 ring-offset-sidebar"
        )}
      >
        <AvatarImage
          src={person.image}
          alt={person.name}
          className={cn(person === people.merlin && "object-contain p-1.5")}
        />
        <AvatarFallback
          fallbackSeed={person.name}
          className="text-[10px] font-semibold"
        >
          {person.fallback}
        </AvatarFallback>
      </Avatar>
      {size === "sm" && !speaking && (
        <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-sidebar bg-emerald-500" />
      )}
    </div>
  )
})
