import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { GrantedChips } from "@/components/workspace/agent-profiles-section"
import {
  SettingsCard,
  SettingsSection,
} from "@/components/workspace/settings-group"
import type { WorkspaceAgent } from "@/hooks/use-agents"
import { refreshAgents, saveAgent } from "@/lib/agent-api"
import { apiClient } from "@/lib/api-client"

const DEFAULT = "__default__"

// What an agent may use, wherever it works: in its chats, in a Loop with no
// chat, in Discord, and in the code sessions it starts (decision 53). A
// profile picked here, else the workspace's default. Picking saves at once.
export function AgentTools({
  workspaceSlug,
  agent,
  canManage,
}: {
  workspaceSlug: string
  agent: WorkspaceAgent
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["agent-profiles", workspaceSlug],
    queryFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"][
        "agent-profiles"
      ].$get({ param: { workspaceSlug } })
      if (!res.ok) throw new Error("Failed to load profiles")
      return res.json()
    },
  })
  const pick = useMutation({
    mutationFn: (profileId: string) =>
      saveAgent(workspaceSlug, agent.id, {
        agentProfileId: profileId === DEFAULT ? null : profileId,
      }),
    onSuccess: () => refreshAgents(queryClient, workspaceSlug),
    onError: (error) => toast.error(error.message),
  })
  const profileId = agent.agentProfileId ?? DEFAULT
  const custom = data?.profiles.filter((profile) => !profile.isDefault) ?? []
  const shown =
    data?.profiles.find((profile) => profile.id === profileId) ??
    data?.profiles.find((profile) => profile.isDefault) ??
    null
  return (
    <>
      {custom.length > 0 && (
        <SettingsSection title="Profile">
          <SettingsCard>
            <Select
              items={[
                { value: DEFAULT, label: "The workspace's default" },
                ...custom.map((profile) => ({
                  value: profile.id,
                  label: profile.name,
                })),
              ]}
              value={profileId}
              disabled={!canManage || pick.isPending}
              onValueChange={(value) => value && pick.mutate(value)}
            >
              <SelectTrigger aria-label="Tool profile" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT}>The workspace's default</SelectItem>
                {custom.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsCard>
        </SettingsSection>
      )}
      {shown && data && (
        <SettingsSection
          title="Can use"
          caption={
            custom.length === 0
              ? "Add agent profiles in workspace settings to give agents different tools."
              : !canManage
                ? "People who manage chats pick an agent's profile."
                : undefined
          }
        >
          <SettingsCard>
            <GrantedChips profile={shown} groups={data.availableToolGroups} />
          </SettingsCard>
        </SettingsSection>
      )}
    </>
  )
}
