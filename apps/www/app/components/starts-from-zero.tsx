import { HashtagIcon, LockKeyIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AgentAvatar,
  AgentName,
  ChatLine,
  Citation,
  FileCard,
  PersonAvatar,
  RAFAEL,
  THEO,
  ToolStep,
  Turn,
  WorkLog,
  ZOE,
} from "@/app/components/mock-parts"
import { MockShell } from "@/app/components/mock-shell"
import { Reveal } from "@/app/components/reveal"
import { SessionTitle } from "@/app/components/week-in-gtm"

// The problem, shown: private agent sessions never learn from each other, so
// Theo's agent knows nothing and the team re-explains. Next to it, a Lor
// session that reads the channel's other sessions (session-aware search,
// reference/planned/session-memory.md). Replaces laptop-problem.tsx.

function PrivateTerminal() {
  return (
    <div className="w-full max-w-[400px] overflow-hidden rounded-xl border border-lor-border-dark bg-lor-sidebar-dark shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8)]">
      <div className="flex items-center gap-1.5 border-lor-border-dark/70 border-b px-3 py-2 text-[11.5px] text-lor-text-tertiary-dark">
        <span className="size-2 rounded-full bg-lor-danger-dark/80" />
        <span className="size-2 rounded-full bg-warning/80" />
        <span className="size-2 rounded-full bg-lor-success-dark/80" />
        <span className="ml-2">theo@macbook: ~</span>
        <HugeiconsIcon icon={LockKeyIcon} size={12} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-1.5 p-3.5 font-mono text-[11.5px] text-lor-text-secondary-dark leading-relaxed">
        <p>
          <span className="text-agent">~</span> $ codex
        </p>
        <p className="text-lor-text-dark">&gt; draft a follow-up to Tillwise</p>
        <p>
          I don&rsquo;t have any notes on Tillwise. What came up on the call?
        </p>
      </div>
    </div>
  )
}

function ReexplainThread() {
  return (
    <div className="w-full max-w-[360px] rounded-xl border border-lor-border-dark bg-lor-bg-dark px-3.5 pt-2.5 pb-3.5 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8)]">
      <p className="flex items-center gap-1 text-[11.5px] text-lor-text-tertiary-dark">
        <HugeiconsIcon icon={HashtagIcon} size={12} />
        gtm
      </p>
      <ChatLine avatar={THEO} name="Theo" time="9:41 AM">
        what did tillwise ask on the call?
      </ChatLine>
      <ChatLine avatar={ZOE} name="Zoe" time="9:52 AM">
        annual billing. it&rsquo;s somewhere in my claude chats
      </ChatLine>
      <ChatLine avatar={RAFAEL} name="Rafael" time="10:03 AM">
        I priced that with my agent yesterday
      </ChatLine>
    </div>
  )
}

function SharedSession() {
  return (
    <MockShell>
      <div aria-hidden className="px-5 pt-5 pb-5 text-left">
        <SessionTitle
          title="Tillwise follow-up"
          meta={
            <>
              <HugeiconsIcon icon={HashtagIcon} size={12} />
              gtm · Started by Theo
            </>
          }
          faces={[THEO]}
        />
        <Turn avatar={<PersonAvatar src={THEO} />} name="Theo">
          Draft a follow-up to Tillwise.
        </Turn>
        <Turn
          avatar={<AgentAvatar agent="codex" />}
          name={<AgentName agent="codex" />}
        >
          <WorkLog label="Read 2 sessions in #gtm" open>
            <ToolStep
              icon={<PersonAvatar src={ZOE} size="size-3.5" />}
              label="Tillwise intro call · Zoe"
            />
            <ToolStep
              icon={<PersonAvatar src={RAFAEL} size="size-3.5" />}
              label="Annual pricing · Rafael"
            />
          </WorkLog>
          <p className="mt-2">
            They asked about annual billing on Zoe&rsquo;s call
            <Citation>Zoe&rsquo;s session</Citation>, and Rafael priced it at
            $32 a seat yesterday
            <Citation>Rafael&rsquo;s session</Citation>. The draft answers both.
          </p>
          <FileCard name="tillwise-follow-up.md" detail="Draft" />
        </Turn>
      </div>
    </MockShell>
  )
}

export function StartsFromZero() {
  return (
    <section
      id="why"
      className="relative mx-auto w-full max-w-6xl scroll-mt-16 px-6 py-24"
    >
      <Reveal>
        <h2 className="max-w-[20ch] text-balance font-semibold text-3xl leading-[1.08] tracking-[-0.03em] md:text-[40px]">
          Today, every agent starts from zero.
        </h2>
        <p className="mt-4 max-w-xl text-pretty text-[16px] text-muted-foreground leading-relaxed">
          What one person&rsquo;s agent learns stays in their chat. In Lor,
          sessions are shared, so every agent starts with what the others
          already found.
        </p>
      </Reveal>
      <div className="mt-12 grid grid-cols-1 items-center gap-16 md:grid-cols-[7fr_5fr] md:gap-12">
        <Reveal delay={120}>
          <p className="font-medium text-[13px] text-muted-foreground">Today</p>
          <div aria-hidden className="mt-4 flex flex-col">
            <PrivateTerminal />
            <div className="mt-4 md:-mt-4 md:mr-6 md:ml-auto">
              <ReexplainThread />
            </div>
          </div>
        </Reveal>
        <Reveal delay={240}>
          <p className="font-medium text-[13px] text-muted-foreground">
            With Lor
          </p>
          <div className="mt-4">
            <SharedSession />
          </div>
        </Reveal>
      </div>
    </section>
  )
}
