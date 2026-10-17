import { HashtagIcon, LockKeyIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AgentAvatar,
  ChatLine,
  FileCard,
  PersonAvatar,
  RAFAEL,
  THEO,
  Turn,
  WorkLog,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Reveal } from "@/app/components/reveal"
import { SessionTitle } from "@/app/components/week-in-gtm"

// The problem, shown: Zoe's agent setup only runs on her laptop, so the team
// waits on her. Next to it, the same job in a #gtm session anyone can start.
// Replaces problem-visual.tsx (private chats), which is kept but not rendered.

function LaptopTerminal() {
  return (
    <div className="w-full max-w-[400px] overflow-hidden rounded-xl border border-lor-border-dark bg-lor-sidebar-dark shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-1.5 border-lor-border-dark/70 border-b px-3 py-2 text-[11.5px] text-lor-text-tertiary-dark">
        <span className="size-2 rounded-full bg-lor-danger-dark/80" />
        <span className="size-2 rounded-full bg-warning/80" />
        <span className="size-2 rounded-full bg-lor-success-dark/80" />
        <span className="ml-2">zoe@macbook: ~/gtm</span>
        <HugeiconsIcon icon={LockKeyIcon} size={12} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-1.5 p-3.5 font-mono text-[11.5px] text-lor-text-secondary-dark leading-relaxed">
        <p>
          <span className="text-agent">~/gtm</span> $ claude
        </p>
        <p className="text-lor-text-dark">
          &gt; pull this week&rsquo;s leads and draft intros
        </p>
        <p>● Ran scripts/enrich-leads.ts</p>
        <p>● Read playbook.md</p>
        <p className="text-lor-success-dark">
          42 leads, 12 new. Drafts saved to drafts/
        </p>
      </div>
    </div>
  )
}

function WaitingThread() {
  return (
    <div className="w-full max-w-[360px] rounded-xl border border-lor-border-dark bg-lor-bg-dark px-3.5 pt-2.5 pb-3.5 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8)]">
      <p className="flex items-center gap-1 text-[11.5px] text-lor-text-tertiary-dark">
        <HugeiconsIcon icon={HashtagIcon} size={12} />
        gtm
      </p>
      <ChatLine avatar={THEO} name="Theo" time="9:41 AM">
        can someone run the lead thing?
      </ChatLine>
      <ChatLine avatar={RAFAEL} name="Rafael" time="9:52 AM">
        only Zoe has it set up
      </ChatLine>
      <ChatLine avatar={ZOE} name="Zoe" time="10:03 AM">
        on a plane til tonight, sorry
      </ChatLine>
    </div>
  )
}

function SharedRun() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left">
        <SessionTitle
          title="This week's leads"
          meta={
            <>
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              gtm · Started by Theo
            </>
          }
          faces={[THEO, RAFAEL]}
        />
        <Turn avatar={<PersonAvatar src={THEO} />}>
          Run Zoe&rsquo;s lead pull for this week.
        </Turn>
        <Turn avatar={<AgentAvatar />}>
          <WorkLog label="Worked" detail="ran scripts/enrich-leads.ts" />
          <p className="mt-2">
            42 leads, 12 new. The drafts follow Zoe&rsquo;s playbook.
          </p>
          <FileCard name="drafts/" detail="12 drafts" />
        </Turn>
        <Turn avatar={<PersonAvatar src={RAFAEL} />}>
          Nice. I&rsquo;ll take the fintech ones.
        </Turn>
      </div>
    </MockShell>
  )
}

export function LaptopProblem() {
  return (
    <section
      id="why"
      className="relative mx-auto w-full max-w-6xl scroll-mt-16 px-6 py-24"
    >
      <Reveal>
        <h2 className="max-w-[20ch] text-balance font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          Your best workflow lives on one laptop.
        </h2>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 items-center gap-16 md:grid-cols-[7fr_5fr] md:gap-12">
        <Reveal delay={120}>
          <p className="font-medium text-[13px] text-muted-foreground">Today</p>
          <div aria-hidden className="mt-4 flex flex-col">
            <LaptopTerminal />
            <div className="mt-4 md:-mt-6 md:ml-auto md:mr-6">
              <WaitingThread />
            </div>
          </div>
        </Reveal>
        <Reveal delay={240}>
          <p className="font-medium text-[13px] text-muted-foreground">
            With Lor
          </p>
          <div className="mt-4">
            <SharedRun />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
