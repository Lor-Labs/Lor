import { ReviewChangesCard, WorkLog } from "@/app/components/mock-parts"
import { Reveal } from "@/app/components/reveal"
import { ChannelWorkflow } from "@/app/components/workspace-apps"
import {
  PreviewDocument,
  PreviewFrame,
  PreviewTurn,
} from "@/app/components/workspace-preview"

function BuildTogether() {
  return (
    <section id="vision" className="scroll-mt-8 px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-24">
        <Reveal>
          <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
            Take the conversation into code.
          </h2>
          <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Take a shared conversation into your repo. Inspect files and diffs,
            review with teammates, then commit and push with your own GitHub
            account.
          </p>
          <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Fork to try another approach, or rewind to an earlier turn with the
            code and conversation together.
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
    <section className="border-t border-foreground/[0.07] px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-24">
        <Reveal className="order-2 lg:order-1">
          <PreviewFrame>
            <ChannelWorkflow />
          </PreviewFrame>
        </Reveal>
        <Reveal className="order-1 lg:order-2">
          <h2 className="max-w-[18ch] text-balance text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]">
            Work it out once. Turn it into a Loop.
          </h2>
          <p className="mt-7 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            Connect tools like GitHub, Linear, Notion, and Attio. Give Lor your
            team&rsquo;s criteria to research accounts, update the CRM, or
            prepare a report.
          </p>
          <p className="mt-5 max-w-[40ch] text-[17px] leading-relaxed text-muted-foreground">
            A Loop runs that workflow automatically on a schedule, like every
            Monday morning. Your team can follow along and review actions that
            need approval.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

export function VisionSections() {
  return (
    <>
      <BuildTogether />
      <TeamKnowHow />
    </>
  )
}
