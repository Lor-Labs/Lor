"use client"

import { PauseIcon, PlayIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { LaunchChecklist } from "@/app/components/launch-checklist"
import { Citation, FileCard, WorkLog } from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { TeamChatPreview } from "@/app/components/team-chat-preview"
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

const SCENE_DURATION_MS = 4_000

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
  const [cycle, setCycle] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [inView, setInView] = useState(false)
  const [pageVisible, setPageVisible] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true)
  const [automatic, setAutomatic] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const panels = useRef<(HTMLDivElement | null)[]>([])
  const progress = useRef<HTMLSpanElement>(null)
  const progressAnimation = useRef<Animation | null>(null)
  const playbackControl = useRef<HTMLButtonElement>(null)
  const scene = SCENES[active] ?? SCENES[0]
  const running = !paused && !hovered && inView && pageVisible && !reducedMotion

  useEffect(() => {
    const element = root.current
    if (!element) return
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const updateMotion = () => setReducedMotion(media.matches)
    const updateVisibility = () => setPageVisible(!document.hidden)
    updateMotion()
    updateVisibility()
    media.addEventListener("change", updateMotion)
    document.addEventListener("visibilitychange", updateVisibility)
    const observer = new IntersectionObserver(
      ([entry]) => setInView(!!entry && entry.intersectionRatio >= 0.35),
      { threshold: 0.35 }
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      media.removeEventListener("change", updateMotion)
      document.removeEventListener("visibilitychange", updateVisibility)
    }
  }, [])

  // One compositor animation drives both the visible countdown and advancement.
  useEffect(() => {
    const element = progress.current
    if (!element || reducedMotion) return
    const animation = element.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: SCENE_DURATION_MS, easing: "linear", fill: "forwards" }
    )
    animation.pause()
    progressAnimation.current = animation
    animation.onfinish = () => {
      if (progressAnimation.current !== animation) return
      setAutomatic(true)
      setActive((current) => (current + 1) % SCENES.length)
    }
    return () => {
      animation.onfinish = null
      animation.cancel()
      progressAnimation.current = null
    }
  }, [active, cycle, reducedMotion])

  useEffect(() => {
    const animation = progressAnimation.current
    if (running) animation?.play()
    else animation?.pause()
  }, [active, cycle, reducedMotion, running])

  useEffect(() => {
    const panel = panels.current[active]
    if (!panel || !automatic || reducedMotion) return
    const animation = panel.animate([{ opacity: 0.6 }, { opacity: 1 }], {
      duration: 180,
      easing: getComputedStyle(document.documentElement)
        .getPropertyValue("--ease-out")
        .trim(),
    })
    return () => animation.cancel()
  }, [active, automatic, reducedMotion])

  function selectScene(index: number) {
    setAutomatic(false)
    setActive(index)
    setCycle((current) => current + 1)
  }

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
    setPaused(true)
    selectScene(next)
    tabs.current[next]?.focus()
  }

  return (
    <div
      ref={root}
      onFocusCapture={(event) => {
        if (
          !playbackControl.current?.contains(event.target) &&
          event.target.matches(":focus-visible")
        ) {
          setPaused(true)
        }
      }}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="A team working in Lor"
          className="grid w-full grid-cols-2 gap-1 rounded-xl bg-lor-sidebar-dark/80 p-1 ring-1 ring-inset ring-foreground/[0.08] sm:w-auto sm:grid-cols-4"
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
              onClick={() => selectScene(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`relative isolate min-h-11 cursor-pointer overflow-hidden rounded-lg px-3.5 text-[13px] focus-visible:outline-2 focus-visible:outline-agent ${active === index ? "bg-agent/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"}`}
            >
              {active === index && !reducedMotion ? (
                <span
                  ref={progress}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -z-10 origin-left bg-agent/25"
                  style={{ transform: "scaleX(0)" }}
                />
              ) : null}
              <span className="relative">{item.label}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            Product preview
          </span>
          {!reducedMotion ? (
            <button
              ref={playbackControl}
              type="button"
              aria-label={
                paused ? "Resume automatic preview" : "Pause automatic preview"
              }
              title={
                paused ? "Resume automatic preview" : "Pause automatic preview"
              }
              onClick={() => setPaused((current) => !current)}
              className="flex size-11 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-agent"
            >
              <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} size={16} />
            </button>
          ) : null}
        </div>
      </div>
      <div
        className="grid"
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true)
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") setHovered(false)
        }}
        onPointerDown={() => setPaused(true)}
        onFocusCapture={() => setPaused(true)}
      >
        {SCENES.map((item, index) => (
          <div
            key={item.label}
            ref={(element) => {
              panels.current[index] = element
            }}
            id={`${id}-panel-${index}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${index}`}
            tabIndex={active === index ? 0 : -1}
            aria-hidden={active !== index}
            inert={active !== index}
            className={`col-start-1 row-start-1 min-w-0 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent ${active === index ? "" : "invisible pointer-events-none"}`}
          >
            <MockShell className="h-full" innerClassName="h-full">
              <div className="flex h-full max-h-[700px] min-h-[650px] overflow-y-auto overscroll-y-contain bg-lor-sidebar-dark text-left">
                <PreviewSidebar active={item.active} />
                <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
                  <div className="m-2 flex min-w-0 flex-1 overflow-hidden rounded-xl border border-lor-border-dark/60 md:ml-0">
                    {index === 0 ? (
                      <TeamChatPreview />
                    ) : index === 2 ? (
                      <LaunchChecklist headingLevel={2} />
                    ) : (
                      <PreviewDocument
                        title={item.title}
                        channel={item.channel}
                        headingLevel={2}
                        starter={index === 1 ? "Theo" : "Rafael"}
                        agent={index === 1 ? "Codex" : "Lor"}
                      >
                        <Conversation scene={index} />
                      </PreviewDocument>
                    )}
                  </div>
                  {index === 1 || index === 3 ? (
                    <PreviewDetails
                      plan={[...item.plan]}
                      files={[...item.files]}
                      context={
                        index === 1
                          ? "launch · 4 messages"
                          : "launch · Friday launch"
                      }
                    />
                  ) : null}
                </div>
              </div>
            </MockShell>
          </div>
        ))}
      </div>
      <p
        aria-live={paused || reducedMotion ? "polite" : "off"}
        aria-atomic="true"
        className="mt-5 min-h-10 px-1 text-sm leading-relaxed text-muted-foreground"
      >
        {scene.caption}
      </p>
    </div>
  )
}
