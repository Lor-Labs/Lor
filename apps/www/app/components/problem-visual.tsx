import {
  HashtagIcon,
  Infinity01Icon,
  LockKeyIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import type { ReactNode } from "react"
import {
  FileCard,
  LorAvatar,
  PersonAvatar,
  RAFAEL,
  THEO,
  Turn,
  WorkLog,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Reveal } from "@/app/components/reveal"

// The problem, shown instead of told: two private AI chats doing the same
// research and a pasted screenshot, next to one shared session.

function ListBars({ widths }: { widths: number[] }) {
  return (
    <span className="flex flex-col gap-1.5">
      {widths.map((width) => (
        <span
          key={width}
          className="h-1.5 rounded-full bg-foreground/10"
          style={{ width: `${width}%` }}
        />
      ))}
    </span>
  )
}

function PrivateChat({
  avatar,
  owner,
  prompt,
  reply,
  className = "",
}: {
  avatar: string
  owner: string
  prompt: string
  reply: string
  className?: string
}) {
  return (
    <div
      className={`w-full max-w-[330px] overflow-hidden rounded-xl border border-lor-border-dark bg-lor-surface-dark shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8)] ${className}`}
    >
      <div className="flex items-center gap-2 border-lor-border-dark/70 border-b px-3 py-2 text-[11.5px] text-lor-text-tertiary-dark">
        <PersonAvatar src={avatar} size="size-4" />
        {owner}&rsquo;s chat
        <HugeiconsIcon icon={LockKeyIcon} size={12} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-3 p-3 text-[12px]">
        <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-foreground/[0.08] px-3 py-1.5 text-lor-text-dark">
          {prompt}
        </p>
        <div className="flex flex-col gap-2">
          <p className="text-lor-text-secondary-dark">{reply}</p>
          <ListBars widths={[86, 70, 78, 62]} />
        </div>
      </div>
    </div>
  )
}

function ChatLine({
  avatar,
  name,
  time,
  children,
}: {
  avatar: string
  name: string
  time: string
  children: ReactNode
}) {
  return (
    <div className="flex gap-2.5 pt-3">
      <PersonAvatar src={avatar} size="size-6" />
      <div className="min-w-0 text-[12.5px] text-lor-text-dark/90">
        <p className="flex items-baseline gap-1.5">
          <span className="font-medium text-lor-text-dark">{name}</span>
          <span className="text-[10.5px] text-lor-text-tertiary-dark">
            {time}
          </span>
        </p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function PastedThread() {
  return (
    <div className="w-full max-w-[400px] rounded-xl border border-lor-border-dark bg-lor-bg-dark px-3.5 pt-2.5 pb-3.5">
      <p className="flex items-center gap-1 text-[11.5px] text-lor-text-tertiary-dark">
        <HugeiconsIcon icon={HashtagIcon} size={12} />
        gtm
      </p>
      <ChatLine avatar={ZOE} name="Zoe" time="9:41 AM">
        leads for this week
        <span className="mt-1.5 flex w-44 flex-col gap-1.5 rounded-md border border-lor-border-dark bg-foreground/[0.03] p-2.5">
          <ListBars widths={[90, 74, 82]} />
          <span className="pt-1 text-[10px] text-lor-text-tertiary-dark">
            Screenshot 9.40.12 AM.png
          </span>
        </span>
      </ChatLine>
      <ChatLine avatar={THEO} name="Theo" time="9:52 AM">
        oh I made a list too. totally different companies
      </ChatLine>
      <ChatLine avatar={RAFAEL} name="Rafael" time="10:03 AM">
        which one are we using?
      </ChatLine>
    </div>
  )
}

function SharedSession() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-[17px] text-lor-text-dark leading-tight">
              Weekly lead research
            </p>
            <p className="mt-1 flex items-center gap-1 text-[12px] text-lor-text-tertiary-dark">
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              gtm
              <span className="px-0.5 opacity-60">·</span>
              <HugeiconsIcon icon={Infinity01Icon} size={12} />
              Every Monday at 9:00 AM
            </p>
          </div>
          <span className="-space-x-1 flex">
            {[ZOE, THEO, RAFAEL].map((avatar) => (
              <PersonAvatar
                key={avatar}
                src={avatar}
                size="size-5"
                className="ring-2 ring-lor-bg-dark"
              />
            ))}
          </span>
        </div>
        <Turn avatar={<LorAvatar />}>
          12 teams found. 5 are already in Attio, so I skipped them.
          <FileCard name="outreach-drafts.md" detail="7 drafts" />
        </Turn>
        <Turn avatar={<PersonAvatar src={THEO} />}>
          Add Brightpath too. They posted a sales role this morning.
        </Turn>
        <Turn avatar={<LorAvatar />}>
          <WorkLog
            label="Working…"
            detail="Checking Brightpath in Attio"
            working
          />
        </Turn>
      </div>
    </MockShell>
  )
}

export function ProblemVisual() {
  return (
    <section id="why" className="relative mx-auto w-full max-w-6xl px-6 py-24">
      <Reveal>
        <h2 className="font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          Same job, two ways.
        </h2>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 items-center gap-16 md:grid-cols-[7fr_5fr] md:gap-12">
        <Reveal delay={120}>
          <p className="font-medium text-[13px] text-muted-foreground">
            Private chats
          </p>
          <div aria-hidden className="mt-4 flex flex-col">
            <PrivateChat
              avatar={ZOE}
              owner="Zoe"
              prompt="find fintech teams hiring their first AE"
              reply="Here are 10 companies that might fit:"
            />
            <PrivateChat
              avatar={THEO}
              owner="Theo"
              prompt="fintech startups hiring sales reps?"
              reply="Sure! A few options to look at:"
              className="mt-3 ml-auto md:-mt-16 md:mr-6"
            />
            <div className="mt-6 md:-mt-6 md:ml-10">
              <PastedThread />
            </div>
          </div>
        </Reveal>
        <Reveal delay={240}>
          <p className="font-medium text-[13px] text-muted-foreground">
            One session in #gtm
          </p>
          <div className="mt-4">
            <SharedSession />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
