"use client"

import {
  ArrowRight01Icon,
  BookOpen01Icon,
  Calendar03Icon,
  DashboardSquare01Icon,
  Globe02Icon,
  HashtagIcon,
  Link01Icon,
  Mail01Icon,
  PencilEdit02Icon,
  SourceCodeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useId, useState } from "react"
import { PersonAvatar, RAFAEL, THEO, ZOE } from "@/app/components/mock-parts"

const PEOPLE = [
  { name: "Zoe", avatar: ZOE, ring: "ring-[#b8a4dd]" },
  { name: "Theo", avatar: THEO, ring: "ring-[#dec295]" },
  { name: "Rafael", avatar: RAFAEL, ring: "ring-[#a7c9ba]" },
]

function ReadyBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#b5d1bd]">
      <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
      Ready
    </span>
  )
}

function LaunchAsset({ kind }: { kind: "page" | "docs" }) {
  const isPage = kind === "page"
  return (
    <div className="min-w-0 rounded-2xl bg-foreground/[0.035] p-1.5 ring-1 ring-inset ring-foreground/[0.07]">
      <div
        aria-hidden="true"
        className={`relative h-28 overflow-hidden rounded-[11px] px-4 pt-3.5 ${isPage ? "bg-[#dcd3e8] text-[#443451]" : "bg-[#dce2d7] text-[#3c4c3f]"}`}
      >
        {isPage ? (
          <>
            <div className="flex items-center justify-between text-[8px] font-semibold">
              <span>Kestrel</span>
              <span className="rounded-full bg-white/45 px-2 py-0.5 text-[7px] font-normal">
                Get started
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <p className="text-[22px] font-medium leading-[1.05] tracking-[-0.04em]">
                Better with
                <br />
                your team.
              </p>
              <div className="flex -space-x-3 pr-1">
                {[ZOE, THEO, RAFAEL].map((person, index) => (
                  <PersonAvatar
                    key={person}
                    src={person}
                    size="size-8"
                    className={`ring-[3px] ring-[#dcd3e8] ${index === 1 ? "-translate-y-2" : ""}`}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="text-[8px] font-medium opacity-65">
              Kestrel / Help center
            </p>
            <p className="mt-3 text-[17px] font-medium tracking-tight">
              Invite your team
            </p>
            <div className="mt-2.5 space-y-1.5 text-[9px]">
              <p className="flex items-center gap-1.5">
                <HugeiconsIcon icon={BookOpen01Icon} size={10} /> Sending your
                first invite
              </p>
              <p className="flex items-center gap-1.5 opacity-65">
                <HugeiconsIcon icon={BookOpen01Icon} size={10} /> Roles and
                permissions
              </p>
            </div>
          </>
        )}
      </div>
      <div className="px-2.5 pt-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-lor-text-dark">
            <HugeiconsIcon
              icon={isPage ? Globe02Icon : BookOpen01Icon}
              size={13}
              className="text-lor-text-tertiary-dark"
            />
            {isPage ? "Landing page" : "Help docs"}
          </p>
          <ReadyBadge />
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-lor-text-secondary-dark">
          <PersonAvatar src={isPage ? ZOE : RAFAEL} size="size-4" />
          {isPage ? "Zoe · Design" : "Rafael · Customer success"}
        </p>
      </div>
    </div>
  )
}

export function LaunchChecklist({
  headingLevel = 3,
}: {
  headingLevel?: 2 | 3
}) {
  const [qaReady, setQaReady] = useState(false)
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState("Team invites are here.")
  const [draft, setDraft] = useState(
    "Invite your teammates to Kestrel and work in the same project. You’ll find the invite button at the top of your workspace."
  )
  const [activity, setActivity] = useState({
    avatar: ZOE,
    text: "Zoe updated the landing page.",
  })
  const editorId = useId()
  const Heading = headingLevel === 2 ? "h2" : "h3"

  function finishEditing() {
    setEditing(false)
    setActivity({ avatar: RAFAEL, text: "Rafael updated the email draft." })
  }

  function toggleQa() {
    const ready = !qaReady
    setQaReady(ready)
    setActivity({
      avatar: THEO,
      text: ready
        ? "Theo signed off on QA. The email is clear to send."
        : "Theo reopened QA. The email is on hold.",
    })
  }

  return (
    <div className="@container flex min-w-0 flex-1 flex-col bg-lor-bg-dark text-left">
      <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-lor-border-dark/60 px-4 py-2 text-[11px] text-lor-text-tertiary-dark">
        <HugeiconsIcon icon={HashtagIcon} size={14} />
        <span>launch</span>
        <span className="mx-1 opacity-50">/</span>
        <HugeiconsIcon icon={DashboardSquare01Icon} size={14} />
        <span className="text-lor-text-secondary-dark">Launch checklist</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px]">
          <span className="size-1 rounded-full bg-[#b5d1bd]" />
          Shared with #launch
        </span>
      </div>

      <div className="flex-1 px-4 pt-6 pb-5 @md:px-6 @lg:px-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="mb-2 text-[11px] text-lor-text-secondary-dark">
              Team invites
            </p>
            <Heading className="text-[30px] font-medium leading-none tracking-[-0.04em] text-lor-text-dark @lg:text-[34px]">
              Friday&rsquo;s launch
            </Heading>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-lor-text-tertiary-dark">
              <HugeiconsIcon icon={Calendar03Icon} size={13} />
              Friday, 10:00 AM
              <span className="mx-1 opacity-50">·</span>
              <span className={qaReady ? "text-[#b5d1bd]" : "text-[#dec295]"}>
                {qaReady ? "Ready when you are" : "One last check to go"}
              </span>
            </p>
          </div>
          <div className="pt-1 @md:text-right">
            <div className="flex items-center gap-2.5">
              <div className="flex -space-x-1.5">
                {PEOPLE.map((person) => (
                  <span
                    key={person.name}
                    title={`${person.name} is here`}
                    className="rounded-full bg-lor-bg-dark p-1"
                  >
                    <PersonAvatar
                      src={person.avatar}
                      size="size-6"
                      className={`ring-[1.5px] ring-offset-2 ring-offset-lor-bg-dark ${person.ring}`}
                    />
                  </span>
                ))}
              </div>
              <span className="text-[11px] text-lor-text-secondary-dark">
                3 here
              </span>
            </div>
            <p className="mt-3 text-[10px] text-lor-text-tertiary-dark">
              <span className="font-medium tabular-nums text-lor-text-secondary-dark">
                {qaReady ? 4 : 3}/4
              </span>{" "}
              ready for launch
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 @min-[720px]:grid-cols-[minmax(0,1.65fr)_minmax(250px,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid gap-3 @min-[440px]:grid-cols-2">
              <LaunchAsset kind="page" />
              <LaunchAsset kind="docs" />
            </div>

            <div
              className={`flex flex-1 flex-col rounded-2xl p-4 ring-1 ring-inset transition-colors duration-200 motion-reduce:transition-none ${qaReady ? "bg-[#b5d1bd]/[0.04] ring-[#b5d1bd]/15" : "bg-[#dec295]/[0.045] ring-[#dec295]/15"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-lor-text-secondary-dark">
                  <HugeiconsIcon icon={SourceCodeIcon} size={14} />
                  Engineering
                </p>
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[9px] ${qaReady ? "bg-[#b5d1bd]/10 text-[#b5d1bd]" : "bg-[#dec295]/10 text-[#dec295]"}`}
                >
                  <span className="size-1 rounded-full bg-current" />
                  {qaReady ? "Signed off" : "In review"}
                </span>
              </div>
              <p className="mt-3 text-[16px] font-medium tracking-tight text-lor-text-dark">
                Final QA
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] text-lor-text-secondary-dark">
                {["Invites", "Permissions"].map((label) => (
                  <span key={label} className="flex items-center gap-1">
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={11}
                      className="text-[#b5d1bd]"
                    />
                    {label}
                  </span>
                ))}
                <span
                  className={`flex items-center gap-1 ${qaReady ? "text-lor-text-secondary-dark" : "text-[#dec295]"}`}
                >
                  {qaReady ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={11}
                      className="text-[#b5d1bd]"
                    />
                  ) : (
                    <span className="mx-0.5 size-1.5 rounded-full border border-current" />
                  )}
                  Mobile
                </span>
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
                <p className="flex items-center gap-2 text-[10px] text-lor-text-secondary-dark">
                  <PersonAvatar src={THEO} size="size-6" />
                  <span>
                    <span className="text-lor-text-dark">Theo</span>
                    <br />
                    {qaReady ? "All checks passed" : "Checking mobile invites"}
                  </span>
                </p>
                <button
                  type="button"
                  aria-label={
                    qaReady ? "Reopen final QA" : "Mark final QA ready"
                  }
                  onClick={toggleQa}
                  className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-[11px] font-medium transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent motion-reduce:transition-none ${qaReady ? "bg-foreground/5 text-lor-text-secondary-dark hover:bg-foreground/10" : "bg-[#e5ddcf] text-[#302c25] hover:bg-[#eee8df]"}`}
                >
                  {qaReady ? "Reopen QA" : "Mark ready"}
                  <HugeiconsIcon
                    icon={qaReady ? SourceCodeIcon : Tick02Icon}
                    size={13}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col rounded-2xl bg-foreground/[0.035] p-1.5 ring-1 ring-inset ring-foreground/[0.07]">
            <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-lor-text-dark">
                <HugeiconsIcon
                  icon={Mail01Icon}
                  size={14}
                  className="text-lor-text-tertiary-dark"
                />
                Customer email
              </p>
              <button
                type="button"
                aria-label={editing ? "Save email draft" : "Edit email draft"}
                aria-expanded={editing}
                aria-controls={editorId}
                onClick={() => (editing ? finishEditing() : setEditing(true))}
                className="flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-lg text-lor-text-secondary-dark transition-colors duration-150 hover:bg-foreground/5 hover:text-lor-text-dark focus-visible:outline-2 focus-visible:outline-agent"
              >
                <HugeiconsIcon
                  icon={editing ? Tick02Icon : PencilEdit02Icon}
                  size={14}
                />
              </button>
            </div>
            <div
              id={editorId}
              className="flex flex-1 flex-col rounded-[11px] bg-[#ece9e1] px-4 pt-4 pb-5 text-[#37392f]"
            >
              <p className="border-b border-black/[0.08] pb-3 text-[10px] text-[#77786e]">
                To <span className="ml-2 text-[#53554a]">All customers</span>
              </p>
              {editing ? (
                <>
                  <label htmlFor={`${editorId}-subject`} className="sr-only">
                    Email subject
                  </label>
                  <input
                    id={`${editorId}-subject`}
                    value={subject}
                    maxLength={100}
                    onChange={(event) => setSubject(event.target.value)}
                    className="mt-4 w-full rounded bg-white/60 px-2 py-1.5 text-base font-medium leading-snug tracking-tight outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#9c84bb]"
                  />
                  <label htmlFor={`${editorId}-body`} className="sr-only">
                    Email body
                  </label>
                  <textarea
                    id={`${editorId}-body`}
                    value={draft}
                    maxLength={400}
                    onChange={(event) => setDraft(event.target.value)}
                    className="mt-3 min-h-28 w-full resize-y rounded bg-white/60 p-2 text-base leading-relaxed outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#9c84bb]"
                  />
                  <button
                    type="button"
                    onClick={finishEditing}
                    className="mt-3 min-h-9 cursor-pointer self-start rounded-md bg-[#37392f] px-3 text-[11px] font-medium text-[#ece9e1] hover:bg-[#4a4d40] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9c84bb]"
                  >
                    Save draft
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-4 break-words text-[20px] font-medium leading-[1.2] tracking-[-0.025em]">
                    {subject || "Untitled email"}
                  </p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-[1.75] text-[#727469]">
                    {draft || "Your draft is empty."}
                  </p>
                  <span className="mt-5 inline-flex items-center gap-2 self-start rounded-md bg-[#d6dcce] px-2.5 py-2 text-[9px] font-medium">
                    Invite your team
                    <HugeiconsIcon icon={ArrowRight01Icon} size={11} />
                  </span>
                </>
              )}
              <p className="mt-auto pt-4 text-[9px] text-[#84867c]">
                The Kestrel team
              </p>
            </div>
            <div className="px-2.5 pt-3 pb-2">
              <p className="flex items-center gap-1.5 text-[10px] text-lor-text-secondary-dark">
                <PersonAvatar src={RAFAEL} size="size-4" />
                Rafael · Marketing
                <span className="ml-auto text-lor-text-tertiary-dark">
                  {editing ? "Editing now" : "Draft ready"}
                </span>
              </p>
              <div
                role="status"
                className={`mt-3 flex items-start gap-2 rounded-lg px-2.5 py-2.5 transition-colors duration-200 motion-reduce:transition-none ${qaReady ? "bg-[#b5d1bd]/[0.08] text-[#b5d1bd]" : "bg-[#dec295]/[0.07] text-[#dec295]"}`}
              >
                <HugeiconsIcon
                  icon={qaReady ? Tick02Icon : Link01Icon}
                  size={14}
                  className="mt-0.5 shrink-0"
                />
                <p className="text-[11px] leading-snug">
                  <span className="font-medium">
                    {qaReady ? "Clear to send" : "Waiting on final QA"}
                  </span>
                  <br />
                  <span className="mt-0.5 inline-block text-[10px] text-lor-text-tertiary-dark">
                    {qaReady
                      ? "Theo signed off. Over to you, Rafael."
                      : "Clears when Theo marks QA ready."}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-lor-border-dark/50 px-4 py-3 text-[10px] text-lor-text-tertiary-dark @md:px-6 @lg:px-7">
        <PersonAvatar src={activity.avatar} size="size-4" />
        <span aria-live="polite">{activity.text}</span>
        <span className="ml-auto hidden shrink-0 @sm:inline">Just now</span>
      </div>
    </div>
  )
}
