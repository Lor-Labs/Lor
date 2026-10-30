import {
  Delete02Icon,
  PlusSignIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@repo/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@repo/ui/components/dialog"
import { Input } from "@repo/ui/components/input"
import { Label } from "@repo/ui/components/label"
import { Textarea } from "@repo/ui/components/textarea"
import { toast } from "@repo/ui/components/toast"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { EnvironmentSummary } from "@/hooks/use-environments"
import { apiClient } from "@/lib/api-client"

// Create or edit an environment for one repo
// (reference/dev-environment-runbook.md §2). Saved values stay on the server:
// a row with an empty value keeps its saved one unless someone reveals or
// retypes it.

type Row = { key: string; value: string; saved: boolean }
type FileDraft = { id?: string; path: string; rows: Row[] }

const DEFAULT_PATH = ".env.local"

// KEY=VALUE lines from a pasted .env: comments, `export ` and surrounding
// quotes are dropped.
function parseDotenv(text: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "")
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quoted = value.match(/^(['"])([\s\S]*)\1$/)
    if (quoted) {
      value = quoted[2] ?? ""
      if (quoted[1] === '"') value = value.replace(/\\n/g, "\n")
    } else {
      value = value.replace(/\s+#.*$/, "")
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out.push({ key, value })
  }
  return out
}

function draftFrom(env: EnvironmentSummary | null, repo: string): FileDraft[] {
  const files = env?.repos.find((r) => r.repoFullName === repo)?.files ?? []
  if (files.length === 0) return [{ path: DEFAULT_PATH, rows: [] }]
  return files.map((file) => ({
    id: file.id,
    path: file.path,
    rows: file.keys.map((key) => ({ key, value: "", saved: true })),
  }))
}

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as {
    message?: string
  } | null
  return new Error(body?.message ?? fallback)
}

export function EnvironmentDialog({
  open,
  onOpenChange,
  workspaceSlug,
  repo,
  environment,
  onSaved,
  note,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceSlug: string
  repo: string
  // Null: create.
  environment: EnvironmentSummary | null
  onSaved: (environment: EnvironmentSummary) => void
  note?: string
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [files, setFiles] = useState<FileDraft[]>([])
  const [pasting, setPasting] = useState<number | null>(null)
  const [pasteText, setPasteText] = useState("")

  // Filled once per opening, so a refetch never wipes edits in progress.
  const [filled, setFilled] = useState(false)
  if (open && !filled) {
    setFilled(true)
    setName(environment?.name ?? repo.split("/")[1] ?? repo)
    setFiles(draftFrom(environment, repo))
    setPasting(null)
    setPasteText("")
  } else if (!open && filled) {
    setFilled(false)
  }

  const reveal = useMutation({
    mutationFn: async () => {
      if (!environment) return null
      const res = await apiClient.v1.workspaces[":workspaceSlug"].environments[
        ":environmentId"
      ].reveal.$post({
        param: { workspaceSlug, environmentId: environment.id },
      })
      if (!res.ok) throw await failure(res, "Couldn't reveal the values")
      return res.json()
    },
    onSuccess: (data) => {
      if (!data) return
      setFiles((current) =>
        current.map((file) => {
          const values = new Map(
            data.files
              .find((f) => f.id === file.id)
              ?.variables.map((v) => [v.key, v.value])
          )
          return {
            ...file,
            rows: file.rows.map((row) =>
              row.saved && row.value === "" && values.has(row.key)
                ? { ...row, value: values.get(row.key) ?? "" }
                : row
            ),
          }
        })
      )
    },
    onError: (err) => toast.error(err.message),
  })

  const save = useMutation({
    mutationFn: async () => {
      const payload = files.map((file) => ({
        ...(file.id ? { id: file.id } : {}),
        path: file.path.trim(),
        variables: file.rows
          .filter((row) => row.key.trim())
          .map((row) => ({
            key: row.key.trim(),
            // An untouched saved row keeps its value on the server.
            ...(row.saved && row.value === "" ? {} : { value: row.value }),
          })),
      }))
      const res = environment
        ? await apiClient.v1.workspaces[":workspaceSlug"].environments[
            ":environmentId"
          ].$put({
            param: { workspaceSlug, environmentId: environment.id },
            json: { name: name.trim(), files: payload },
          })
        : await apiClient.v1.workspaces[":workspaceSlug"].environments.$post({
            param: { workspaceSlug },
            json: { name: name.trim(), repo, files: payload },
          })
      if (!res.ok) throw await failure(res, "Couldn't save the environment")
      return (await res.json()).environment
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({
        queryKey: ["environments", workspaceSlug],
      })
      onSaved(saved)
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const updateFile = (index: number, next: Partial<FileDraft>) =>
    setFiles((current) =>
      current.map((file, i) => (i === index ? { ...file, ...next } : file))
    )
  const updateRow = (fileIndex: number, rowIndex: number, next: Partial<Row>) =>
    setFiles((current) =>
      current.map((file, i) =>
        i === fileIndex
          ? {
              ...file,
              rows: file.rows.map((row, r) =>
                r === rowIndex ? { ...row, ...next } : row
              ),
            }
          : file
      )
    )
  const applyPaste = (fileIndex: number) => {
    const parsed = parseDotenv(pasteText)
    setFiles((current) =>
      current.map((file, i) => {
        if (i !== fileIndex) return file
        const byKey = new Map(file.rows.map((row) => [row.key, row]))
        for (const { key, value } of parsed) {
          byKey.set(key, { key, value, saved: byKey.get(key)?.saved ?? false })
        }
        return { ...file, rows: [...byKey.values()] }
      })
    )
    setPasting(null)
    setPasteText("")
  }

  const hasSaved = files.some((file) => file.rows.some((row) => row.saved))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {environment ? "Edit environment" : "New environment"}
          </DialogTitle>
          <DialogDescription>
            Env files Lor writes into {repo} in code sessions that use this
            environment. Lor and the session's terminal can read them, so use
            development credentials.
            {note && <span className="mt-1.5 block">{note}</span>}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="environment-name">Name</Label>
            <Input
              id="environment-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {files.map((file, fileIndex) => (
            <div
              key={file.id ?? `new-${fileIndex}`}
              className="space-y-2 rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  aria-label="File path in the repo"
                  value={file.path}
                  size="sm"
                  className="min-w-0 flex-1 font-mono text-xs"
                  onChange={(e) =>
                    updateFile(fileIndex, { path: e.target.value })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPasting(pasting === fileIndex ? null : fileIndex)
                    setPasteText("")
                  }}
                >
                  Paste .env
                </Button>
                {files.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove file"
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, i) => i !== fileIndex)
                      )
                    }
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                )}
              </div>
              {pasting === fileIndex && (
                <div className="space-y-2">
                  <Textarea
                    autoFocus
                    rows={5}
                    className="font-mono text-xs"
                    placeholder={"DATABASE_URL=postgres://…\nAPI_KEY=…"}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPasting(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!pasteText.trim()}
                      onClick={() => applyPaste(fileIndex)}
                    >
                      Add variables
                    </Button>
                  </div>
                </div>
              )}
              {file.rows.map((row, rowIndex) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until saved, and keys are edited in place
                  key={rowIndex}
                  className="flex items-center gap-2"
                >
                  <Input
                    aria-label="Key"
                    value={row.key}
                    size="sm"
                    placeholder="KEY"
                    className="w-2/5 font-mono text-xs"
                    onChange={(e) =>
                      updateRow(fileIndex, rowIndex, { key: e.target.value })
                    }
                  />
                  <Input
                    aria-label={`Value of ${row.key || "variable"}`}
                    value={row.value}
                    size="sm"
                    placeholder={row.saved ? "Saved value" : "value"}
                    className="min-w-0 flex-1 font-mono text-xs"
                    onChange={(e) =>
                      updateRow(fileIndex, rowIndex, { value: e.target.value })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove variable"
                    onClick={() =>
                      updateFile(fileIndex, {
                        rows: file.rows.filter((_, r) => r !== rowIndex),
                      })
                    }
                  >
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() =>
                  updateFile(fileIndex, {
                    rows: [...file.rows, { key: "", value: "", saved: false }],
                  })
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                Add variable
              </Button>
            </div>
          ))}
          {files.length < 10 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setFiles((current) => [...current, { path: "", rows: [] }])
              }
            >
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Add env file
            </Button>
          )}
        </DialogPanel>
        <DialogFooter>
          {environment && hasSaved && (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              loading={reveal.isPending}
              onClick={() => reveal.mutate()}
            >
              <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
              Reveal values
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            loading={save.isPending}
            disabled={!name.trim() || files.some((f) => !f.path.trim())}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
