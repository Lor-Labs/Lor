import { Citation, WorkLog } from "@/app/components/mock-parts"
import { Reveal } from "@/app/components/reveal"
import { TeamChatPreview } from "@/app/components/team-chat-preview"
import { ChannelWorkflow, FeedbackBoard } from "@/app/components/workspace-apps"
import {
  PreviewDocument,
  PreviewFrame,
  PreviewTurn,
} from "@/app/components/workspace-preview"

function WhyLor() {
  return (
    <section
      id="why"
      className="scroll-mt-20 bg-[#e9e7e2] px-5 py-20 text-[#242321] sm:px-8 md:py-28"
    >
      <div className="mx-auto grid max-w-[1240px] items-start gap-8 lg:grid-cols-2 lg:gap-24">
        <Reveal>
          <h2 className="max-w-[17ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
            A pasted answer leaves a lot out.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <div className="max-w-[43ch] space-y-5 text-[17px] leading-relaxed text-[#65625c]">
            <p>
              You spent the afternoon working something out with AI. Now
              you&rsquo;re pasting the answer into team chat and explaining how
              you got there.
            </p>
            <p className="text-[#242321]">
              Just bring them into the conversation. They can see what you
              tried, ask their own questions, and help finish the job.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function TalkTogether() {
  return (
    <section
      id="team-chat"
      className="border-b border-foreground/[0.07] px-5 py-24 sm:px-8 md:py-28 scroll-mt-24"
    >
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-24">
        <Reveal className="order-2 lg:order-1">
          <PreviewFrame>
            <TeamChatPreview />
          </PreviewFrame>
        </Reveal>
        <Reveal className="order-1 lg:order-2">
          <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
            Some things are easier to talk through.
          </h2>
          <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Send a message, share a file, or jump into a voice call. Your
            team&rsquo;s everyday conversations belong here, too.
          </p>
          <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            See who&rsquo;s around, join them for a few minutes, and keep
            working together while you talk.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function BuildTogether() {
  return (
    <section
      id="vision"
      className="mx-auto grid max-w-[1240px] scroll-mt-24 items-center gap-12 px-5 py-24 sm:px-8 md:py-32 lg:grid-cols-[1fr_1.1fr] lg:gap-24"
    >
      <Reveal>
        <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
          Make the tool you keep wishing you had.
        </h2>
        <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
          Maybe it&rsquo;s a feedback board, or the tracker you&rsquo;ve been
          keeping in a spreadsheet. Describe what you need and start making it.
        </p>
        <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
          Bring an engineer into the chat when you need one. They can take it
          into the codebase with the whole conversation behind them. When
          it&rsquo;s ready, your team can use it right there.
        </p>
      </Reveal>
      <Reveal delay={80}>
        <PreviewFrame>
          <FeedbackBoard />
        </PreviewFrame>
      </Reveal>
    </section>
  )
}

function TeamKnowHow() {
  return (
    <section className="border-y border-foreground/[0.07] px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-24">
        <Reveal className="order-2 lg:order-1">
          <PreviewFrame>
            <ChannelWorkflow />
          </PreviewFrame>
        </Reveal>
        <Reveal className="order-1 lg:order-2">
          <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
            &ldquo;Ask Lor in #gtm. It knows how we do this.&rdquo;
          </h2>
          <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Your team already worked out which accounts matter, what to check,
            and how to write the first email. The next person should be able to
            use all of that.
          </p>
          <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Zoe figured it out last week. Rafael runs it this week. Same
            criteria, same checks, without another walkthrough.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function KeepTheHistory() {
  return (
    <section className="mx-auto grid max-w-[1240px] items-center gap-12 px-5 py-24 sm:px-8 md:py-32 lg:grid-cols-[1fr_1.1fr] lg:gap-24">
      <Reveal>
        <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
          You shouldn&rsquo;t lose what your team has learned.
        </h2>
        <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
          When someone leaves, the next person inherits more than their files.
          They can find out why a customer said no, how a problem got fixed, or
          what the team already tried.
        </p>
        <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
          The answers are in the work you did together. They stay there, even
          when the person who did it is no longer around to ask.
        </p>
      </Reveal>
      <Reveal delay={80}>
        <PreviewFrame>
          <PreviewDocument
            title="Picking up the Paygrove account"
            channel="gtm"
            starter="Rafael"
            agent="Claude Code"
          >
            <PreviewTurn person="Rafael">
              I&rsquo;m taking over Paygrove. Why did we hold off on the pilot?
            </PreviewTurn>
            <PreviewTurn person="Claude Code">
              <WorkLog
                label="Worked"
                detail="Read Zoe's call notes and follow-up"
              />
              <p className="mt-3">
                They wanted to wait until their finance lead started. Zoe agreed
                to pick it back up then, rather than run a pilot without the
                person who&rsquo;d own it.
                <Citation>Paygrove follow-up</Citation>
              </p>
              <p className="mt-3">
                Her notes also cover what they wanted to try first and who needs
                to be involved.
              </p>
            </PreviewTurn>
            <PreviewTurn person="Rafael">
              Got it. Help me put together a follow-up from there.
            </PreviewTurn>
          </PreviewDocument>
        </PreviewFrame>
      </Reveal>
    </section>
  )
}

function AgentChoice() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 sm:px-8">
      <div className="flex flex-col justify-between gap-5 border-y border-foreground/10 py-9 md:flex-row md:items-center md:gap-12">
        <h2 className="max-w-sm text-2xl font-medium tracking-tight">
          Keep the agent you like working with.
        </h2>
        <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">
          Claude Code, Codex, or your own setup. You don&rsquo;t have to change
          how you work with AI to let your teammates join in.
        </p>
      </div>
    </section>
  )
}

export function VisionSections() {
  return (
    <>
      <WhyLor />
      <TalkTogether />
      <BuildTogether />
      <TeamKnowHow />
      <KeepTheHistory />
      <AgentChoice />
    </>
  )
}
