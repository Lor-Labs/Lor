import { Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { authClient } from "@repo/auth/client"
import { Avatar, AvatarFallback, AvatarImage } from "@repo/ui/components/avatar"
import { Spinner } from "@repo/ui/components/spinner"
import { toast } from "@repo/ui/components/toast"
import { cn } from "@repo/ui/lib/utils"
import { getAvatarInitials } from "@repo/utils/avatar-colors"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { AgentCreature } from "@/components/agent/agent-creature"
import { HeaderNavControls } from "@/components/desktop-titlebar"
import { ChatAvatar } from "@/components/sidebar/chat-panel/chat-avatar"
import { useSocket } from "@/context/socket-context"
import { agentCreature, useAgents } from "@/hooks/use-agents"
import { useCanManageChannels } from "@/hooks/use-can-manage-channels"
import { chatsKey } from "@/hooks/use-chats"
import { apiClient } from "@/lib/api-client"

// Starting a chat (reference/agents-and-chats.md, decisions 31 and 35): who
// is in it, what it is called, and a first message if there is one. It
// starts with the people picked, not everyone; anyone else can still find
// it and join. Left unnamed, it is called by who is in it.

const LIST = new Intl.ListFormat("en", { type: "conjunction" })
// Past this many people the picker gets a search field.
const SEARCH_FROM = 12

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

function Pick({
  face,
  name,
  note,
  picked,
  onToggle,
}: {
  face: ReactNode
  name: string
  note?: string | null
  picked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={picked}
      className={cn(
        "flex h-9 cursor-pointer items-center gap-2 rounded-full border pr-3 pl-1.5 text-[13px] outline-none transition-[transform,background-color,border-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
        picked
          ? "border-foreground/25 bg-foreground/[0.07] text-foreground"
          : "border-border text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
      )}
    >
      {face}
      <span className="font-medium">{name}</span>
      {note && <span className="text-muted-foreground text-xs">{note}</span>}
      {picked && (
        <HugeiconsIcon
          icon={Tick02Icon}
          className="fade-in-0 zoom-in-90 size-3.5 animate-in duration-150 motion-reduce:animate-none"
          strokeWidth={2.5}
        />
      )}
    </button>
  )
}

export function NewChatView({ workspaceSlug }: { workspaceSlug: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const socket = useSocket()
  const { data: session } = authClient.useSession()
  const me = session?.user.id
  const agents = useAgents(workspaceSlug)
  // Picking a chat's agents takes channel:update. Without it the chat
  // starts with the workspace's first agent, as a new chat always has.
  const canPickAgents = useCanManageChannels(workspaceSlug)
  const { data: membersData } = useQuery({
    queryKey: ["workspace-members", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].members.$get({
        param: { workspaceSlug },
      })
      if (!res.ok) throw new Error("Failed to fetch workspace members")
      return res.json()
    },
  })
  const everyone = (membersData?.members ?? []).filter(
    (member) => !member.isBot && member.userId !== me
  )

  const [agentIds, setAgentIds] = useState<string[]>([])
  const [peopleIds, setPeopleIds] = useState<string[]>([])
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [query, setQuery] = useState("")
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id]

  // In the order they were picked, which is the order the face fills in.
  const pickedAgents = agentIds.flatMap(
    (id) => agents.find((agent) => agent.id === id) ?? []
  )
  const pickedPeople = peopleIds.flatMap(
    (id) => everyone.find((member) => member.userId === id) ?? []
  )
  const needle = query.trim().toLowerCase()
  const shownPeople = everyone.filter(
    (member) =>
      !needle ||
      peopleIds.includes(member.userId) ||
      member.name.toLowerCase().includes(needle)
  )

  const membersName = LIST.format([
    ...pickedAgents.map((agent) => agent.name),
    ...pickedPeople.map((member) => firstName(member.name)),
  ])
  const agentNames = LIST.format(pickedAgents.map((agent) => agent.name))
  const several = pickedAgents.length > 1
  let hint = "Pick who is in it. You can change that later."
  if (pickedAgents.length === 1 && pickedPeople.length === 0) {
    hint = `Just you and ${agentNames}.`
  } else if (pickedAgents.length > 0) {
    hint = `${agentNames} ${several ? "read" : "reads"} along and ${several ? "answer" : "answers"} when mentioned.`
  } else if (pickedPeople.length > 0) {
    hint = canPickAgents
      ? "No agent in it yet. You can add one later."
      : "Anyone else in the workspace can find it and join."
  }

  const start = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[
        ":workspaceSlug"
      ].channels.$post({
        param: { workspaceSlug },
        json: {
          type: "text",
          name: name.trim() || null,
          memberIds: peopleIds,
          ...(canPickAgents ? { agentIds } : {}),
        },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Couldn't start the chat")
      }
      const chat = await res.json()
      const first = text.trim()
      if (first) {
        // The chat exists either way: a first message that fails to send
        // stays in the composer's place as a toast, not a lost chat.
        const sent = socket?.connected
          ? await socket
              .timeout(12_000)
              .emitWithAck("message:send", {
                channelId: chat.id,
                content: first,
                nonce: crypto.randomUUID(),
              })
              .then((result) => result.ok)
              .catch(() => false)
          : false
        if (!sent)
          toast.error("The chat was made, but your message wasn't sent")
      }
      return chat
    },
    onSuccess: async (chat) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["channels", workspaceSlug],
          exact: true,
        }),
        queryClient.invalidateQueries({ queryKey: chatsKey(workspaceSlug) }),
      ])
      void navigate({
        to: "/$workspaceSlug/$channelId",
        params: { workspaceSlug, channelId: chat.id },
      })
    },
    onError: (err) => toast.error(err.message),
  })
  const busy = start.isPending
  // Someone in it, or a name: a chat with neither says nothing about itself.
  const ready =
    pickedAgents.length + pickedPeople.length > 0 || name.trim().length > 0
  const submit = () => {
    if (ready && !busy) start.mutate()
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-4">
        <HeaderNavControls className="-ml-2" withDivider />
        <span className="font-semibold">New chat</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <form
          className="mx-auto my-auto w-full max-w-xl px-6 py-10"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="flex items-center gap-4">
            <ChatAvatar
              agents={pickedAgents}
              people={pickedPeople.map((member) => ({
                id: member.userId,
                name: member.name,
                image: member.image,
                avatarColor: member.avatarColor,
              }))}
              total={pickedAgents.length + pickedPeople.length}
              size={64}
              grow
            />
            <div className="min-w-0 flex-1">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                // Left empty, the chat is called by who is in it.
                placeholder={membersName || "New chat"}
                aria-label="Chat name"
                maxLength={100}
                // biome-ignore lint/a11y/noAutofocus: the screen is this form
                autoFocus
                className="w-full truncate bg-transparent font-semibold text-[22px] tracking-[-0.01em] outline-none placeholder:text-muted-foreground/70"
              />
              <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>
            </div>
          </div>

          <div className="mt-7 space-y-5">
            {canPickAgents && agents.length > 0 && (
              <div>
                <div className="pb-2 font-medium text-muted-foreground text-xs">
                  Agents
                </div>
                <div className="flex flex-wrap gap-2">
                  {agents.map((agent) => (
                    <Pick
                      key={agent.id}
                      face={
                        <AgentCreature
                          creature={agentCreature(agent)}
                          size={24}
                          still
                        />
                      }
                      name={agent.name}
                      note={agent.role}
                      picked={agentIds.includes(agent.id)}
                      onToggle={() =>
                        setAgentIds((list) => toggle(list, agent.id))
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            {everyone.length > 0 && (
              <div>
                <div className="flex items-center justify-between gap-3 pb-2">
                  <span className="font-medium text-muted-foreground text-xs">
                    People
                  </span>
                  {everyone.length > SEARCH_FROM && (
                    <label className="flex h-7 w-44 items-center gap-1.5 rounded-full border border-border px-2.5 text-muted-foreground transition-colors duration-150 focus-within:border-foreground/25">
                      <HugeiconsIcon
                        icon={Search01Icon}
                        className="size-3.5 shrink-0"
                        strokeWidth={2}
                      />
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Find someone"
                        aria-label="Find someone"
                        className="min-w-0 flex-1 bg-transparent text-foreground text-xs outline-none placeholder:text-muted-foreground"
                      />
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {shownPeople.map((member) => (
                    <Pick
                      key={member.userId}
                      face={
                        <Avatar className="size-6">
                          {member.image && (
                            <AvatarImage src={member.image} alt="" />
                          )}
                          <AvatarFallback
                            avatarColor={member.avatarColor}
                            fallbackSeed={member.name}
                            className="font-semibold text-[10px]"
                          >
                            {getAvatarInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                      }
                      name={member.name}
                      picked={peopleIds.includes(member.userId)}
                      onToggle={() =>
                        setPeopleIds((list) => toggle(list, member.userId))
                      }
                    />
                  ))}
                  {shownPeople.length === 0 && (
                    <p className="py-1.5 text-muted-foreground text-xs">
                      Nobody by that name.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-7 rounded-2xl border border-border bg-background/40 transition-colors duration-150 focus-within:border-foreground/25">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return
                if (event.nativeEvent.isComposing) return
                event.preventDefault()
                submit()
              }}
              rows={2}
              maxLength={2000}
              placeholder="Say what it's for, or start it empty"
              aria-label="First message"
              className="block w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-end px-2 pb-2">
              <button
                type="submit"
                disabled={!ready || busy}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3.5 font-medium text-[13px] outline-none transition-[transform,background-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
                  ready
                    ? "cursor-pointer bg-primary text-primary-foreground active:scale-[0.97] motion-reduce:active:scale-100"
                    : "bg-foreground/[0.07] text-muted-foreground"
                )}
              >
                {busy && <Spinner className="size-3.5" />}
                Start chat
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
