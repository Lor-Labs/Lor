import { Tabs, TabsList, TabsPanel, TabsTab } from "@repo/ui/components/tabs"
import { MembersSection } from "@/components/workspace/members-section"
import { RolesSection } from "@/components/workspace/roles-section"

export function MembersRolesSection({
  workspaceId,
  workspaceSlug,
  canManageRoles,
}: {
  workspaceId: string
  workspaceSlug: string
  canManageRoles: boolean
}) {
  return (
    <Tabs defaultValue="members">
      <TabsList
        variant="underline"
        className="w-full justify-start border-b border-border/60"
      >
        <TabsTab value="members" className="grow-0">
          Members
        </TabsTab>
        {canManageRoles && (
          <TabsTab value="roles" className="grow-0">
            Roles
          </TabsTab>
        )}
      </TabsList>
      <TabsPanel value="members" className="pt-2">
        <MembersSection workspaceSlug={workspaceSlug} />
      </TabsPanel>
      {canManageRoles && (
        <TabsPanel value="roles" className="pt-2">
          <RolesSection
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
          />
        </TabsPanel>
      )}
    </Tabs>
  )
}
