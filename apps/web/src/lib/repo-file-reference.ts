import { z } from "zod"
import { fileTabId, sessionTabLink } from "@/hooks/use-session-tabs"
import { webOrigin } from "@/lib/web-origin"

const REPO_FILE_MIME = "application/x-lor-repo-file"
const sessionMime = (sessionId: string) =>
  `${REPO_FILE_MIME}-${sessionId.toLowerCase()}`

const referenceSchema = z.object({
  workspaceSlug: z
    .string()
    .min(1)
    .max(256)
    .regex(/^[\w-]+$/),
  sessionId: z.uuid(),
  kind: z.enum(["file", "folder"]).optional(),
  path: z
    .string()
    .min(1)
    .max(4096)
    .refine(
      (path) =>
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in file references.
        !/[\u0000-\u001f\u007f]/.test(path) &&
        path.split("/").every((part) => part && part !== "." && part !== "..")
    ),
})

export type RepoFileReference = z.infer<typeof referenceSchema>

export interface ComposerFileReference {
  id: string
  reference: RepoFileReference
  point?: { left: number; top: number }
}

export function repoFileUrl(reference: RepoFileReference) {
  const url =
    reference.kind === "folder"
      ? `${sessionTabLink(reference.workspaceSlug, reference.sessionId, null)}?folder=${encodeURIComponent(reference.path)}`
      : sessionTabLink(
          reference.workspaceSlug,
          reference.sessionId,
          fileTabId(reference.path)
        )
  return url.replaceAll("(", "%28").replaceAll(")", "%29")
}

export function repoFileLabel(reference: RepoFileReference) {
  return `${reference.path}${reference.kind === "folder" ? "/" : ""}`
}

// Ordinary Markdown keeps the full repo path readable by Lor and other clients.
export function repoFileMarkdown(reference: RepoFileReference) {
  const label = repoFileLabel(reference).replace(/[\\`*_[\]<>+&@]/g, "\\$&")
  return `[${label}](${repoFileUrl(reference)})`
}

export function repoFileFromUrl(href: string): RepoFileReference | null {
  try {
    const url = new URL(href)
    if (url.origin !== new URL(webOrigin()).origin) return null
    const match = /^\/([^/]+)\/session\/([^/]+)$/.exec(url.pathname)
    const open = url.searchParams.get("open")
    const folder = url.searchParams.get("folder")
    if (!match || (folder === null && !open?.startsWith("file:"))) return null
    const result = referenceSchema.safeParse({
      workspaceSlug: decodeURIComponent(match[1] ?? ""),
      sessionId: match[2],
      kind: folder !== null ? "folder" : "file",
      path: folder ?? open?.slice(5),
    })
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function writeRepoFileDrag(
  transfer: DataTransfer,
  reference: RepoFileReference
) {
  transfer.effectAllowed = "copy"
  transfer.setData(REPO_FILE_MIME, JSON.stringify(reference))
  // Dragover can read types, but cannot read the payload until drop.
  transfer.setData(sessionMime(reference.sessionId), "")
  transfer.setData("text/plain", repoFileLabel(reference))
  transfer.setData("text/uri-list", repoFileUrl(reference))
}

export function hasRepoFileDrag(transfer: DataTransfer) {
  return transfer.types.includes(REPO_FILE_MIME)
}

export function acceptsRepoFileDrag(
  transfer: DataTransfer,
  sessionId: string | undefined
) {
  return Boolean(
    sessionId &&
      hasRepoFileDrag(transfer) &&
      transfer.types.includes(sessionMime(sessionId))
  )
}

export function readRepoFileDrag(
  transfer: DataTransfer
): RepoFileReference | null {
  try {
    const result = referenceSchema.safeParse(
      JSON.parse(transfer.getData(REPO_FILE_MIME))
    )
    return result.success ? result.data : null
  } catch {
    return null
  }
}
