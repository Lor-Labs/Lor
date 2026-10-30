import { StarIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { GitHubLogo } from "@repo/ui/components/logos/github"
import { GITHUB_URL } from "@/app/lib/urls"

async function getStarCount(): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos${new URL(GITHUB_URL).pathname}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Lor-Website",
        },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(3000),
      }
    )
    if (!response.ok) return null

    const data: unknown = await response.json()
    if (
      data &&
      typeof data === "object" &&
      "stargazers_count" in data &&
      typeof data.stargazers_count === "number" &&
      Number.isSafeInteger(data.stargazers_count) &&
      data.stargazers_count >= 0
    ) {
      return data.stargazers_count
    }
  } catch {
    // The repository link stays available when GitHub is slow or rate-limited.
  }
  return null
}

export function GitHubStarLink({ stars = null }: { stars?: number | null }) {
  const label =
    stars === null
      ? "Star Lor on GitHub (opens in a new tab)"
      : `Star Lor on GitHub — ${stars.toLocaleString("en-US")} ${stars === 1 ? "star" : "stars"} (opens in a new tab)`

  return (
    <a
      href={GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-foreground/15 px-3 text-[13px] font-medium text-foreground/80 transition-colors hover:border-foreground/30 hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-agent sm:px-4"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex items-center gap-2">
        <GitHubLogo className="size-4" />
        <span className="hidden lg:inline">Star on GitHub</span>
        {stars !== null ? (
          <span className="flex items-center gap-1.5 border-l border-foreground/15 pl-2 text-foreground/60 tabular-nums">
            <HugeiconsIcon
              icon={StarIcon}
              size={13}
              className="hidden sm:block"
            />
            {new Intl.NumberFormat("en-US", {
              notation: stars >= 1000 ? "compact" : "standard",
              maximumFractionDigits: 1,
            }).format(stars)}
          </span>
        ) : null}
      </span>
    </a>
  )
}

export async function GitHubStars() {
  return <GitHubStarLink stars={await getStarCount()} />
}
