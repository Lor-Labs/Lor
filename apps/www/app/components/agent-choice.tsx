import { ChatGptIcon, ClaudeIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LorMark } from "@/app/components/lor-mark"
import { PersonAvatar, RAFAEL, THEO, ZOE } from "@/app/components/mock-parts"
import { Reveal } from "@/app/components/reveal"

const AGENTS = [
  {
    name: "Lor",
    icon: null,
    status: "Early access",
    surface: "bg-[#292724] text-[#c8c1b8]",
    tilt: "sm:-rotate-6",
  },
  {
    name: "Claude Code",
    icon: ClaudeIcon,
    status: "In development",
    surface: "bg-[#e5d0bc] text-[#9b5033]",
    tilt: "sm:-translate-y-3",
  },
  {
    name: "Codex",
    icon: ChatGptIcon,
    status: "Planned",
    surface: "bg-[#d8ddd2] text-[#29332c]",
    tilt: "sm:rotate-6",
  },
]

export function AgentChoice() {
  return (
    <section
      id="agents"
      aria-labelledby="agent-choice-title"
      className="mx-auto max-w-[1240px] scroll-mt-24 px-5 sm:px-8"
    >
      <Reveal>
        <div className="rounded-[2rem] border border-foreground/[0.08] bg-foreground/[0.025] p-1.5">
          <div className="relative isolate overflow-hidden rounded-[calc(2rem-0.375rem)] bg-[#141310] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_90%_at_90%_70%,--theme(--color-agent/.07),transparent)]"
            />
            <div className="grid items-center gap-10 px-6 pt-9 pb-8 sm:px-10 sm:py-12 lg:grid-cols-[1fr_1.05fr] lg:gap-8 lg:p-14">
              <div>
                <p className="mb-5 text-sm text-foreground/45">Agent choice</p>
                <h2
                  id="agent-choice-title"
                  className="text-[clamp(2.5rem,4.6vw,3.5rem)] font-medium leading-[1.06] tracking-[-0.045em]"
                >
                  Your agent.
                  <br />
                  <span className="text-foreground/50">With your team.</span>
                </h2>
                <p className="mt-6 max-w-[34ch] text-[16px] leading-relaxed text-foreground/60">
                  Start with Lor for research, connected tools, files, and code.
                  The workspace keeps the people and context around the work,
                  whichever agent you use.
                </p>
                <p className="mt-4 max-w-[36ch] text-sm leading-relaxed text-foreground/45">
                  Claude Code support is in development, with Codex planned
                  next. More ways to work in the same shared space.
                </p>
              </div>
              <div
                role="img"
                aria-label="Lor is in early access. Claude Code support is in development. Codex is planned. All share the team's workspace."
                className="relative mx-auto w-full max-w-[430px] pt-3 sm:pt-5"
              >
                <div aria-hidden="true">
                  <div className="grid grid-cols-3 gap-3 sm:gap-6">
                    {AGENTS.map((agent) => (
                      <div
                        key={agent.name}
                        className="flex flex-col items-center"
                      >
                        <div
                          className={`w-full max-w-[106px] rounded-[24px] border border-white/10 bg-white/[0.035] p-1.5 ${agent.tilt}`}
                        >
                          <div
                            className={`flex aspect-square items-center justify-center rounded-[18px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_8px_24px_-16px_rgba(0,0,0,0.8)] ${agent.surface}`}
                          >
                            {agent.icon ? (
                              <HugeiconsIcon
                                icon={agent.icon}
                                className="size-10 sm:size-12"
                                strokeWidth={1.5}
                              />
                            ) : (
                              <LorMark className="size-10 sm:size-12" />
                            )}
                          </div>
                        </div>
                        <p className="mt-4 whitespace-nowrap text-[12px] font-medium text-foreground/70 sm:text-[13px]">
                          {agent.name}
                        </p>
                        <p className="mt-1 text-center text-[10px] text-foreground/45 sm:text-[11px]">
                          {agent.status}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="relative mx-auto mt-3 h-14 w-[69%]">
                    <div className="absolute inset-x-0 top-0 h-7 rounded-b-2xl border-x border-b border-foreground/15" />
                    <div className="absolute inset-y-0 left-1/2 w-px bg-linear-to-b from-foreground/15 to-agent/60" />
                    <span className="absolute bottom-0 left-1/2 size-1.5 -translate-x-[calc(50%-0.5px)] translate-y-1/2 rounded-full bg-agent" />
                  </div>
                  <div className="mx-auto w-full max-w-[340px] rounded-[20px] border border-foreground/10 bg-foreground/[0.025] p-1.5">
                    <div className="flex items-center gap-3 rounded-[14px] bg-[#1c1a20] px-4 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] sm:px-5">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#121114] ring-1 ring-white/[0.06]">
                        <LorMark className="w-7" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[18px] font-semibold tracking-tight">
                          Lor
                        </p>
                        <p className="mt-0.5 text-[11px] text-foreground/45">
                          Your team's workspace
                        </p>
                      </div>
                      <div className="ml-auto flex shrink-0 -space-x-2">
                        {[ZOE, THEO, RAFAEL].map((person) => (
                          <PersonAvatar
                            key={person}
                            src={person}
                            size="size-7"
                            className="ring-[3px] ring-[#1c1a20] sm:size-8"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
