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
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "@tanstack/react-router"
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
  const navigate = useNavigate()

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
      // Land on the overview — the live surface for the archivist's progress.
      navigate({
        to: "/$workspaceSlug/project/$projectId",
        params: { workspaceSlug: workspaceSlug as string, projectId },
      })
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive Project</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to archive{" "}
            <span className="font-semibold">{projectName}</span>? Its channels
            become read-only and Merlin will distill the project into workspace
            memory with a closing summary. This cannot be undone.
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
