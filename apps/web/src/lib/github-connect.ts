import { toast } from "@repo/ui/components/toast"
import { GITHUB_CONNECT_RETURN_KEY } from "@/hooks/use-personal-accounts"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// Where the GitHub setup page goes after an install started from another page
// (New session). Unset, it opens the GitHub connector's settings.
const GITHUB_INSTALL_RETURN_KEY = "lor:github-install-return"

export function takeGithubInstallReturn(): string | null {
  try {
    const back = localStorage.getItem(GITHUB_INSTALL_RETURN_KEY)
    localStorage.removeItem(GITHUB_INSTALL_RETURN_KEY)
    return back
  } catch {
    return null
  }
}

export async function errorMessage(res: Response, fallback: string) {
  try {
    const body = (await res.json()) as { message?: unknown }
    return typeof body.message === "string" ? body.message : fallback
  } catch {
    return fallback
  }
}

async function startGithubConnect(workspaceSlug: string) {
  const res = await apiClient.v1.workspaces[
    ":workspaceSlug"
  ].integrations.github["connect-url"].$post({ param: { workspaceSlug } })
  if (!res.ok) {
    throw new Error(await errorMessage(res, "Couldn't start connecting GitHub"))
  }
  return res.json()
}

// GitHub's install URL is minted on click so the server can record which
// workspace this connect is for: a reconnect through GitHub's configure page
// can come back without `state`. Without a linked GitHub account the server
// sends the person to link it first; the account callback then continues here
// with continueGithubConnect.
export async function openGithubConnect(
  workspaceSlug: string,
  returnTo?: string
) {
  try {
    const { url, step } = await startGithubConnect(workspaceSlug)
    try {
      if (returnTo) localStorage.setItem(GITHUB_INSTALL_RETURN_KEY, returnTo)
      else localStorage.removeItem(GITHUB_INSTALL_RETURN_KEY)
      // A cancelled account link comes back to this page.
      if (step === "account") {
        localStorage.setItem(
          GITHUB_CONNECT_RETURN_KEY,
          window.location.pathname + window.location.search
        )
      }
    } catch {}
    openExternal(url)
  } catch (err) {
    toast.error(
      err instanceof Error ? err.message : "Couldn't start connecting GitHub"
    )
  }
}

// Runs on the account callback page, which is always a browser tab (the
// desktop app links accounts in the system browser). Replacing it keeps the
// spent OAuth code out of history.
export async function continueGithubConnect(workspaceSlug: string) {
  const { url, step } = await startGithubConnect(workspaceSlug)
  if (step !== "install") throw new Error("Couldn't link your GitHub account")
  window.location.replace(url)
}
