import {
  GithubIcon,
  GitPullRequestCreateIcon,
  GitPullRequestIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { toast } from "@repo/ui/components/toast"
import { openInNewTab } from "@/lib/open-external"

// The push success toast, GitHub-branded: the mark, the branch as code, and
// the branch's pull request, like Zed.
export function showPushedToast(
  branch: string,
  pullRequest: { url: string; open: boolean } | null
) {
  toast.success(
    <>
      Pushed{" "}
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-[450] font-mono text-xs [overflow-wrap:anywhere]">
        {branch}
      </code>{" "}
      to GitHub
    </>,
    {
      icon: <HugeiconsIcon icon={GithubIcon} strokeWidth={2} />,
      ...(pullRequest
        ? {
            action: {
              label: (
                <>
                  <HugeiconsIcon
                    icon={
                      pullRequest.open
                        ? GitPullRequestIcon
                        : GitPullRequestCreateIcon
                    }
                    strokeWidth={2}
                  />
                  {pullRequest.open
                    ? "View pull request"
                    : "Create pull request"}
                </>
              ),
              onClick: () => openInNewTab(pullRequest.url),
            },
          }
        : {}),
    }
  )
}
