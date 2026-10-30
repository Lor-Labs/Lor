import { BETA_INVITES_LABEL } from "@/app/lib/launch"

const QUESTIONS = [
  {
    question: "When can I try Lor?",
    answer: `Beta invites start ${BETA_INVITES_LABEL}, 2026. Join the waitlist and we’ll email you when your team can get started.`,
  },
  {
    question: "Does joining the waitlist give me access?",
    answer:
      "Not yet. We’re inviting teams gradually, so joining the waitlist doesn’t guarantee access on November 6. Look out for an invitation with the next steps.",
  },
  {
    question: "Who is Lor for?",
    answer:
      "Teams who want to work with AI together. Bring a project, research question, or coding task into a shared session so teammates can contribute and pick up where you left off.",
  },
  {
    question: "Do we need to move all our team chat to Lor?",
    answer:
      "No. Start with one project and use Lor alongside your existing team chat. Your team can try working together in shared AI sessions before moving more of its work over.",
  },
]

export function FAQ() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-24 border-t border-foreground/10 px-5 py-20 sm:px-8 md:py-28"
    >
      <div className="mx-auto grid max-w-[1240px] gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-24">
        <h2
          id="faq-heading"
          className="text-4xl font-medium leading-[1.08] tracking-[-0.04em] md:text-[52px]"
        >
          Before you join.
        </h2>
        <div className="divide-y divide-foreground/10 border-y border-foreground/10">
          {QUESTIONS.map(({ question, answer }) => (
            <details key={question} className="py-5">
              <summary className="cursor-pointer text-lg font-medium focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent">
                {question}
              </summary>
              <p className="mt-4 max-w-[55ch] text-base leading-relaxed text-muted-foreground">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
