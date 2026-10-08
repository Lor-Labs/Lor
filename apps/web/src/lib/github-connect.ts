import { toast } from "@repo/ui/components/toast"
import { apiClient } from "@/lib/api-client"
import { openExternal } from "@/lib/open-external"

// GitHub's install URL is minted on click so the server can record which
// workspace this connect is for: a reconnect through GitHub's configure page
// can come back without `state`.
export async function openGithubConnect(workspaceSlug: string) {
  try {
    const res = await apiClient.v1.workspaces[
      ":workspaceSlug"
    ].integrations.github["connect-url"].$post({ param: { workspaceSlug } })
    if (!res.ok) throw new Error("Failed to start GitHub connect")
    const { url } = await res.json()
    openExternal(url)
  } catch {
    toast.error("Couldn't start connecting GitHub")
  }
}
