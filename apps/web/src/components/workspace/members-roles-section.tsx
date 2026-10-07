import { Tabs, TabsList, TabsPanel, TabsTab } from "@repo/ui/components/tabs"
import { useRef } from "react"
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
  const topRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={topRef} className="scroll-mt-6">
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTab value="members" className="grow-0">
            Members
          </TabsTab>
          {canManageRoles && (
            <TabsTab value="roles" className="grow-0">
              Roles
            </TabsTab>
          )}
        </TabsList>
        <TabsPanel value="members" className="pt-6">
          <MembersSection workspaceSlug={workspaceSlug} />
        </TabsPanel>
        {canManageRoles && (
          <TabsPanel value="roles" className="pt-6">
            <RolesSection
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              onViewChange={() =>
                topRef.current?.scrollIntoView({ block: "start" })
              }
            />
          </TabsPanel>
        )}
      </Tabs>
    </div>
  )
}
