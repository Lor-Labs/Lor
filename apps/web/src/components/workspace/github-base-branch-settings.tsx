import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import { Input } from "@repo/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { apiClient } from "@/lib/api-client"

type RepoRow = {
  fullName: string
  defaultBranch: string
  baseBranch: string | null
}

// Where Lor's code actions open pull requests. No override = the repo's
// default branch; an override makes propose_code_change branch from and target
// it (e.g. teams that merge into dev instead of main).
export function GithubBaseBranchSettings({
  workspaceSlug,
  connectionId,
  repos,
}: {
  workspaceSlug: string
  connectionId: string
  repos: RepoRow[]
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(() => repos[0]?.fullName ?? "")
  const [branch, setBranch] = useState(() => repos[0]?.baseBranch ?? "")
  const selectedRepo = repos.find((r) => r.fullName === selected)
  const overrides = repos.filter((r) => r.baseBranch !== null)

  const update = useMutation({
    mutationFn: async (input: {
      repoFullName: string
      baseBranch: string | null
    }) => {
      const res = await apiClient.v1.workspaces[":workspaceSlug"].integrations[
        ":connectionId"
      ].repos.$patch({
        param: { workspaceSlug, connectionId },
        json: input,
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          message?: string
        } | null
        throw new Error(body?.message ?? "Failed to update the base branch")
      }
    },
    onSuccess: (_data, input) => {
      toast.success(
        input.baseBranch
          ? `Pull requests for ${input.repoFullName} will target ${input.baseBranch}`
          : `${input.repoFullName} reset to its default branch`
      )
      // Resetting the repo currently in the editor must clear the input too,
      // otherwise the stale branch is still there and a later Save recreates
      // the override that was just removed.
      if (input.repoFullName === selected) setBranch(input.baseBranch ?? "")
      return queryClient.invalidateQueries({
        queryKey: ["integrations", workspaceSlug],
      })
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to update the base branch"
      ),
  })

  const submit = () => {
    if (!selectedRepo) return
    const trimmed = branch.trim()
    update.mutate({
      repoFullName: selectedRepo.fullName,
      // Typing the default branch (or clearing the field) resets the override.
      baseBranch:
        trimmed && trimmed !== selectedRepo.defaultBranch ? trimmed : null,
    })
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Lor opens draft pull requests against each repository's default branch.
        Pick a repository to target a different branch instead.
      </p>
      <div className="flex items-center gap-2">
        <Select
          items={repos.map((r) => ({ value: r.fullName, label: r.fullName }))}
          value={selected}
          onValueChange={(value) => {
            if (!value) return
            setSelected(value)
            setBranch(repos.find((r) => r.fullName === value)?.baseBranch ?? "")
          }}
        >
          <SelectTrigger className="min-w-0 flex-1" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {repos.map((r) => (
              <SelectItem key={r.fullName} value={r.fullName}>
                {r.fullName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder={selectedRepo?.defaultBranch ?? "branch"}
          className="w-36 shrink-0"
          disabled={update.isPending}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit()
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={update.isPending || !selectedRepo}
          onClick={submit}
        >
          Save
        </Button>
      </div>
      {overrides.length > 0 && (
        <div className="space-y-1">
          {overrides.map((r) => (
            <div
              key={r.fullName}
              className="flex items-center justify-between gap-2"
            >
              <span className="min-w-0 truncate text-xs text-muted-foreground/80">
                {r.fullName} →{" "}
                <span className="font-medium text-foreground/80">
                  {r.baseBranch}
                </span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 text-muted-foreground"
                aria-label={`Reset ${r.fullName} to its default branch (${r.defaultBranch})`}
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({ repoFullName: r.fullName, baseBranch: null })
                }
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  className="size-3"
                  strokeWidth={2}
                />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
