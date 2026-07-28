import { ArrowRight, Github } from "lucide-react"

const GITHUB_URL = "https://github.com/BuckyMcYolo/lor"
const SIGNUP_URL = "https://app.lor.chat/signup"

export function ClosingCTA() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 py-32 md:py-40">
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h2 className="text-balance font-semibold text-4xl leading-[1.05] tracking-[-0.03em] md:text-[56px]">
          The lore is yours.
          <br />
          <span className="text-foreground/55">So is your context.</span>
        </h2>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href={SIGNUP_URL}
            className="group inline-flex items-center gap-2 rounded-full bg-primary py-3 pl-6 pr-5 font-medium text-[15px] text-primary-foreground transition-[transform,background-color] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary/95 active:scale-[0.97]"
          >
            Get started
            <ArrowRight
              className="size-4 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
              strokeWidth={1.75}
            />
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-foreground/[0.12] py-3 px-6 font-medium text-[15px] text-foreground/85 transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Github className="size-4" strokeWidth={1.75} />
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  )
}
