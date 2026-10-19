"use client"

import { type KeyboardEvent, useId, useRef, useState } from "react"
import { Citation, FileCard, WorkLog } from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { TeamChatPreview } from "@/app/components/team-chat-preview"
import { FeedbackBoard } from "@/app/components/workspace-apps"
import {
  PreviewDetails,
  PreviewDocument,
  PreviewSidebar,
  PreviewTurn,
} from "@/app/components/workspace-preview"

const SCENES = [
  {
    label: "Talk to your team",
    title: "product",
    channel: "product",
    active: "product",
    caption:
      "It starts with a conversation in #product. Zoe shares her notes; Theo offers to help.",
    plan: [],
    files: [],
  },
  {
    label: "Ask an engineer",
    title: "Build a feedback board",
    channel: "engineering",
    active: "Build a feedback board",
    caption:
      "Theo takes the conversation into code. He already knows what Zoe needs and why.",
    plan: ["Read Zoe's notes", "Build the board", "Add team access"],
    files: ["feedback-board.tsx", "customer-feedback.md"],
  },
  {
    label: "Use it together",
    title: "A home for customer feedback",
    channel: "product",
    active: "Feedback board",
    caption:
      "The board lives in #product. Everyone in the channel can use it, with no extra accounts or setup.",
    plan: ["Add the customer quotes", "Share with the product team"],
    files: [],
  },
  {
    label: "Come back to it",
    title: "Why do we have a separate feedback board?",
    channel: "product",
    active: "Customer feedback",
    caption: "Months later, the reason behind the decision is still there.",
    plan: ["Find the original discussion", "Read the decisions"],
    files: ["customer-feedback.md"],
  },
] as const

function Conversation({ scene }: { scene: number }) {
  if (scene === 1)
    return (
      <>
        <PreviewTurn person="Theo">
          Build a board from Zoe&rsquo;s notes. Keep the customer&rsquo;s
          wording next to each request, and let anyone in #product add to it.
        </PreviewTurn>
        <PreviewTurn person="Codex">
          <WorkLog label="Worked" detail="Read the repo · Created 2 files" />
          <p className="mt-3">
            The board is ready to review. I used the existing team sign-in, so
            everyone in #product has access.
          </p>
          <FileCard
            name="feedback-board.tsx"
            detail="Customer requests and quotes"
          />
        </PreviewTurn>
        <PreviewTurn person="Zoe" aside>
          Can we link each request to the customer call it came from?
        </PreviewTurn>
        <PreviewTurn person="Theo" aside>
          Good call. Adding that now.
        </PreviewTurn>
      </>
    )
  if (scene === 3)
    return (
      <>
        <PreviewTurn person="Rafael">
          Why did we make a separate feedback board? Why not put everything
          straight into Linear?
        </PreviewTurn>
        <PreviewTurn person="Lor">
          <WorkLog label="Worked" detail="Read the original conversation" />
          <p className="mt-3">
            Zoe wanted somewhere to keep what customers actually said, including
            requests the team hadn&rsquo;t decided to build.
          </p>
          <p className="mt-3">
            The agreement was to keep raw feedback on the board and move a
            request into Linear once engineering picked it up.
            <Citation>Product discussion</Citation>
          </p>
        </PreviewTurn>
        <PreviewTurn person="Rafael">
          Makes sense. I&rsquo;ll keep doing it that way.
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
                      <FeedbackBoard headingLevel={2} />
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
                          ? "product · 4 messages"
                          : "product · Customer calls"
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
