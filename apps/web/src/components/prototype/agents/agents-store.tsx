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
  people,
  titleFromPrompt,
} from "../prototype-data"
import {
  agentById,
  agents,
  type Block,
  type ChannelMessage,
  type Chat,
  type ChatItem,
  channels,
  type Draft,
  initialChannelChat,
  initialChats,
  initialDrafts,
  initialTranscripts,
  initialWorks,
  leads,
  linearIssues,
  type Starter,
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
  | { kind: "log"; agentId: string }

export type AgentTab = "chats" | "settings"

export type View =
  | { kind: "chat"; chatId: string }
  | { kind: "code"; workId: string }
  | { kind: "agent"; agentId: string; tab: AgentTab }
  | { kind: "channel"; channelId: string }
  // A new chat with an agent, or a code session straight in one repo.
  | { kind: "new"; agentId: string }
  | { kind: "newCode"; agentId: string }

type Store = {
  view: View
  canvas: Canvas | null
  works: Record<string, Work>
  drafts: Record<string, Draft>
  chats: Chat[]
  transcripts: Record<string, ChatItem[]>
  pins: Record<string, string[]>
  configured: Record<string, boolean>
  // Which agent is in each channel, if any.
  channelAgents: Record<string, string | null>
  channelChat: Record<string, ChannelMessage[]>
  stateOf: (chatId: string) => WorkState
  childrenOf: (chatId: string) => Work[]
  openChat: (chatId: string) => void
  openWork: (workId: string) => void
  openAgent: (agentId: string, tab?: AgentTab) => void
  openChannel: (channelId: string) => void
  openNew: (agentId?: string) => void
  openNewCode: (agentId?: string) => void
  openCanvas: (canvas: Canvas) => void
  closeCanvas: () => void
  approve: (workId: string) => void
  sendDraft: (draftId: string) => void
  editDraft: (draftId: string, body: string) => void
  reply: (workId: string, text: string) => void
  send: (chatId: string, text: string) => void
  // Put one more teammate in a chat, so it shows in their sidebar.
  addPerson: (chatId: string) => void
  // Start a chat with an agent. It decides what to start.
  ask: (agentId: string, text: string) => void
  // A code session a person starts directly, in a repo they pick.
  startCode: (agentId: string, text: string, repo: string) => void
  draftOutreach: (chatId: string, leadIds: string[]) => void
  approveSetup: (agentId: string, chatId: string) => void
  togglePin: (agentId: string, chartId: string) => void
  setChannelAgent: (channelId: string, agentId: string | null) => void
  postChannel: (channelId: string, text: string) => void
}

const StoreContext = createContext<Store | null>(null)

export function useProto() {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useProto needs AgentsStore")
  return store
}

// The chat a card is shown in.
const ChatContext = createContext<string | null>(null)
export const ChatProvider = ChatContext.Provider
export function useChatId() {
  return useContext(ChatContext)
}

const byId = <T extends { id: string }>(items: T[]) =>
  Object.fromEntries(items.map((item) => [item.id, item]))

const uid = () => crypto.randomUUID()

// What turns a mention in a channel into work, and so into a chat.
const WORK =
  /\b(fix|add|change|implement|build|upgrade|make|look into|investigate|linear|issues|set up|draft|write)\b/i

export function AgentsStore({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({ kind: "channel", channelId: "eng" })
  const [canvas, setCanvas] = useState<Canvas | null>(null)
  const [works, setWorks] = useState<Record<string, Work>>(() =>
    byId(initialWorks)
  )
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    byId(initialDrafts)
  )
  const [chats, setChats] = useState(initialChats)
  const [transcripts, setTranscripts] = useState(initialTranscripts)
  const [pins, setPins] = useState<Record<string, string[]>>({})
  const [configured, setConfigured] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      agents.map((agent) => [agent.id, agent.watching.length > 0])
    )
  )
  const [channelAgents, setChannelAgents] = useState<
    Record<string, string | null>
  >(() =>
    Object.fromEntries(
      channels.map((channel) => [channel.id, channel.agentId ?? null])
    )
  )
  const [channelChat, setChannelChat] = useState(initialChannelChat)
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

  const post = (chatId: string, ...items: ChatItem[]) =>
    setTranscripts((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] ?? []), ...items],
    }))

  const say = (chatId: string, text: string, blocks?: Block[]) =>
    post(chatId, { id: uid(), kind: "agent", time: "now", text, blocks })

  const settle = (
    chatId: string,
    itemId: string,
    text: string,
    blocks?: Block[]
  ) =>
    setTranscripts((prev) => ({
      ...prev,
      [chatId]: (prev[chatId] ?? []).map((item) =>
        item.id === itemId && item.kind === "agent"
          ? { ...item, pending: false, text, blocks }
          : item
      ),
    }))

  const retitle = (chatId: string, title: string) =>
    setChats((prev) =>
      prev.map((chat) => (chat.id === chatId ? { ...chat, title } : chat))
    )

  const childrenOf = (chatId: string) =>
    Object.values(works).filter((work) => work.parentId === chatId)

  // A chat shows the strongest state of what runs under it.
  const stateOf = (chatId: string): WorkState => {
    const kids = childrenOf(chatId)
    const waiting =
      kids.some((work) => work.state === "needs_you") ||
      Object.values(drafts).some(
        (draft) => draft.chatId === chatId && !draft.sent
      )
    if (waiting) return "needs_you"
    const busy =
      kids.some((work) => work.state === "running") ||
      (transcripts[chatId] ?? []).some(
        (item) => item.kind === "agent" && item.pending
      )
    return busy ? "running" : "done"
  }

  // The agent picks the repos and starts one code session per issue, then
  // reports back in the chat as each one finishes.
  const startLinearIssues = (chat: Chat, itemId: string) => {
    const started: Work[] = linearIssues.map((issue) => ({
      id: uid(),
      agentId: chat.agentId,
      parentId: chat.id,
      repo: issue.repo,
      branch: issue.branch,
      asker: me,
      title: `${issue.key} ${issue.title}`,
      mode: "code",
      state: "running",
      steps: issue.steps,
      replies: [],
    }))
    setWorks((prev) => ({ ...prev, ...byId(started) }))
    retitle(chat.id, "My Linear issues")
    settle(
      chat.id,
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
        chat.id,
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
        chat.id,
        "LOR-171 is ready to look at. LOR-175 is still running: the retry queue needs a migration, so it will take longer."
      )
    }, 16000)
  }

  // One piece of work that touches two repos: two code sessions under the
  // same chat. A chat is not tied to a repo, so it can grow this way.
  const startAcrossRepos = (chat: Chat, itemId: string) => {
    const started: Work[] = [
      { repo: "api", part: "export job" },
      { repo: "web", part: "project picker" },
    ].map(({ repo, part }) => ({
      id: uid(),
      agentId: chat.agentId,
      parentId: chat.id,
      repo,
      branch: `lor/lor-177-archived-${repo}`,
      asker: me,
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
      chat.id,
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
        chat.id,
        "Both sides of LOR-177 are ready and agree with each other: an archived project now shows in the picker and comes out in the export."
      )
    }, 9000)
  }

  // A plain conversation turns into code when the work calls for it. The
  // agent picks the repo: the one named in the message, or its first.
  const startOne = (
    chat: Chat,
    itemId: string,
    text: string,
    repos: string[]
  ) => {
    const tokens = new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9._/-]+/)
        .map((token) => token.replace(/\.+$/, ""))
    )
    const repo =
      repos.find((name) => tokens.has(name.toLowerCase())) ?? repos[0]
    const work: Work = {
      id: uid(),
      agentId: chat.agentId,
      parentId: chat.id,
      repo,
      branch: "lor/from-chat",
      asker: me,
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
      chat.id,
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
      say(chat.id, "It's ready to look at. Reply here if you want it changed.")
    }, 8000)
  }

  const answer = (chat: Chat, itemId: string, text: string) => {
    const lower = text.toLowerCase()
    const agent = agentById(chat.agentId)
    if (!configured[chat.agentId]) {
      settle(
        chat.id,
        itemId,
        "Here is what I would set up. Approve it and I start watching.",
        [{ kind: "proposal" }]
      )
      return
    }
    if (/linear|issues/.test(lower) && agent && agent.repos.length > 0) {
      startLinearIssues(chat, itemId)
      return
    }
    if (/lor-177|archived/.test(lower) && agent && agent.repos.length > 0) {
      startAcrossRepos(chat, itemId)
      return
    }
    if (/error|trend|chart|graph/.test(lower)) {
      settle(
        chat.id,
        itemId,
        "Errors are down by a third. Thursday's spike is the checkout bug I'm working on.",
        [{ kind: "chart", chartId: "errors-week" }]
      )
      return
    }
    if (/signed up|signup|sign up|leads/.test(lower)) {
      settle(
        chat.id,
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
      startOne(chat, itemId, text, agent.repos)
      return
    }
    // Anything else it works out on its own computer, with no repo involved.
    const work: Work = {
      id: uid(),
      agentId: chat.agentId,
      parentId: chat.id,
      asker: me,
      title: titleFromPrompt(text),
      mode: "chat",
      state: "running",
      steps: [
        "Searching what the team already knows",
        "Reading the related work",
        "Writing up what I found",
      ],
      summary:
        "I checked team memory, the related pull requests and the last three chats on this. Reply here to steer it.",
      replies: [],
    }
    setWorks((prev) => ({ ...prev, [work.id]: work }))
    settle(chat.id, itemId, "On it.", [{ kind: "work", workId: work.id }])
    later(() => {
      patchWork(work.id, { state: "done", result: "Written up" })
      say(
        chat.id,
        "Done. I wrote up what I found. Open it to read the details or reply to steer it."
      )
    }, 6200)
  }

  const createChat = (agentId: string, text: string, starter: Starter) => {
    const chat: Chat = {
      id: uid(),
      agentId,
      title: titleFromPrompt(text),
      starter,
      people: [me],
      time: "now",
    }
    const itemId = uid()
    setChats((prev) => [chat, ...prev])
    setTranscripts((prev) => ({
      ...prev,
      [chat.id]: [
        { id: uid(), kind: "person", author: me, time: "now", text },
        { id: itemId, kind: "agent", time: "now", pending: true },
      ],
    }))
    later(() => answer(chat, itemId, text), 1100)
    return chat
  }

  const currentAgentId = () => {
    if ("agentId" in view) return view.agentId
    if (view.kind === "channel") return channelAgents[view.channelId] ?? "eng"
    return "eng"
  }

  const store: Store = {
    view,
    canvas,
    works,
    drafts,
    chats,
    transcripts,
    pins,
    configured,
    channelAgents,
    channelChat,
    stateOf,
    childrenOf,
    openChat: (chatId) => {
      setView({ kind: "chat", chatId })
      setCanvas(null)
    },
    // A code session opens beside the chat that started it, or on its own
    // when a person started it directly.
    openWork: (workId) => {
      const work = works[workId]
      if (!work) return
      if (work.parentId) {
        setView({ kind: "chat", chatId: work.parentId })
        setCanvas({ kind: "work", workId })
        return
      }
      setView({ kind: "code", workId })
      setCanvas(null)
    },
    openAgent: (agentId, tab = "chats") => {
      setView({ kind: "agent", agentId, tab })
      setCanvas(null)
    },
    openChannel: (channelId) => {
      setView({ kind: "channel", channelId })
      setCanvas(null)
    },
    openNew: (agentId) => {
      setView({ kind: "new", agentId: agentId ?? currentAgentId() })
      setCanvas(null)
    },
    openNewCode: (agentId) => {
      setView({ kind: "newCode", agentId: agentId ?? currentAgentId() })
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
        () => say(draft.chatId, "Sent. I'll tell you here if Dana replies."),
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
      // A mention talks to a person. Anything else steers the session.
      if (mentionedPeople(text).length > 0) return
      const response =
        work.mode === "code"
          ? "Got it. I'll update the branch and tell you here when it's ready to look at again."
          : "Understood. I'll add that and update what I wrote."
      later(() => add(null, response), 1600)
    },
    send: (chatId, text) => {
      const chat = chats.find((item) => item.id === chatId)
      if (!chat) return
      const itemId = uid()
      post(
        chatId,
        { id: uid(), kind: "person", author: me, time: "now", text },
        { id: itemId, kind: "agent", time: "now", pending: true }
      )
      later(() => answer(chat, itemId, text), 1100)
    },
    addPerson: (chatId) =>
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat
          const next = Object.values(people).find(
            (person) => !chat.people.some((item) => item.id === person.id)
          )
          return next ? { ...chat, people: [...chat.people, next] } : chat
        })
      ),
    ask: (agentId, text) => {
      setCanvas(null)
      const chat = createChat(agentId, text, {
        kind: "person",
        person: me,
      })
      setView({ kind: "chat", chatId: chat.id })
    },
    // No agent above it: straight to one coding agent in one repo.
    startCode: (agentId, text, repo) => {
      setCanvas(null)
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
        asker: me,
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
    draftOutreach: (chatId, leadIds) => {
      const chat = chats.find((item) => item.id === chatId)
      if (!chat) return
      const names = leads
        .filter((lead) => leadIds.includes(lead.id))
        .map((lead) => lead.company)
      const work: Work = {
        id: uid(),
        agentId: chat.agentId,
        parentId: chatId,
        asker: me,
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
      say(chatId, `Drafting for ${list}.`, [{ kind: "work", workId: work.id }])
      later(() => {
        patchWork(work.id, {
          state: "done",
          result: `${names.length} drafts ready`,
        })
        say(
          chatId,
          "The drafts are ready. Nothing goes out until you approve each one."
        )
      }, 5200)
    },
    approveSetup: (agentId, chatId) => {
      setConfigured((prev) => ({ ...prev, [agentId]: true }))
      later(
        () =>
          say(
            chatId,
            "Set up. I'm watching Figma now and will start a chat when something needs you. Add me to a channel when you want me to follow one."
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
    setChannelAgent: (channelId, agentId) =>
      setChannelAgents((prev) => ({ ...prev, [channelId]: agentId })),
    postChannel: (channelId, text) => {
      const agent = agentById(channelAgents[channelId] ?? "")
      const add = (message: ChannelMessage) =>
        setChannelChat((prev) => ({
          ...prev,
          [channelId]: [...(prev[channelId] ?? []), message],
        }))
      const mention = agent ? new RegExp(`@${agent.name}\\b`, "i") : null
      // No agent here, or nobody addressed it: people talking to people.
      if (!agent || !mention?.test(text)) {
        add({ id: uid(), author: me, time: "now", text })
        return
      }
      const ask = text.replace(new RegExp(mention, "gi"), "").trim()
      // A quick question gets a plain reply in the channel. Work becomes a
      // chat, shown here as a thread and under the agent in the sidebar.
      if (!WORK.test(ask)) {
        const id = uid()
        add({ id, author: me, time: "now", text })
        later(
          () =>
            setChannelChat((prev) => ({
              ...prev,
              [channelId]: (prev[channelId] ?? []).map((message) =>
                message.id === id
                  ? {
                      ...message,
                      reply:
                        "The last deploy went out at 9:02 from main and is healthy. Ask me to dig in and I'll start a chat for it.",
                    }
                  : message
              ),
            })),
          1100
        )
        return
      }
      const chat = createChat(agent.id, ask, {
        kind: "channel",
        person: me,
        channelId,
      })
      add({ id: uid(), author: me, time: "now", text, chatId: chat.id })
    },
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
