import { BETA_INVITES_LABEL } from "@/app/lib/launch"

const QUESTIONS = [
  {
    question: "When can I try Lor?",
    answer: `We’ll start inviting teams from the waitlist on ${BETA_INVITES_LABEL}, 2026. Access rolls out gradually; we’ll email you when it’s your turn.`,
  },
  {
    question: "Do we need to move all our team chat to Lor?",
    answer:
      "No. Start with one project and use Lor alongside your existing team chat.",
  },
]

export function FAQ() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="scroll-mt-8 border-t border-foreground/10 px-5 py-12 sm:px-8 md:py-16"
    >
      <div className="mx-auto grid max-w-[1240px] gap-6 lg:grid-cols-[1fr_1.2fr] lg:gap-24">
        <h2
          id="faq-heading"
          className="text-2xl font-medium tracking-[-0.03em] md:text-3xl"
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
