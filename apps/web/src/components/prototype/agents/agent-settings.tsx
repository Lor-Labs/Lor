import { Clock01Icon, ZapIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { cn } from "@repo/ui/lib/utils"
import { type ReactNode, useState } from "react"
import {
  type Agent,
  agentById,
  channelById,
  channels,
  placeNames,
} from "./agents-data"
import { AgentAvatar, PlaceIcon, Segmented } from "./agents-parts"
import { useProto } from "./agents-store"

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section>
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {note && (
        <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
          {note}
        </p>
      )}
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

const LIST =
  "flex flex-col divide-y divide-border/60 rounded-2xl border border-border/70"
const ROW = "flex items-center gap-3 px-4 py-2.5 text-[14px]"

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border/80 px-2.5 py-0.5 text-[13px]">
      {children}
    </span>
  )
}

function Step({ index }: { index: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-[11.5px] font-semibold tabular-nums">
      {index}
    </span>
  )
}

// Which channels the agent is in. A channel holds one agent, so a channel
// another agent is in can't be picked.
function Channels({ agent }: { agent: Agent }) {
  const { channelAgents, setChannelAgent } = useProto()
  return (
    <div className={LIST}>
      {channels.map((channel) => {
        const holder = channelAgents[channel.id]
        const here = holder === agent.id
        const other = holder && !here ? agentById(holder) : undefined
        return (
          <div key={channel.id} className={ROW}>
            <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
              {channel.place === "lor" ? (
                "#"
              ) : (
                <PlaceIcon place={channel.place} className="size-3.5" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {channel.name}
              {channel.place !== "lor" && (
                <span className="ml-2 text-[12.5px] text-muted-foreground">
                  in {placeNames[channel.place]}
                </span>
              )}
            </span>
            {other ? (
              <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <AgentAvatar agent={other} size={18} />
                {other.name} is there
              </span>
            ) : (
              <Button
                size="sm"
                variant={here ? "ghost" : "outline"}
                onClick={() =>
                  setChannelAgent(channel.id, here ? null : agent.id)
                }
              >
                {here ? "Remove" : "Add"}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// An agent's own settings. Everything here moves with it between channels
// and chats: its brief, memory, tools, accounts and events.
export function AgentSettings({ agent }: { agent: Agent }) {
  const { configured, openAgent } = useProto()
  const [payer, setPayer] = useState<"lor" | "key">("lor")
  const [audience, setAudience] = useState<"all" | "some">("all")

  if (!configured[agent.id]) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-6 pt-8">
        <p className="text-[14px] leading-6 text-muted-foreground">
          {agent.name} has no settings yet.{" "}
          <button
            type="button"
            onClick={() => openAgent(agent.id, "chats")}
            className="cursor-pointer font-medium text-foreground hover:underline"
          >
            Set it up in a chat
          </button>{" "}
          and it proposes them.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-9 px-6 pt-8 pb-14">
        <Section title="Identity">
          <div className={cn(LIST)}>
            <div className={ROW}>
              <AgentAvatar agent={agent} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{agent.name}</span>
                <span className="block text-[13px] text-muted-foreground">
                  {agent.role} · {agent.job}
                </span>
              </span>
              <Button size="sm" variant="outline">
                Change
              </Button>
            </div>
          </div>
        </Section>

        <Section
          title="Brief and memory"
          note={`Only people change the brief. ${agent.name} keeps the facts itself, and anyone can edit or delete one.`}
        >
          <p className="rounded-2xl border border-border/70 px-4 py-3 text-[14px] leading-6">
            {agent.brief}
          </p>
          {agent.facts.length > 0 && (
            <div className={cn(LIST, "mt-2.5")}>
              {agent.facts.map((fact) => (
                <div key={fact.id} className={ROW}>
                  <span className="min-w-0 flex-1">{fact.text}</span>
                  <span className="shrink-0 text-[12.5px] text-muted-foreground">
                    {fact.source}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Its own turns"
          note={`What ${agent.name} thinks and says, in every channel and chat. These run on the API, so a Claude or ChatGPT plan can't pay for them.`}
        >
          <div className={LIST}>
            <div className={ROW}>
              <span className="min-w-0 flex-1">Model</span>
              <span className="text-muted-foreground">{agent.model}</span>
            </div>
            <div className={ROW}>
              <span className="min-w-0 flex-1">Paid by</span>
              <Segmented
                id={`payer-${agent.id}`}
                className="w-[260px]"
                value={payer}
                onChange={setPayer}
                items={[
                  { id: "lor", label: "Lor credits" },
                  { id: "key", label: "Our API key" },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section
          title="Code sessions"
          note={`Who pays when ${agent.name} starts a code session, tried in this order.`}
        >
          <div className={LIST}>
            <div className={ROW}>
              <Step index={1} />
              <span className="min-w-0 flex-1">
                <span className="block">The plan of whoever asked</span>
                <span className="block text-[13px] text-muted-foreground">
                  Their own Claude Code or ChatGPT login, when they have one
                  connected.
                </span>
              </span>
            </div>
            <div className={cn(ROW, "items-start")}>
              <Step index={2} />
              <span className="min-w-0 flex-1">
                <span className="block">{agent.name}'s own accounts</span>
                <span className="block text-[13px] text-muted-foreground">
                  The backup, and what pays for work nobody asked for.
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {agent.accounts.map((account) => (
                    <Chip key={account.id}>
                      {account.provider} · {account.label}
                      <span className="ml-1.5 text-muted-foreground">
                        {account.note}
                      </span>
                    </Chip>
                  ))}
                  {agent.accounts.length === 0 && (
                    <span className="text-[13px] text-muted-foreground">
                      None connected.
                    </span>
                  )}
                </span>
              </span>
              <Button size="sm" variant="outline">
                Add account
              </Button>
            </div>
            <div className={ROW}>
              <Step index={3} />
              <span className="min-w-0 flex-1">
                <span className="block">The API</span>
                <span className="block text-[13px] text-muted-foreground">
                  Paid the same way as its own turns.
                </span>
              </span>
            </div>
          </div>
          {agent.repos.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[13px] text-muted-foreground">
                Repos it may use
              </span>
              {agent.repos.map((repo) => (
                <span
                  key={repo}
                  className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px]"
                >
                  {repo}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Tools"
          note="Writes follow the workspace's approval rules."
        >
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((tool) => (
              <Chip key={tool}>{tool}</Chip>
            ))}
          </div>
        </Section>

        <Section
          title="Channels"
          note={`Where ${agent.name} reads along. A mention or a reply wakes it at once, and it reads the rest at its next check-in. A channel holds one agent.`}
        >
          <Channels agent={agent} />
          <Button size="sm" variant="outline" className="mt-2.5">
            Add to a Slack or Discord channel
          </Button>
        </Section>

        <Section
          title="Events and Loops"
          note={`What wakes ${agent.name} with nobody asking. Each one names the channel it reports in.`}
        >
          <div className={LIST}>
            {agent.watching.map((watch) => (
              <div key={watch.id} className={ROW}>
                <HugeiconsIcon
                  icon={watch.kind === "schedule" ? Clock01Icon : ZapIcon}
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={2}
                />
                <span className="min-w-0 flex-1 truncate">{watch.label}</span>
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  Reports in #{channelById(watch.reportsIn)?.name}
                </span>
              </div>
            ))}
            <div className={ROW}>
              <HugeiconsIcon
                icon={Clock01Icon}
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
              <span className="min-w-0 flex-1 truncate">
                Check-in, every 30 minutes
              </span>
              <span className="shrink-0 text-[13px] text-muted-foreground">
                Reads what it missed in its channels
              </span>
            </div>
          </div>
        </Section>

        <Section
          title="Who can see it"
          note={`Everything ${agent.name} hears and every chat with it is open to these people. A private channel needs an agent only its members can see.`}
        >
          <Segmented
            id={`audience-${agent.id}`}
            className="w-[380px]"
            value={audience}
            onChange={setAudience}
            items={[
              { id: "all", label: "Everyone at Northstar" },
              { id: "some", label: "Only some people" },
            ]}
          />
        </Section>
      </div>
    </div>
  )
}
