import { AgentChoice } from "@/app/components/agent-choice"
import {
  Citation,
  ReviewChangesCard,
  WorkLog,
} from "@/app/components/mock-parts"
import { Reveal } from "@/app/components/reveal"
import { ChannelWorkflow } from "@/app/components/workspace-apps"
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
              Bring them into the session. They can see the context, add what
              you missed, or fork it to ask their own questions. The work stays
              in a shared place, ready for the next person to pick up.
            </p>
            <p>
              Start with one project. You can use Lor alongside your existing
              team chat.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function BuildTogether() {
  return (
    <section id="vision" className="scroll-mt-24 px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-24">
        <Reveal>
          <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
            Take the conversation into code.
          </h2>
          <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Continue an investigation in a code session with the conversation
            attached. Work in your repo, inspect the files and diffs, then
            commit and push with your own GitHub account.
          </p>
          <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Want to try another approach? Fork from a reply and explore it in a
            new session. Or rewind to an earlier turn, with the code and
            conversation together.
          </p>
        </Reveal>
        <Reveal delay={80}>
          <PreviewFrame>
            <PreviewDocument
              title="Try a background export"
              channel="product"
              starter="Theo"
              repo={{ name: "kestrel/app", branch: "fix/exports" }}
              source={{ title: "Fix export feedback", kind: "fork" }}
            >
              <PreviewTurn person="Theo">
                What if larger exports ran in the background? Let&rsquo;s
                explore that here and keep the original change as it is.
              </PreviewTurn>
              <PreviewTurn person="Lor">
                <WorkLog
                  label="Worked"
                  detail="Read the export code · Drafted another approach"
                />
                <p className="mt-3">
                  This version starts an export job and lets people keep
                  working. They can download the file when it&rsquo;s ready.
                </p>
                <ReviewChangesCard added={42} removed={8} files={3} />
              </PreviewTurn>
              <PreviewTurn person="Zoe" aside>
                Let&rsquo;s compare this with the smaller fix before we decide.
              </PreviewTurn>
            </PreviewDocument>
          </PreviewFrame>
        </Reveal>
      </div>
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
            Work out the process once. Put it to work every week.
          </h2>
          <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Give Lor your team&rsquo;s criteria and connect the tools you use.
            Research accounts, prepare a shortlist, update the CRM, or turn the
            findings into a document the team can use.
          </p>
          <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Run it when you need it, or on a schedule. Teammates can follow the
            work, add context, and review actions that need their approval.
          </p>
          <p className="mt-6 max-w-[40ch] text-sm leading-relaxed text-muted-foreground">
            Connect GitHub, Linear, Notion, Attio, and more. Choose which tools
            Lor can use and which actions require approval.
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
          >
            <PreviewTurn person="Rafael">
              I&rsquo;m taking over Paygrove. Why did we hold off on the pilot?
            </PreviewTurn>
            <PreviewTurn person="Lor">
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

export function VisionSections() {
  return (
    <>
      <WhyLor />
      <BuildTogether />
      <TeamKnowHow />
      <KeepTheHistory />
      <AgentChoice />
    </>
  )
}
