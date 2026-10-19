"use client"

import { type KeyboardEvent, useId, useRef, useState } from "react"
import { Citation, FileCard, WorkLog } from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { TeamChatPreview } from "@/app/components/team-chat-preview"
import { LaunchChecklist } from "@/app/components/workspace-apps"
import {
  PreviewDetails,
  PreviewDocument,
  PreviewSidebar,
  PreviewTurn,
} from "@/app/components/workspace-preview"

const SCENES = [
  {
    label: "Talk to your team",
    title: "launch",
    channel: "launch",
    active: "launch",
    caption:
      "Friday’s launch starts in #launch. The team works out what they need, together.",
    plan: [],
    files: [],
  },
  {
    label: "Ask an engineer",
    title: "Build our launch checklist",
    channel: "engineering",
    active: "Build our launch checklist",
    caption:
      "Theo takes the conversation into code. He already knows what Zoe needs and why.",
    plan: ["Read the launch plan", "Build the checklist", "Add the QA handoff"],
    files: ["launch-checklist.tsx", "launch-plan.md"],
  },
  {
    label: "Use it together",
    title: "Friday’s launch",
    channel: "launch",
    active: "Launch checklist",
    caption:
      "One place to see who’s ready. Built for this team, right in #launch. No extra accounts or setup.",
    plan: [],
    files: [],
  },
  {
    label: "Come back to it",
    title: "Why isn’t the email on a timer?",
    channel: "launch",
    active: "Launch decisions",
    caption: "Months later, the reason behind the decision is still there.",
    plan: ["Find the original discussion", "Read the decisions"],
    files: ["launch-plan.md"],
  },
] as const

function Conversation({ scene }: { scene: number }) {
  if (scene === 1)
    return (
      <>
        <PreviewTurn person="Theo">
          Make a launch checklist from this conversation. Give each item an
          owner, and keep the customer email on hold until I sign off on QA.
          Everyone in #launch should be able to update their part.
        </PreviewTurn>
        <PreviewTurn person="Codex">
          <WorkLog label="Worked" detail="Read the repo · Created 2 files" />
          <p className="mt-3">
            It&rsquo;s in #launch. When you mark QA ready, Rafael will see the
            email is clear to go. Everyone in the channel already has access.
          </p>
          <FileCard
            name="launch-checklist.tsx"
            detail="Owners, readiness, and the QA handoff"
          />
        </PreviewTurn>
        <PreviewTurn person="Zoe" aside>
          Can we reuse it next Friday too? Same owners, fresh checklist.
        </PreviewTurn>
        <PreviewTurn person="Theo" aside>
          Yep, adding that.
        </PreviewTurn>
      </>
    )
  if (scene === 3)
    return (
      <>
        <PreviewTurn person="Rafael">
          Why do we wait for Theo instead of scheduling the launch email for 10?
        </PreviewTurn>
        <PreviewTurn person="Lor">
          <WorkLog label="Worked" detail="Read the original conversation" />
          <p className="mt-3">
            The last launch slipped after the email was already scheduled.
            Customers got the announcement before the feature was live.
          </p>
          <p className="mt-3">
            Zoe and Theo agreed to make QA sign-off the go-ahead for the email,
            so Rafael wouldn&rsquo;t have to chase an update on launch day.
            <Citation>Launch discussion</Citation>
          </p>
        </PreviewTurn>
        <PreviewTurn person="Rafael">
          Got it. We&rsquo;ll keep that for the next one.
        </PreviewTurn>
      </>
    )
  return null
}

export function WorkspaceStory() {
  const [active, setActive] = useState(0)
  const id = useId()
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const scene = SCENES[active] ?? SCENES[0]

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) {
    let next = index
    if (event.key === "ArrowRight") next = (index + 1) % SCENES.length
    else if (event.key === "ArrowLeft")
      next = (index + SCENES.length - 1) % SCENES.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = SCENES.length - 1
    else return
    event.preventDefault()
    setActive(next)
    tabs.current[next]?.focus()
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="A team working in Lor"
          className="grid w-full grid-cols-2 gap-1 sm:w-auto sm:grid-cols-4"
        >
          {SCENES.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                tabs.current[index] = element
              }}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-controls={`${id}-panel-${index}`}
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`min-h-11 cursor-pointer rounded-lg px-3 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-agent ${active === index ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="px-3 text-[11px] text-muted-foreground">
          Product preview
        </span>
      </div>
      {SCENES.map((item, index) => (
        <div
          key={item.label}
          id={`${id}-panel-${index}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${index}`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Tab panels need a focus target after the tab list.
          tabIndex={0}
          hidden={active !== index}
          className="rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent"
        >
          {active === index ? (
            <MockShell>
              <div className="flex bg-lor-sidebar-dark text-left md:min-h-[650px]">
                <PreviewSidebar active={scene.active} />
                <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
                  <div className="m-2 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-lor-border-dark/60 md:ml-0">
                    {active === 0 ? (
                      <TeamChatPreview />
                    ) : active === 2 ? (
                      <LaunchChecklist headingLevel={2} />
                    ) : (
                      <PreviewDocument
                        title={scene.title}
                        channel={scene.channel}
                        headingLevel={2}
                        starter={active === 1 ? "Theo" : "Rafael"}
                        agent={active === 1 ? "Codex" : "Lor"}
                      >
                        <Conversation scene={active} />
                      </PreviewDocument>
                    )}
                  </div>
                  {active === 1 || active === 3 ? (
                    <PreviewDetails
                      plan={[...scene.plan]}
                      files={[...scene.files]}
                      context={
                        active === 1
                          ? "launch · 4 messages"
                          : "launch · Friday launch"
                      }
                    />
                  ) : null}
                </div>
              </div>
            </MockShell>
          ) : null}
        </div>
      ))}
      <p
        aria-live="polite"
        aria-atomic="true"
        className="mt-5 min-h-10 px-1 text-sm leading-relaxed text-muted-foreground"
      >
        {scene.caption}
      </p>
    </div>
  )
}
