"use client"

import {
  GitForkIcon,
  PauseIcon,
  PlayIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { CodeReviewPreview } from "@/app/components/code-review-preview"
import {
  Citation,
  ReviewChangesCard,
  WorkLog,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import {
  PREVIEW_TIMELINES,
  PreviewPlayback,
  PreviewPointer,
  PreviewReveal,
} from "@/app/components/preview-playback"
import {
  PREVIEW_CHANGE_TOTALS,
  PREVIEW_CHANGED_FILES,
} from "@/app/components/preview-repo"
import { TeamChatPreview } from "@/app/components/team-chat-preview"
import {
  PreviewDetails,
  PreviewDocument,
  PreviewSidebar,
  PreviewTurn,
} from "@/app/components/workspace-preview"

const SCENES = [
  {
    label: "Discuss",
    title: "product",
    channel: "product",
    active: "product",
    caption:
      "A customer gets stuck. Zoe brings the question to #product, and Rafael adds what he knows.",
    plan: [],
    files: [],
  },
  {
    label: "Investigate",
    title: "Why do exports feel stuck?",
    channel: "product",
    active: "Investigate exports",
    caption:
      "Zoe and Theo investigate together. Fork from Lor’s reply to take it further.",
    plan: [
      "Read the customer notes",
      "Trace the export flow",
      "Suggest a change",
    ],
    files: ["export-findings.md"],
  },
  {
    label: "Fork",
    title: "Export fix (fork)",
    channel: "product",
    active: "Export fix (fork)",
    caption: "Theo forks the investigation, then takes his branch into code.",
    plan: ["Keep the original research", "Explore the export fix"],
    files: ["export-findings.md"],
  },
  {
    label: "Build",
    title: "Fix export feedback",
    channel: "product",
    active: "Fix export feedback",
    caption:
      "The fork becomes a code session, with the investigation attached.",
    plan: [
      "Read the investigation",
      "Add the export state",
      "Handle a failed download",
    ],
    files: ["export-button.tsx", "export-panel.tsx"],
  },
  {
    label: "Review",
    title: "Fix export feedback",
    channel: "product",
    active: "Fix export feedback",
    caption:
      "Review the diff, stage the files, and commit with your own GitHub account.",
    plan: [],
    files: [],
  },
  {
    label: "Remember",
    title: "Why did we change exports?",
    channel: "product",
    active: "The export decision",
    caption:
      "The next person can find both the change and the reason behind it, without another handover.",
    plan: ["Find the customer feedback", "Read the investigation"],
    files: ["export-findings.md"],
  },
] as const

function Conversation({
  scene,
  onFork,
  onContinueInCode,
  onReview,
}: {
  scene: number
  onFork?: () => void
  onContinueInCode?: () => void
  onReview?: () => void
}) {
  if (scene === 1)
    return (
      <>
        <PreviewTurn person="Zoe">
          Why does Paygrove think exports are stuck? Read the customer notes and
          look at how the export works.
        </PreviewTurn>
        <PreviewTurn
          person="Lor"
          onFork={onFork}
          revealAt={1}
          answerAt={3}
          workingDetail="Reading customer notes · Tracing the export flow"
        >
          <WorkLog
            label="Worked"
            detail="Read Notion notes · Traced the export flow"
          />
          <p className="mt-3">
            The download is still preparing, but the button keeps saying
            &ldquo;Export CSV.&rdquo; Each click starts another request.
            <Citation>Export flow</Citation>
          </p>
          <p className="mt-3">
            Show that it&rsquo;s preparing and disable the button until it
            finishes.
          </p>
        </PreviewTurn>
        <PreviewTurn person="Theo" aside revealAt={4}>
          Keep the retry if a download fails. I&rsquo;ll fork this and work on
          the fix.
        </PreviewTurn>
      </>
    )
  if (scene === 2)
    return (
      <>
        <PreviewTurn person="Theo">
          Let&rsquo;s start with the smaller fix. We can explore background
          exports separately.
        </PreviewTurn>
        <PreviewTurn person="Lor" revealAt={1}>
          Show &ldquo;Preparing…&rdquo; while the request runs, then restore the
          button on success or failure. The export itself can stay as it is.
        </PreviewTurn>
        <PreviewReveal
          at={2}
          className="mt-5 flex items-center gap-1.5 pl-10 text-xs text-lor-text-tertiary-dark"
        >
          <HugeiconsIcon icon={SourceCodeIcon} size={14} />
          <span>Theo continued this in</span>
          <button
            type="button"
            onClick={onContinueInCode}
            data-preview-target="continue"
            className="cursor-pointer font-medium text-lor-text-secondary-dark hover:underline focus-visible:outline-2 focus-visible:outline-agent"
          >
            Fix export feedback
          </button>
        </PreviewReveal>
      </>
    )
  if (scene === 3)
    return (
      <>
        <PreviewTurn person="Theo">
          Make the change we discussed in the fork. Keep the button usable again
          if the download fails.
        </PreviewTurn>
        <PreviewTurn
          person="Lor"
          revealAt={1}
          answerAt={3}
          workingDetail="Reading the investigation · Editing the export controls"
        >
          <WorkLog
            label="Worked"
            detail="Read the investigation · Edited 2 files"
          />
          <p className="mt-3">
            The button now shows &ldquo;Preparing…&rdquo; during an export and
            ignores repeat clicks. It resets when the request finishes or fails.
          </p>
          <PreviewReveal at={4}>
            <ReviewChangesCard
              {...PREVIEW_CHANGE_TOTALS}
              files={PREVIEW_CHANGED_FILES.length}
              onClick={onReview}
            />
          </PreviewReveal>
        </PreviewTurn>
        <PreviewTurn person="Zoe" aside revealAt={5}>
          &ldquo;Preparing&rdquo; is exactly what was missing. Let&rsquo;s keep
          that wording in the help docs too.
        </PreviewTurn>
        <PreviewTurn person="Theo" aside revealAt={6}>
          Agreed. I&rsquo;ll review the diff before I push it.
        </PreviewTurn>
      </>
    )
  if (scene === 5)
    return (
      <>
        <PreviewTurn person="Rafael">
          Why did we disable Export while a download is preparing?
        </PreviewTurn>
        <PreviewTurn
          person="Lor"
          revealAt={1}
          answerAt={2}
          workingDetail="Finding the customer feedback and original decision"
        >
          <WorkLog
            label="Worked"
            detail="Read the customer notes and investigation"
          />
          <p className="mt-3">
            Paygrove couldn&rsquo;t tell whether its export had started.
            Clicking again created duplicate downloads.
            <Citation>Paygrove notes</Citation>
          </p>
          <p className="mt-3">
            Zoe and Theo chose a &ldquo;Preparing…&rdquo; state. The button
            resets after success or failure, so people can still retry.
            <Citation>Export investigation</Citation>
          </p>
        </PreviewTurn>
        <PreviewTurn person="Rafael" revealAt={3}>
          Got it. I can explain that in the next customer handover.
        </PreviewTurn>
      </>
    )
  return null
}

export function WorkspaceStory() {
  const [active, setActive] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [paused, setPaused] = useState(false)
  const [guided, setGuided] = useState(true)
  const [beat, setBeat] = useState(0)
  const [inView, setInView] = useState(false)
  const [pageVisible, setPageVisible] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(true)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const panels = useRef<(HTMLDivElement | null)[]>([])
  const progress = useRef<HTMLSpanElement>(null)
  const progressAnimation = useRef<Animation | null>(null)
  const playbackControl = useRef<HTMLButtonElement>(null)
  const scene = SCENES[active] ?? SCENES[0]
  const running = guided && !paused && inView && pageVisible && !reducedMotion

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
      ([entry]) => setInView(!!entry && entry.intersectionRatio >= 0.2),
      { threshold: 0.2 }
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
    if (!element || reducedMotion || !guided) return
    const timeline = PREVIEW_TIMELINES[active] ?? PREVIEW_TIMELINES[0]
    const animation = element.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: timeline.duration, easing: "linear", fill: "forwards" }
    )
    animation.pause()
    progressAnimation.current = animation
    animation.onfinish = () => {
      if (progressAnimation.current !== animation) return
      setBeat(0)
      setActive((current) => (current + 1) % SCENES.length)
    }
    return () => {
      animation.onfinish = null
      animation.cancel()
      progressAnimation.current = null
    }
  }, [active, cycle, reducedMotion, guided])

  useEffect(() => {
    const animation = progressAnimation.current
    if (!animation || !running) {
      animation?.pause()
      return
    }
    animation.play()
    const elapsed = Number(animation.currentTime ?? 0)
    const timeline = PREVIEW_TIMELINES[active] ?? PREVIEW_TIMELINES[0]
    const timers = timeline.beats.flatMap((time, index) =>
      time > elapsed
        ? [window.setTimeout(() => setBeat(index), time - elapsed)]
        : []
    )
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [active, cycle, reducedMotion, guided, running])

  useEffect(() => {
    const panel = panels.current[active]
    if (!panel || !guided || reducedMotion) return
    for (const scroll of panel.querySelectorAll<HTMLElement>(
      "[data-preview-scroll]"
    ))
      scroll.scrollTop = 0
    const animation = panel.animate(
      [
        { opacity: 0.6, transform: "translateX(8px)" },
        { opacity: 1, transform: "translateX(0)" },
      ],
      {
        duration: 250,
        easing: getComputedStyle(document.documentElement)
          .getPropertyValue("--ease-out")
          .trim(),
      }
    )
    return () => animation.cancel()
  }, [active, cycle, guided, reducedMotion])

  useEffect(() => {
    if (!guided || reducedMotion || !running) return
    const frame = requestAnimationFrame(() => {
      const panel = panels.current[active]
      const targets = panel?.querySelectorAll<HTMLElement>(
        `[data-preview-beat="${beat}"]`
      )
      const target = targets?.[targets.length - 1]
      const scroll = target?.closest<HTMLElement>("[data-preview-scroll]")
      if (!target || !scroll) return
      const bounds = scroll.getBoundingClientRect()
      const rect = target.getBoundingClientRect()
      if (rect.bottom > bounds.bottom - 16) {
        scroll.scrollTo({
          top: scroll.scrollTop + rect.top - bounds.top - 16,
          behavior: "smooth",
        })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, beat, guided, reducedMotion, running])

  function takeControl() {
    setGuided(false)
    setPaused(true)
  }

  function selectScene(index: number) {
    takeControl()
    setActive(index)
    setCycle((current) => current + 1)
  }

  function openScene(index: number) {
    selectScene(index)
    requestAnimationFrame(() => panels.current[index]?.focus())
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
          takeControl()
        }
      }}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="A team working in Lor"
          className="grid w-full grid-cols-3 gap-1 rounded-xl bg-lor-sidebar-dark/80 p-1 ring-1 ring-inset ring-foreground/[0.08] sm:w-auto sm:grid-cols-6"
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
              <span className="relative inline-flex items-center gap-1.5">
                {item.label === "Fork" ? (
                  <HugeiconsIcon icon={GitForkIcon} size={14} />
                ) : null}
                {item.label}
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {!reducedMotion ? (
            <button
              ref={playbackControl}
              type="button"
              aria-label={paused ? "Play demo" : "Pause demo"}
              title={paused ? "Play demo" : "Pause demo"}
              onClick={() => {
                if (!guided) {
                  setGuided(true)
                  setBeat(0)
                  setCycle((current) => current + 1)
                  setPaused(false)
                } else setPaused((current) => !current)
              }}
              className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-xs text-muted-foreground transition-colors duration-150 hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-agent"
            >
              <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} size={16} />
              {paused ? "Play demo" : "Pause demo"}
            </button>
          ) : null}
        </div>
      </div>
      <div
        className="grid"
        onPointerDownCapture={takeControl}
        onWheelCapture={takeControl}
        onClick={takeControl}
        onFocusCapture={takeControl}
      >
        {SCENES.map((item, index) => (
          <PreviewPlayback.Provider
            key={item.label}
            value={{
              guided: guided && !reducedMotion && active === index,
              running: running && active === index,
              beat,
              scene: index,
            }}
          >
            <div
              ref={(element) => {
                panels.current[index] = element
              }}
              id={`${id}-panel-${index}`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${index}`}
              tabIndex={active === index ? 0 : -1}
              aria-hidden={active !== index}
              inert={active !== index}
              className={`relative col-start-1 row-start-1 min-w-0 rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent ${active === index ? "" : "invisible pointer-events-none"}`}
            >
              <MockShell className="h-full" innerClassName="h-full">
                <div className="flex h-[560px] min-h-0 overflow-hidden bg-lor-sidebar-dark text-left sm:h-[650px]">
                  <PreviewSidebar active={item.active} />
                  {index === 3 || index === 4 ? (
                    <CodeReviewPreview
                      initialView={index === 4 ? "all" : "chat"}
                    >
                      {(reviewChanges) => (
                        <Conversation scene={3} onReview={reviewChanges} />
                      )}
                    </CodeReviewPreview>
                  ) : (
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
                      <div className="m-2 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-lor-border-dark/60 md:ml-0">
                        {index === 0 ? (
                          <TeamChatPreview />
                        ) : (
                          <PreviewDocument
                            title={item.title}
                            channel={item.channel}
                            headingLevel={2}
                            starter={
                              index === 1
                                ? "Zoe"
                                : index === 2
                                  ? "Theo"
                                  : "Rafael"
                            }
                            source={
                              index === 2
                                ? { title: "Investigate exports", kind: "fork" }
                                : undefined
                            }
                            onContinueInCode={
                              index === 2 ? () => openScene(3) : undefined
                            }
                          >
                            <Conversation
                              scene={index}
                              onFork={
                                index === 1 ? () => openScene(2) : undefined
                              }
                              onContinueInCode={() => openScene(3)}
                            />
                          </PreviewDocument>
                        )}
                      </div>
                      {item.plan.length > 0 ? (
                        <PreviewDetails
                          plan={[...item.plan]}
                          files={[...item.files]}
                          context={
                            index === 1
                              ? "product · 4 messages"
                              : "Investigate exports"
                          }
                          sourceKind={
                            index === 2
                              ? "fork"
                              : index === 5
                                ? "continue"
                                : undefined
                          }
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              </MockShell>
              <PreviewPointer />
            </div>
          </PreviewPlayback.Provider>
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
