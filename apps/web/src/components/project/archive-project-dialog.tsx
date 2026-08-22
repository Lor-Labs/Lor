import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog"
import { Button } from "@repo/ui/components/button"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { apiClient } from "@/lib/api-client"

export function ArchiveProjectDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: string
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { workspaceSlug } = useParams({ strict: false })
  const queryClient = useQueryClient()

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].projects[
        ":projectId"
      ].archive.$post({
        param: {
          workspaceSlug: workspaceSlug as string,
          projectId,
        },
      })
      if (!res.ok) {
        throw new Error("Failed to archive project")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", workspaceSlug] })
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceSlug] })
      onOpenChange(false)
    },
  })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive Project</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to archive{" "}
            <span className="font-semibold">{projectName}</span>? Its channels
            become read-only and Merlin will post a closing summary of what was
            decided and shipped. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => archiveMutation.mutate()}
            loading={archiveMutation.isPending}
          >
            Archive Project
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
