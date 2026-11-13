import type { ReactNode } from "react"
import { useState } from "react"
import type { SessionBrowserAnnotations } from "@/components/sidebar/right-panel/session-browser-annotations"
import {
  BrowserPresence,
  SessionBrowserFooter,
  type SessionBrowserLive,
} from "@/components/sidebar/right-panel/session-browser-live-view"
import { ShareMenu } from "@/components/sidebar/right-panel/session-browser-panel"
import {
  RunControl,
  type RunSummary,
  type Service,
  type SessionRun,
  serviceHealth,
} from "@/components/sidebar/right-panel/session-browser-run"

// /design: the Browser tab's toolbar and footer in each state. The live view
// itself needs a sandbox, so a grey box stands in for it.

const service = (name: string, port: number, patch: Partial<Service>) => ({
  name,
  command: `pnpm --filter ${name} dev`,
  port,
  default: true,
  state: "running" as const,
  log: null,
  installing: false,
  upMs: null,
  quietMs: null,
  otherPorts: [],
  portHeld: false,
  ...patch,
})

const VITE_LOG = `$ pnpm --filter web dev
> web@0.1.0 dev
> vite --port 3000

  VITE v6.3.5  ready in 812 ms
  ➜  Local:   http://localhost:3000/`

const CRASH_LOG = `$ pnpm --filter @repo/api dev
> tsx watch src/index.ts

Error: Cannot find module '@repo/api-client/dist/index.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1401:15)
[tsx] waiting for file changes before restarting...`

const RUNS: { label: string; summary: RunSummary; services: Service[] }[] = [
  {
    label: "Running",
    summary: "running",
    services: [
      service("web", 3000, { log: VITE_LOG }),
      service("api", 8787, {}),
      service("www", 3001, { default: false, state: "stopped" }),
    ],
  },
  {
    label: "Stopped",
    summary: "stopped",
    services: [
      service("web", 3000, { state: "stopped" }),
      service("api", 8787, { state: "stopped" }),
    ],
  },
  {
    label: "Starting (installing first)",
    summary: "starting",
    services: [
      service("web", 3000, {
        state: "starting",
        installing: true,
        upMs: 14_000,
        quietMs: 800,
        log: "$ pnpm install --frozen-lockfile\nProgress: resolved 1840, reused 1811, downloaded 12, added 96",
      }),
      service("api", 8787, {
        state: "starting",
        upMs: 14_000,
        quietMs: 2_000,
        log: "Waiting for another service's install to finish",
        installing: true,
      }),
    ],
  },
  {
    label: "A service never listened (watch mode kept it alive)",
    summary: "trouble",
    services: [
      service("web", 3000, { log: VITE_LOG }),
      service("api", 8787, {
        state: "starting",
        upMs: 95_000,
        quietMs: 61_000,
        log: CRASH_LOG,
      }),
    ],
  },
  { label: "No run setup yet", summary: "none", services: [] },
]

function sampleRun(
  summary: RunSummary,
  services: Service[],
  menuOpen: boolean,
  setMenuOpen: SessionRun["setMenuOpen"]
): SessionRun {
  const down = services.filter(
    (entry) => entry.default && entry.state !== "running"
  )
  const noop = () => {}
  return {
    available: true,
    noSandbox: false,
    failed: null,
    loading: false,
    fetching: false,
    ports: [],
    otherPorts: summary === "running" ? [{ port: 5555, process: "node" }] : [],
    services,
    setupError: null,
    summary,
    troubled: services.filter((entry) =>
      ["stuck", "wrong-port", "exited"].includes(serviceHealth(entry))
    ),
    canStartApp: down.length > 0,
    starting: summary === "starting",
    startApp: noop,
    start: noop,
    restart: noop,
    stop: noop,
    stopAll: noop,
    acting: () => false,
    refresh: noop,
    menuOpen,
    setMenuOpen,
  }
}

const PEOPLE = [
  { userId: "1", name: "Jacob", color: "#3e63dd", role: "control" as const },
  { userId: "2", name: "Roy", color: "#30a46c", role: "watch" as const },
  { userId: "3", name: "Sam", color: "#f76b15", role: "watch" as const },
]

function Toolbar({
  label,
  summary,
  services,
}: {
  label: string
  summary: RunSummary
  services: Service[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sample label={label}>
      <div className="flex items-center gap-2 border-border/70 border-b px-2 py-1.5">
        <RunControl
          run={sampleRun(summary, services, open, setOpen)}
          onOpen={() => {}}
          onAskLor={() => {}}
          onOpenTerminal={() => {}}
        />
        <span className="flex-1" />
        <BrowserPresence people={PEOPLE} myId="1" />
        <ShareMenu
          app={summary === "running" ? "localhost:3000/settings" : null}
          preview={{
            link:
              summary === "running"
                ? {
                    token: "sample",
                    access: "private",
                    expiresAt: new Date(
                      Date.now() + 6 * 86_400_000
                    ).toISOString(),
                  }
                : null,
            loading: false,
            failed: false,
            retry: () => {},
            create: () => {},
            copy: () => {},
            setPublic: () => {},
            turnOff: () => {},
          }}
          onOpenApp={() => {}}
          onCopyApp={() => {}}
        />
      </div>
    </Sample>
  )
}

const live = (patch: Partial<SessionBrowserLive>) =>
  ({
    expanded: false,
    slowSwitch: false,
    youControl: false,
    otherControls: false,
    lorWants: false,
    handBackIn: null,
    controller: null,
    lorStep: null,
    switching: false,
    unavailable: false,
    everConnected: true,
    connected: true,
    keep: () => {},
    handBack: () => {},
    takeControl: () => {},
    canControl: true,
    ...patch,
  }) as SessionBrowserLive

const notes = (
  patch: Partial<SessionBrowserAnnotations>
): SessionBrowserAnnotations => ({
  shared: true,
  count: 0,
  mine: 0,
  phase: "off",
  sending: false,
  start: () => {},
  done: () => {},
  discard: () => {},
  send: () => {},
  ...patch,
})

const FOOTERS: {
  label: string
  live: SessionBrowserLive
  annotations: SessionBrowserAnnotations
}[] = [
  {
    label: "Lor is working",
    live: live({ lorStep: { text: "Clicked Sign in", running: true } }),
    annotations: notes({}),
  },
  {
    label: "You have control",
    live: live({
      youControl: true,
      controller: { userId: "1", name: "Jacob" },
    }),
    annotations: notes({}),
  },
  {
    label: "Annotating",
    live: live({}),
    annotations: notes({ phase: "picking" }),
  },
  {
    label: "Notes from several people, ready to send",
    live: live({
      controller: { userId: "2", name: "Roy" },
      otherControls: true,
    }),
    annotations: notes({ count: 4, mine: 1 }),
  },
]

export function SessionBrowserSamples() {
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className="space-y-6">
        {RUNS.map((run) => (
          <Toolbar key={run.label} {...run} />
        ))}
      </div>
      <div className="space-y-6">
        {FOOTERS.map((footer) => (
          <Sample key={footer.label} label={footer.label}>
            <div className="space-y-2.5 p-3">
              <div className="h-16 rounded-lg border border-border/70 bg-muted/40" />
              <SessionBrowserFooter
                live={footer.live}
                annotations={footer.annotations}
              />
            </div>
          </Sample>
        ))}
      </div>
    </div>
  )
}

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-muted-foreground text-xs">{label}</p>
      <div className="overflow-hidden rounded-xl border border-border/70">
        {children}
      </div>
    </div>
  )
}
