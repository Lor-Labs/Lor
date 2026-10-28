import { toast } from "@repo/ui/components/toast"
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

// GitHub's install URL is minted on click so the server can record which
// workspace this connect is for: a reconnect through GitHub's configure page
// can come back without `state`.
export async function openGithubConnect(
  workspaceSlug: string,
  returnTo?: string
) {
  try {
    const res = await apiClient.v1.workspaces[
      ":workspaceSlug"
    ].integrations.github["connect-url"].$post({ param: { workspaceSlug } })
    if (!res.ok) throw new Error("Failed to start GitHub connect")
    const { url } = await res.json()
    try {
      if (returnTo) localStorage.setItem(GITHUB_INSTALL_RETURN_KEY, returnTo)
      else localStorage.removeItem(GITHUB_INSTALL_RETURN_KEY)
    } catch {}
    openExternal(url)
  } catch {
    toast.error("Couldn't start connecting GitHub")
  }
}
