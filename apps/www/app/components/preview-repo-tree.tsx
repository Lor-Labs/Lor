import {
  ArrowRight01Icon,
  File01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useId } from "react"
import { PREVIEW_REPO } from "@/app/components/preview-repo"

type TreeNode = {
  name: string
  path: string
  fileIndex?: number
  children: Map<string, TreeNode>
}

function buildTree() {
  const root: TreeNode = { name: "", path: "", children: new Map() }
  PREVIEW_REPO.forEach((file, fileIndex) => {
    let node = root
    const parts = file.path.split("/")
    parts.forEach((name, index) => {
      let child = node.children.get(name)
      if (!child) {
        child = {
          name,
          path: parts.slice(0, index + 1).join("/"),
          fileIndex: index === parts.length - 1 ? fileIndex : undefined,
          children: new Map(),
        }
        node.children.set(name, child)
      }
      node = child
    })
  })
  return root
}

const ROOT = buildTree()
const byName = new Intl.Collator("en", { numeric: true })
const ROW_CLASS =
  "flex min-h-7 w-full cursor-pointer touch-manipulation items-center gap-1.5 pr-3 text-left text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-agent [@media(pointer:coarse)]:min-h-9"

function ModifiedMark() {
  return (
    <span
      title="Modified"
      aria-label="Modified"
      className="ml-auto flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-warning text-warning"
    >
      <span className="size-1 rounded-full bg-current" />
    </span>
  )
}

export function PreviewRepoTree({
  filter,
  expanded,
  changedPaths,
  selectedPath,
  onToggle,
  onOpen,
}: {
  filter: string
  expanded: ReadonlySet<string>
  changedPaths: string[]
  selectedPath?: string
  onToggle: (path: string) => void
  onOpen: (index: number) => void
}) {
  const id = useId()
  const query = filter.trim().toLowerCase()
  const highlight = (path: string) =>
    path === selectedPath
      ? "bg-foreground/[0.06]"
      : "hover:bg-foreground/[0.04]"

  function renderLevel(node: TreeNode, depth: number) {
    return [...node.children.values()]
      .sort((a, b) => {
        const folderOrder =
          Number(a.fileIndex !== undefined) - Number(b.fileIndex !== undefined)
        return folderOrder || byName.compare(a.name, b.name)
      })
      .map((child) => {
        const index = child.fileIndex
        const isFolder = index === undefined
        const open = expanded.has(child.path)
        const modified = changedPaths.includes(child.path)
        const hasChanges =
          isFolder &&
          changedPaths.some((path) => path.startsWith(`${child.path}/`))
        return (
          <li key={child.path}>
            <button
              type="button"
              data-preview-target={
                child.path === "src/components"
                  ? "folder"
                  : child.path === "src/components/export-button.tsx"
                    ? "source"
                    : undefined
              }
              onClick={() => (isFolder ? onToggle(child.path) : onOpen(index))}
              aria-expanded={isFolder ? open : undefined}
              aria-controls={isFolder ? `${id}-${child.path}` : undefined}
              aria-current={
                !isFolder && selectedPath === child.path ? "true" : undefined
              }
              style={{ paddingLeft: 12 + depth * 12 }}
              className={`${ROW_CLASS} ${highlight(child.path)}`}
            >
              {isFolder ? (
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  className={`size-3 shrink-0 text-lor-text-tertiary-dark ${open ? "rotate-90" : ""}`}
                  strokeWidth={2}
                />
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <HugeiconsIcon
                icon={isFolder ? Folder01Icon : File01Icon}
                className="size-3.5 shrink-0 text-lor-text-tertiary-dark"
                strokeWidth={2}
              />
              <span className="min-w-0 truncate">{child.name}</span>
              {modified ? (
                <ModifiedMark />
              ) : hasChanges ? (
                <span
                  title="Contains changes"
                  className="mr-1 ml-auto size-1.5 shrink-0 rounded-full bg-warning"
                />
              ) : null}
            </button>
            {isFolder ? (
              <ul id={`${id}-${child.path}`} hidden={!open}>
                {renderLevel(child, depth + 1)}
              </ul>
            ) : null}
          </li>
        )
      })
  }

  const matches = PREVIEW_REPO.map((file, index) => ({ file, index })).filter(
    ({ file }) => file.path.toLowerCase().includes(query)
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
      {query ? (
        matches.length ? (
          <ul aria-label="Matching files">
            {matches.map(({ file, index }) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onOpen(index)}
                  title={file.path}
                  aria-current={selectedPath === file.path ? "true" : undefined}
                  className={`${ROW_CLASS} px-3 ${highlight(file.path)}`}
                >
                  <span className="shrink-0">{file.name}</span>
                  <span className="min-w-0 truncate text-xs text-lor-text-tertiary-dark [direction:rtl]">
                    <bdi>{file.path.slice(0, -(file.name.length + 1))}</bdi>
                  </span>
                  {changedPaths.includes(file.path) ? <ModifiedMark /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-6 text-center text-xs text-lor-text-tertiary-dark">
            No files match.
          </p>
        )
      ) : (
        <ul aria-label="Repository files">{renderLevel(ROOT, 0)}</ul>
      )}
    </div>
  )
}
