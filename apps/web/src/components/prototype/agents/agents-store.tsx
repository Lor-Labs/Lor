import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  me,
  mentionedPeople,
  type Person,
  titleFromPrompt,
} from "../prototype-data"
import {
  agentById,
  agents,
  type Block,
  type Draft,
  initialDrafts,
  initialThreads,
  initialTranscripts,
  initialWorks,
  leads,
  linearIssues,
  type Room,
  type RoomLevel,
  roomName,
  type Starter,
  type Thread,
  type ThreadItem,
  type Work,
  type WorkState,
} from "./agents-data"

export type WorkTab = "chat" | "changes" | "preview"

// The panel beside the chat. Its shape follows the work: a diff and a running
// app for code, an editor for a draft, a chart for numbers.
export type Canvas =
  | { kind: "work"; workId: string; tab?: WorkTab }
  | { kind: "draft"; draftId: string }
  | { kind: "chart"; chartId: string }
  | { kind: "setup"; agentId: string }
  | { kind: "log"; agentId: string }

export type AgentTab = "work" | "room"
export type SidebarTab = "work" | "agents"

export type View =
  | { kind: "thread"; threadId: string }
  | { kind: "code"; workId: string }
  | { kind: "agent"; agentId: string; tab: AgentTab }
  | { kind: "new"; agentId: string }

// A message in Lor's own chat for a channel. People only: mentioning Lor
// starts a thread, linked under the message.
export type RoomMessage = {
  id: string
  author: Person
  text: string
  threadId?: string
}

type Store = {
  view: View
  sidebarTab: SidebarTab
  canvas: Canvas | null
  works: Record<string, Work>
  drafts: Record<string, Draft>
  threads: Thread[]
  transcripts: Record<string, ThreadItem[]>
  pins: Record<string, string[]>
  configured: Record<string, boolean>
  rooms: Record<string, Room | null>
  roomLevel: Record<string, RoomLevel>
  roomChat: Record<string, RoomMessage[]>
  stateOf: (threadId: string) => WorkState
  childrenOf: (threadId: string) => Work[]
  setSidebarTab: (tab: SidebarTab) => void
  openThread: (threadId: string) => void
  openWork: (workId: string) => void
  openAgent: (agentId: string, tab?: AgentTab) => void
  openNew: (agentId?: string) => void
  openCanvas: (canvas: Canvas) => void
  closeCanvas: () => void
  approve: (workId: string) => void
  sendDraft: (draftId: string) => void
  editDraft: (draftId: string, body: string) => void
  reply: (workId: string, text: string) => void
  send: (threadId: string, text: string) => void
  // Talk to the channel's agent. It decides what to start.
  ask: (agentId: string, text: string) => void
  // A code session a person starts directly, in a repo they pick.
  startCode: (agentId: string, text: string, repo: string) => void
  draftOutreach: (threadId: string, leadIds: string[]) => void
  approveSetup: (agentId: string, threadId: string) => void
  togglePin: (agentId: string, chartId: string) => void
  connectRoom: (agentId: string, room: Room) => void
  disconnectRoom: (agentId: string) => void
  setRoomLevel: (agentId: string, level: RoomLevel) => void
  postRoom: (agentId: string, text: string) => void
}

const StoreContext = createContext<Store | null>(null)

export function useProto() {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useProto needs AgentsStore")
  return store
}

// The thread a card is shown in.
const ThreadContext = createContext<string | null>(null)
export const ThreadProvider = ThreadContext.Provider
export function useThreadId() {
  return useContext(ThreadContext)
}

const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((item) => [item.id, item]))

const uid = () => crypto.randomUUID()

export function AgentsStore({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({
    kind: "agent",
    agentId: "eng",
    tab: "work",
  })
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("work")
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [works, setWorks] = useState<Record<string, Work>>(() =>
    byId(initialWorks)
  )
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    byId(initialDrafts)
  )
  const [threads, setThreads] = useState(initialThreads)
  const [transcripts, setTranscripts] = useState(initialTranscripts)
  const [pins, setPins] = useState<Record<string, string[]>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      agents.map((agent) => [agent.id, agent.watching.length > 0])
    )
  )
  const [rooms, setRooms] = useState<Record<string, Room | null>>(() =>
    Object.fromEntries(agents.map((agent) => [agent.id, agent.room ?? null]))
  )
  const [roomLevel, setRoomLevels] = useState<Record<string, RoomLevel>>({})
  const [roomChat, setRoomChat] = useState<Record<string, RoomMessage[]>>({})
  const timers = useRef<number[]>([])

  useEffect(() => {
    const scheduled = timers.current
    return () => {
      for (const timer of scheduled) window.clearTimeout(timer)
    }
  }, [])

  const later = (callback: () => void, ms: number) => {
    timers.current.push(window.setTimeout(callback, ms))
  }

  const patchWork = (workId: string, patch: Partial<Work>) =>
    setWorks((prev) => {
      const work = prev[workId]
      return work ? { ...prev, [workId]: { ...work, ...patch } } : prev
    })

  const post = (threadId: string, ...items: ThreadItem[]) =>
    setTranscripts((prev) => ({
      ...prev,
      [threadId]: [...(prev[threadId] ?? []), ...items],
    }))

  const say = (threadId: string, text: string, blocks?: Block[]) =>
    post(threadId, { id: uid(), kind: "agent", time: "now", text, blocks })

  const settle = (
    threadId: string,
    itemId: string,
    text: string,
    blocks?: Block[]
  ) =>
    setTranscripts((prev) => ({
      ...prev,
      [threadId]: (prev[threadId] ?? []).map((item) =>
        item.id === itemId && item.kind === "agent"
          ? { ...item, pending: false, text, blocks }
          : item
      ),
    }))

  const retitle = (threadId: string, title: string) =>
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId ? { ...thread, title } : thread
      )
    )

  const childrenOf = (threadId: string) =>
    Object.values(works).filter((work) => work.parentId === threadId)

  // A thread shows the strongest state of what runs under it.
  const stateOf = (threadId: string): WorkState => {
    const kids = childrenOf(threadId)
    const waiting =
      kids.some((work) => work.state === "needs_you") ||
      Object.values(drafts).some(
        (draft) => draft.threadId === threadId && !draft.sent
      )
    if (waiting) return "needs_you"
    const busy =
      kids.some((work) => work.state === "running") ||
      (transcripts[threadId] ?? []).some(
        (item) => item.kind === "agent" && item.pending
      )
    return busy ? "running" : "done"
  }

  // The agent picks the repos and starts one code session per issue, then
  // reports back in the chat as each one finishes.
  const startLinearIssues = (thread: Thread, itemId: string) => {
    const started: Work[] = linearIssues.map((issue) => ({
      id: uid(),
      agentId: thread.agentId,
      parentId: thread.id,
      repo: issue.repo,
      branch: issue.branch,
      owner: me,
      title: `${issue.key} ${issue.title}`,
      mode: "code",
      state: "running",
      steps: issue.steps,
      replies: [],
    }))
    setWorks((prev) => ({ ...prev, ...byId(started) }))
    retitle(thread.id, "My Linear issues")
    settle(
      thread.id,
      itemId,
      "You have four open issues. Three are ready to start, so I started a session for each: two in api and one in web. LOR-177 needs a decision from you first: should exports include archived projects?",
      [
        {
          kind: "group",
          title: "Your Linear issues",
          workIds: started.map((work) => work.id),
        },
      ]
    )
    const [csv, empty] = started
    if (!csv || !empty) return
    later(() => {
      patchWork(csv.id, {
        state: "needs_you",
        facts: "2 files · +18 −3 · app runs",
        ask: "Open a draft pull request",
        app: true,
        summary:
          "The header row was written after the first flush, so any export larger than one batch lost it. The header is now written before the stream starts, and the export matches the fixture.",
      })
      say(
        thread.id,
        "LOR-173 is ready. The header row is back and the export matches the fixture. Approve it and I'll open the pull request.",
        [{ kind: "work", workId: csv.id }]
      )
    }, 9000)
    later(() => {
      patchWork(empty.id, {
        state: "done",
        facts: "2 files · +41 −2",
        result: "Ready to look at",
        app: true,
        summary:
          "A workspace with no invoices showed a blank table. It now shows the empty state from the design system with a link to create the first invoice.",
      })
      say(
        thread.id,
        "LOR-171 is ready to look at. LOR-175 is still running: the retry queue needs a migration, so it will take longer."
      )
    }, 16000)
  }

  // One piece of work that touches two repos: two code sessions under the
  // same thread. A thread is not tied to a repo, so it can grow this way.
  const startAcrossRepos = (thread: Thread, itemId: string) => {
    const started: Work[] = [
      { repo: "api", part: "export job" },
      { repo: "web", part: "project picker" },
    ].map(({ repo, part }) => ({
      id: uid(),
      agentId: thread.agentId,
      parentId: thread.id,
      repo,
      branch: `lor/lor-177-archived-${repo}`,
      owner: me,
      title: `LOR-177 Archived projects: ${part}`,
      mode: "code",
      state: "running",
      steps: [
        `Read the ${part}`,
        "Added archived projects behind the existing filter",
        "Running the app to check both sides agree",
      ],
      replies: [],
    }))
    setWorks((prev) => ({ ...prev, ...byId(started) }))
    settle(
      thread.id,
      itemId,
      "Then LOR-177 can start. It touches the export job in api and the project picker in web, so I started a session in each. I'll check them against each other before I ask you to look.",
      [
        {
          kind: "group",
          title: "LOR-177 Export archived projects",
          workIds: started.map((work) => work.id),
        },
      ]
    )
    later(() => {
      for (const work of started) {
        patchWork(work.id, {
          state: "done",
          facts: "2 files · +27 −4",
          result: "Ready to look at",
          app: true,
        })
      }
      say(
        thread.id,
        "Both sides of LOR-177 are ready and agree with each other: an archived project now shows in the picker and comes out in the export."
      )
    }, 9000)
  }

  // A plain conversation turns into code when the work calls for it. The
  // agent picks the repo: the one named in the message, or its first.
  const startOne = (
    thread: Thread,
    itemId: string,
    text: string,
    repos: string[]
  ) => {
    const lower = text.toLowerCase()
    const repo = repos.find((name) => lower.includes(name)) ?? repos[0]
    const work: Work = {
      id: uid(),
      agentId: thread.agentId,
      parentId: thread.id,
      repo,
      branch: "lor/from-thread",
      owner: me,
      title: titleFromPrompt(text),
      mode: "code",
      state: "running",
      steps: [
        "Reading the code around this",
        "Making the change on a branch",
        "Running the app to check it",
      ],
      replies: [],
    }
    setWorks((prev) => ({ ...prev, [work.id]: work }))
    settle(
      thread.id,
      itemId,
      `That needs a code change, so I started a session in ${repo}.`,
      [{ kind: "work", workId: work.id }]
    )
    later(() => {
      patchWork(work.id, {
        state: "done",
        facts: "3 files · +48 −9",
        result: "Ready to look at",
        app: true,
        summary:
          "Done on a branch. I ran the app and checked it in the browser. Open Preview to see it, or reply to change it.",
      })
      say(
        thread.id,
        "It's ready to look at. Reply here if you want it changed."
      )
    }, 8000)
  }

  const answer = (thread: Thread, itemId: string, text: string) => {
    const lower = text.toLowerCase()
    const agent = agentById(thread.agentId)
    if (!configured[thread.agentId]) {
      settle(
        thread.id,
        itemId,
        "Here is what I would set up. Approve it and I start watching.",
        [{ kind: "proposal" }]
      )
      return
    }
    if (/linear|issues/.test(lower) && agent && agent.repos.length > 0) {
      startLinearIssues(thread, itemId)
      return
    }
    if (/lor-177|archived/.test(lower) && agent && agent.repos.length > 0) {
      startAcrossRepos(thread, itemId)
      return
    }
    if (/error|trend|chart|graph/.test(lower)) {
      settle(
        thread.id,
        itemId,
        "Errors are down by a third. Thursday's spike is the checkout bug I'm working on.",
        [{ kind: "chart", chartId: "errors-week" }]
      )
      return
    }
    if (/signed up|signup|sign up|leads/.test(lower)) {
      settle(
        thread.id,
        itemId,
        "14 teams signed up last week. These five look worth a call.",
        [{ kind: "leads" }]
      )
      return
    }
    if (
      /\b(fix|add|change|implement|build|upgrade|make)\b/.test(lower) &&
      agent &&
      agent.repos.length > 0
    ) {
      startOne(thread, itemId, text, agent.repos)
      return
    }
    // Anything else it works out on its own computer, with no repo involved.
    const work: Work = {
      id: uid(),
      agentId: thread.agentId,
      parentId: thread.id,
      owner: me,
      title: titleFromPrompt(text),
      mode: "chat",
      state: "running",
      steps: [
        "Searching what the team already knows",
        "Reading the related work",
        "Writing up what I found",
      ],
      summary:
        "I checked team memory, the related pull requests and the last three threads on this. Reply here to steer it.",
      replies: [],
    }
    setWorks((prev) => ({ ...prev, [work.id]: work }))
    settle(thread.id, itemId, "On it.", [{ kind: "work", workId: work.id }])
    later(() => {
      patchWork(work.id, { state: "done", result: "Written up" })
      say(
        thread.id,
        "Done. I wrote up what I found. Open it to read the details or reply to steer it."
      )
    }, 6200)
  }

  const createThread = (agentId: string, text: string, starter: Starter) => {
    const thread: Thread = {
      id: uid(),
      agentId,
      title: titleFromPrompt(text),
      starter,
      owner: me,
      people: [me],
      time: "now",
    }
    const itemId = uid()
    setThreads((prev) => [thread, ...prev])
    setTranscripts((prev) => ({
      ...prev,
      [thread.id]: [
        { id: uid(), kind: "person", author: me, time: "now", text },
        { id: itemId, kind: "agent", time: "now", pending: true },
      ],
    }))
    later(() => answer(thread, itemId, text), 1100)
    return thread
  }

  const store: Store = {
    view,
    sidebarTab,
    canvas,
    works,
    drafts,
    threads,
    transcripts,
    pins,
    configured,
    rooms,
    roomLevel,
    roomChat,
    stateOf,
    childrenOf,
    setSidebarTab,
    openThread: (threadId) => {
      setView({ kind: "thread", threadId })
      setCanvas(null)
    },
    // A code session opens beside the chat that started it, or on its own
    // when a person started it directly.
    openWork: (workId) => {
      const work = works[workId]
      if (!work) return
      if (work.parentId) {
        setView({ kind: "thread", threadId: work.parentId })
        setCanvas({ kind: "work", workId })
        return
      }
      setView({ kind: "code", workId })
      setCanvas(null)
    },
    openAgent: (agentId, tab = "work") => {
      setView({ kind: "agent", agentId, tab })
      setCanvas(null)
    },
    openNew: (agentId) => {
      const current =
        view.kind === "agent" || view.kind === "new" ? view.agentId : "eng"
      setView({ kind: "new", agentId: agentId ?? current })
      setCanvas(null)
    },
    openCanvas: setCanvas,
    closeCanvas: () => setCanvas(null),
    approve: (workId) => {
      const work = works[workId]
      if (!work) return
      patchWork(workId, { state: "running", doing: "Opening the pull request" })
      later(() => {
        patchWork(workId, {
          state: "done",
          doing: undefined,
          result: "Draft pull request #418 is open",
        })
        if (work.parentId) {
          say(work.parentId, "Opened #418 and asked Eli to review it.")
        }
      }, 1700)
    },
    sendDraft: (draftId) => {
      const draft = drafts[draftId]
      if (!draft) return
      setDrafts((prev) => ({ ...prev, [draftId]: { ...draft, sent: true } }))
      later(
        () => say(draft.threadId, "Sent. I'll tell you here if Dana replies."),
        900
      )
    },
    editDraft: (draftId, body) =>
      setDrafts((prev) => {
        const draft = prev[draftId]
        return draft ? { ...prev, [draftId]: { ...draft, body } } : prev
      }),
    reply: (workId, text) => {
      const work = works[workId]
      if (!work) return
      const add = (author: Person | null, body: string) =>
        setWorks((prev) => {
          const current = prev[workId]
          if (!current) return prev
          const replies = [
            ...current.replies,
            { id: uid(), author, text: body },
          ]
          return { ...prev, [workId]: { ...current, replies } }
        })
      add(me, text)
      // A mention talks to a person. Anything else steers Lor in this thread.
      if (mentionedPeople(text).length > 0) return
      // Lor knows whose call this is: the owner steers, others suggest.
      const owner = work.owner.name.split(" ")[0]
      const response =
        work.owner.id !== me.id
          ? `Noted as a suggestion. ${owner} owns this one, so I've asked ${owner} before I change course.`
          : work.mode === "code"
            ? "Got it. I'll update the branch and tell you here when it's ready to look at again."
            : "Understood. I'll add that and update what I wrote."
      later(() => add(null, response), 1600)
    },
    send: (threadId, text) => {
      const thread = threads.find((item) => item.id === threadId)
      if (!thread) return
      const itemId = uid()
      post(
        threadId,
        { id: uid(), kind: "person", author: me, time: "now", text },
        { id: itemId, kind: "agent", time: "now", pending: true }
      )
      later(() => answer(thread, itemId, text), 1100)
    },
    ask: (agentId, text) => {
      setCanvas(null)
      setSidebarTab("work")
      const thread = createThread(agentId, text, {
        kind: "person",
        person: me,
      })
      setView({ kind: "thread", threadId: thread.id })
    },
    // No agent above it: straight to one coding agent in one repo.
    startCode: (agentId, text, repo) => {
      setCanvas(null)
      setSidebarTab("work")
      const title = titleFromPrompt(text)
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
      const work: Work = {
        id: uid(),
        agentId,
        repo,
        branch: `lor/${slug.slice(0, 24)}`,
        owner: me,
        title,
        mode: "code",
        state: "running",
        steps: [
          "Reading the code around this",
          "Making the change on a branch",
          "Running the app to check it",
        ],
        prompt: text,
        replies: [],
      }
      setWorks((prev) => ({ ...prev, [work.id]: work }))
      setView({ kind: "code", workId: work.id })
      later(
        () =>
          patchWork(work.id, {
            state: "done",
            facts: "3 files · +48 −9",
            result: "Ready for review",
            app: true,
            summary:
              "Done on a branch. I ran the app and checked it in the browser. Open Preview to see it, or reply to change it.",
          }),
        8000
      )
    },
    draftOutreach: (threadId, leadIds) => {
      const thread = threads.find((item) => item.id === threadId)
      if (!thread) return
      const names = leads
        .filter((lead) => leadIds.includes(lead.id))
        .map((lead) => lead.company)
      const work: Work = {
        id: uid(),
        agentId: thread.agentId,
        parentId: threadId,
        owner: me,
        title: `Outreach for ${names.length} teams`,
        mode: "chat",
        state: "running",
        steps: [
          "Reading each account in Attio",
          "Checking what they looked at",
          "Writing the drafts",
        ],
        summary: names
          .map(
            (name) =>
              `**${name}**\n\nHi, I saw your team started with Northstar last week. Happy to walk you through setup for a team your size. Does Thursday work?`
          )
          .join("\n\n"),
        replies: [],
      }
      const list =
        names.length > 1
          ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
          : (names[0] ?? "them")
      setWorks((prev) => ({ ...prev, [work.id]: work }))
      say(threadId, `Drafting for ${list}.`, [
        { kind: "work", workId: work.id },
      ])
      later(() => {
        patchWork(work.id, {
          state: "done",
          result: `${names.length} drafts ready`,
        })
        say(
          threadId,
          "The drafts are ready. Nothing goes out until you approve each one."
        )
      }, 5200)
    },
    approveSetup: (agentId, threadId) => {
      setConfigured((prev) => ({ ...prev, [agentId]: true }))
      later(
        () =>
          say(
            threadId,
            "Set up. I'm watching Figma now and will start a thread when something needs you."
          ),
        700
      )
    },
    togglePin: (agentId, chartId) =>
      setPins((prev) => {
        const current = prev[agentId] ?? []
        return {
          ...prev,
          [agentId]: current.includes(chartId)
            ? current.filter((id) => id !== chartId)
            : [...current, chartId],
        }
      }),
    connectRoom: (agentId, room) =>
      setRooms((prev) => ({ ...prev, [agentId]: room })),
    disconnectRoom: (agentId) =>
      setRooms((prev) => ({ ...prev, [agentId]: null })),
    setRoomLevel: (agentId, level) =>
      setRoomLevels((prev) => ({ ...prev, [agentId]: level })),
    postRoom: (agentId, text) => {
      const agent = agentById(agentId)
      const room = rooms[agentId]
      if (!agent || !room) return
      // People talk to people here. Mentioning Lor hands it the message, and
      // it answers in a thread linked under that message.
      const thread = /@lor\b/i.test(text)
        ? createThread(agentId, text.replace(/@lor\b/gi, "").trim(), {
            kind: "room",
            person: me,
            room: roomName(room, agent),
          })
        : undefined
      setRoomChat((prev) => ({
        ...prev,
        [agentId]: [
          ...(prev[agentId] ?? []),
          { id: uid(), author: me, text, threadId: thread?.id },
        ],
      }))
    },
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
