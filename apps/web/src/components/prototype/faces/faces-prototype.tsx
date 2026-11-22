import { cn } from "@repo/ui/lib/utils"
import {
  CREATURES,
  type CreatureId,
  type CreatureState,
} from "@repo/utils/bestiary"
import { STILLS, stillSvg } from "@repo/utils/face-stills"
import { type ReactNode, useState } from "react"
import { PixelCreature } from "@/components/agent/agent-creature"
import { AgentFace } from "@/components/agent/agent-face"

// Dev-only: the 3D faces the app draws beside the detailed pixel bestiary
// it no longer does (reference/always-on-agents.md, decision 41), at the
// sizes the app uses, for working on either set.

const STATES: { id: CreatureState; label: string }[] = [
  { id: "idle", label: "Awake" },
  { id: "asleep", label: "Asleep" },
  { id: "working", label: "Working" },
  { id: "needs_you", label: "Needs you" },
]

const CHANNELS = [
  "engineering",
  "gtm",
  "support",
  "design",
  "product",
  "deploys",
  "customers",
  "ops",
  "research",
  "general",
]

type Draw = (props: {
  creature: CreatureId
  state: CreatureState
  size: number
}) => ReactNode

const pixel: Draw = (props) => <PixelCreature {...props} />
const simple: Draw = (props) => <AgentFace {...props} />

function SidebarMock({ draw, state }: { draw: Draw; state: CreatureState }) {
  return (
    <div className="w-60 rounded-xl border bg-sidebar p-2">
      {CREATURES.map((creature, index) => (
        <div
          key={creature.id}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2 py-[6px] text-[14px] text-muted-foreground",
            index === 2 && "bg-sidebar-accent font-medium text-foreground"
          )}
        >
          <span className="opacity-50">#</span>
          <span className="min-w-0 flex-1 truncate">{CHANNELS[index]}</span>
          <span className="-my-1 flex">
            {draw({
              creature: creature.id,
              // A mix, as a real sidebar has.
              state:
                index % 4 === 1 ? "working" : index === 4 ? "needs_you" : state,
              size: 24,
            })}
          </span>
        </div>
      ))}
    </div>
  )
}

function ChatMock({ draw }: { draw: Draw }) {
  const posts: { creature: CreatureId; text: string }[] = [
    {
      creature: "kraken",
      text: "The export fix is on a branch and the app runs. Want me to open it for review?",
    },
    {
      creature: "fox",
      text: "Fourteen teams signed up last week. Five match the profile, drafts are ready.",
    },
  ]
  return (
    <div className="w-[26rem] space-y-4 rounded-xl border bg-background p-4">
      {posts.map((post) => {
        const creature = CREATURES.find((item) => item.id === post.creature)
        return (
          <div key={post.creature} className="flex gap-3">
            <span className="-m-1 flex self-start">
              {draw({ creature: post.creature, state: "idle", size: 48 })}
            </span>
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{creature?.names[0]}</div>
              <p className="text-pretty text-muted-foreground">{post.text}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function FacesPrototype() {
  const [state, setState] = useState<CreatureState>("idle")

  return (
    <div className="min-h-svh bg-background px-10 py-8 text-foreground">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="space-y-1">
            <h1 className="font-semibold text-xl">Agent faces</h1>
            <p className="max-w-xl text-pretty text-muted-foreground text-sm">
              The 3D faces the app draws, beside the pixel creatures they
              replaced. Move the pointer near a face and it turns to look.
            </p>
          </div>
        </header>

        <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm w-fit">
          {STATES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setState(item.id)}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 transition-colors",
                state === item.id
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <section className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-sm">
            Side by side
          </h2>
          <div className="grid grid-cols-5 gap-3">
            {CREATURES.map((creature) => (
              <div
                key={creature.id}
                className="flex flex-col items-center gap-3 rounded-xl border p-4"
              >
                <div className="flex items-center gap-5">
                  <PixelCreature
                    creature={creature.id}
                    state={state}
                    size={72}
                  />
                  <AgentFace creature={creature.id} state={state} size={72} />
                </div>
                <div className="flex items-center gap-4">
                  <PixelCreature
                    creature={creature.id}
                    state={state}
                    size={24}
                  />
                  <AgentFace creature={creature.id} state={state} size={24} />
                </div>
                <span className="text-muted-foreground text-xs">
                  {creature.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium text-muted-foreground text-sm">
            Stills for Discord and Slack
          </h2>
          <p className="max-w-2xl text-pretty text-muted-foreground text-sm">
            What a chat app shows as the avatar: each creature's flat front
            view, cropped to a circle as Discord does.
          </p>
          <div className="flex flex-wrap gap-4 rounded-xl bg-[#313338] p-4">
            {CREATURES.map((creature) => (
              <img
                key={creature.id}
                alt={creature.label}
                title={creature.label}
                className="size-14 rounded-full"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(
                  stillSvg(STILLS[creature.id], { size: 112, pad: 3.5 })
                )}`}
              />
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-10">
          {(
            [
              ["Pixel creatures", pixel],
              ["3D faces", simple],
            ] as const
          ).map(([title, draw]) => (
            <div key={title} className="space-y-3">
              <h2 className="font-medium text-muted-foreground text-sm">
                {title}
              </h2>
              <SidebarMock draw={draw} state={state} />
              <ChatMock draw={draw} />
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
