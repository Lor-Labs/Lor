import {
  and,
  asc,
  cosineDistance,
  db,
  eq,
  inArray,
  isNotNull,
  isNull,
  isUniqueViolation,
  or,
  schema,
  TransactionRollbackError,
} from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { embedDocument } from "./embeddings"
import { logger } from "./logger"

const TREE_DEFAULT_DEPTH = 2
const TREE_MAX_DEPTH = 4

type NodeKind = "folder" | "page"
type Resolved = { id: string; kind: NodeKind; name: string }

// Memory scope: null = workspace-wide nodes only; an access container channel
// id also admits that container's nodes.
type MemoryScope = string | null

// Reads admit workspace-wide nodes alongside the scope's own; writes must be
// scope-strict so a scoped write never resolves (and mutates or pins) a
// workspace-wide node — a name collision creates/uses the scoped sibling.
function scopeFilter(scopeChannelId: MemoryScope, strict = false) {
  if (!scopeChannelId) return isNull(schema.brainNode.scopeChannelId)
  const scoped = eq(schema.brainNode.scopeChannelId, scopeChannelId)
  return strict ? scoped : or(isNull(schema.brainNode.scopeChannelId), scoped)
}

function segmentsOf(path: string): string[] {
  return path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function isPrefix(a: string[], b: string[]): boolean {
  return a.length <= b.length && a.every((seg, i) => seg === b[i])
}

async function findChild(
  workspaceId: string,
  parentId: string | null,
  name: string,
  scopeChannelId: MemoryScope = null,
  strict = false
): Promise<Resolved | null> {
  const row = await db
    .select({ id: schema.brainNode.id, kind: schema.brainNode.kind })
    .from(schema.brainNode)
    .where(
      and(
        eq(schema.brainNode.workspaceId, workspaceId),
        parentId === null
          ? isNull(schema.brainNode.parentId)
          : eq(schema.brainNode.parentId, parentId),
        eq(schema.brainNode.name, name),
        eq(schema.brainNode.status, "active"),
        scopeFilter(scopeChannelId, strict)
      )
    )
    .limit(1)
    .then((r) => r[0])
  return row ? { id: row.id, kind: row.kind, name } : null
}

async function childrenOf(
  workspaceId: string,
  parentId: string | null,
  scopeChannelId: MemoryScope = null
) {
  return db
    .select({
      id: schema.brainNode.id,
      name: schema.brainNode.name,
      kind: schema.brainNode.kind,
    })
    .from(schema.brainNode)
    .where(
      and(
        eq(schema.brainNode.workspaceId, workspaceId),
        parentId === null
          ? isNull(schema.brainNode.parentId)
          : eq(schema.brainNode.parentId, parentId),
        eq(schema.brainNode.status, "active"),
        scopeFilter(scopeChannelId)
      )
    )
    .orderBy(asc(schema.brainNode.kind), asc(schema.brainNode.name))
}

async function resolvePath(
  workspaceId: string,
  path: string,
  scopeChannelId: MemoryScope = null,
  strict = false
): Promise<Resolved | "root" | null> {
  const segments = segmentsOf(path)
  if (segments.length === 0) return "root"
  let parentId: string | null = null
  let node: Resolved | null = null
  for (const name of segments) {
    const child = await findChild(
      workspaceId,
      parentId,
      name,
      scopeChannelId,
      strict
    )
    if (!child) return null
    node = child
    parentId = child.id
  }
  return node
}

// Write path only — scope-strict so scoped folders never alias workspace ones.
async function ensureFolderPath(
  workspaceId: string,
  segments: string[],
  scopeChannelId: MemoryScope = null
): Promise<string | null> {
  let parentId: string | null = null
  for (const name of segments) {
    let child: Resolved | null = await findChild(
      workspaceId,
      parentId,
      name,
      scopeChannelId,
      true
    )
    if (!child) {
      // A concurrent write may create the same folder; reuse it.
      const created: { id: string } | undefined = await db
        .insert(schema.brainNode)
        .values({ workspaceId, kind: "folder", parentId, name, scopeChannelId })
        .onConflictDoNothing()
        .returning({ id: schema.brainNode.id })
        .then((rows) => rows[0])
      child = created
        ? { id: created.id, kind: "folder", name }
        : await findChild(workspaceId, parentId, name, scopeChannelId, true)
      if (!child) throw new Error(`failed to create folder "${name}"`)
    }
    if (child.kind === "page") {
      throw new Error(`"${name}" is a page, not a folder`)
    }
    parentId = child.id
  }
  return parentId
}

export async function ls(
  workspaceId: string,
  path: string,
  scopeChannelId: MemoryScope = null
) {
  const resolved = await resolvePath(workspaceId, path, scopeChannelId)
  if (resolved === null) return { error: `no such path: ${path}` }
  if (resolved !== "root" && resolved.kind === "page") {
    return { error: `${path} is a page — use read` }
  }
  const parentId = resolved === "root" ? null : resolved.id
  const entries = await childrenOf(workspaceId, parentId, scopeChannelId)
  return { path, entries: entries.map((e) => ({ name: e.name, kind: e.kind })) }
}

export async function pageExists(
  workspaceId: string,
  path: string
): Promise<boolean> {
  const node = await resolvePath(workspaceId, path)
  return node !== null && node !== "root" && node.kind === "page"
}

export async function readPage(
  workspaceId: string,
  path: string,
  scopeChannelId: MemoryScope = null
) {
  const resolved = await resolvePath(workspaceId, path, scopeChannelId)
  if (resolved === null) return { error: `no such path: ${path}` }
  if (resolved === "root" || resolved.kind === "folder") {
    return { error: `${path} is a folder — use ls` }
  }
  const page = await db
    .select({
      body: schema.brainNode.body,
      metadata: schema.brainNode.metadata,
    })
    .from(schema.brainNode)
    .where(eq(schema.brainNode.id, resolved.id))
    .limit(1)
    .then((r) => r[0])
  return {
    path,
    body: page?.body ?? "",
    metadata: page?.metadata ?? {},
    links: await pageLinks(workspaceId, resolved.id, scopeChannelId),
  }
}

type TreeEntry = { name: string; kind: NodeKind; children?: TreeEntry[] }

async function buildTree(
  workspaceId: string,
  parentId: string | null,
  depth: number,
  scopeChannelId: MemoryScope = null
): Promise<TreeEntry[]> {
  const kids = await childrenOf(workspaceId, parentId, scopeChannelId)
  const out: TreeEntry[] = []
  for (const k of kids) {
    const entry: TreeEntry = { name: k.name, kind: k.kind }
    if (k.kind === "folder" && depth > 1) {
      entry.children = await buildTree(
        workspaceId,
        k.id,
        depth - 1,
        scopeChannelId
      )
    }
    out.push(entry)
  }
  return out
}

export async function tree(
  workspaceId: string,
  path: string,
  depth: number,
  scopeChannelId: MemoryScope = null
) {
  const resolved = await resolvePath(workspaceId, path, scopeChannelId)
  if (resolved === null) return { error: `no such path: ${path}` }
  if (resolved !== "root" && resolved.kind === "page") {
    return { error: `${path} is a page — use read` }
  }
  const parentId = resolved === "root" ? null : resolved.id
  const clamped = Math.max(1, Math.min(depth, TREE_MAX_DEPTH))
  return {
    path,
    tree: await buildTree(workspaceId, parentId, clamped, scopeChannelId),
  }
}

async function pagePath(nodeId: string): Promise<string> {
  const parts: string[] = []
  let current: string | null = nodeId
  while (current) {
    const node: { name: string; parentId: string | null } | undefined = await db
      .select({
        name: schema.brainNode.name,
        parentId: schema.brainNode.parentId,
      })
      .from(schema.brainNode)
      .where(eq(schema.brainNode.id, current))
      .limit(1)
      .then((r) => r[0])
    if (!node) break
    parts.unshift(node.name)
    current = node.parentId
  }
  return `/${parts.join("/")}`
}

export type BrainLink = { type: string; direction: "out" | "in"; path: string }

// Links are filtered by the reader's scope: a link to a page the reader
// cannot open would still leak that page's path, even though read refuses it.
async function pageLinks(
  workspaceId: string,
  nodeId: string,
  scopeChannelId: MemoryScope
): Promise<BrainLink[]> {
  const rows = await db
    .select({
      type: schema.brainEdge.type,
      fromNodeId: schema.brainEdge.fromNodeId,
      toNodeId: schema.brainEdge.toNodeId,
    })
    .from(schema.brainEdge)
    .where(
      and(
        eq(schema.brainEdge.workspaceId, workspaceId),
        or(
          eq(schema.brainEdge.fromNodeId, nodeId),
          eq(schema.brainEdge.toNodeId, nodeId)
        )
      )
    )
  const otherIds = rows.map((e) =>
    e.fromNodeId === nodeId ? e.toNodeId : e.fromNodeId
  )
  const visible =
    otherIds.length === 0
      ? new Set<string>()
      : new Set(
          await db
            .select({ id: schema.brainNode.id })
            .from(schema.brainNode)
            .where(
              and(
                inArray(schema.brainNode.id, otherIds),
                scopeFilter(scopeChannelId)
              )
            )
            .then((r) => r.map((n) => n.id))
        )

  const links: BrainLink[] = []
  for (const e of rows) {
    const outgoing = e.fromNodeId === nodeId
    if (!visible.has(outgoing ? e.toNodeId : e.fromNodeId)) continue
    links.push({
      type: e.type,
      direction: outgoing ? "out" : "in",
      path: await pagePath(outgoing ? e.toNodeId : e.fromNodeId),
    })
  }
  return links
}

// Nearest active pages by vector. `search` reranks these with every other
// kind of result, then resolves paths only for the pages it keeps.
export async function brainCandidates(
  workspaceId: string,
  queryEmbedding: number[],
  limit: number,
  scopeChannelId: MemoryScope = null
): Promise<{ id: string; name: string; body: string }[]> {
  const distance = cosineDistance(schema.brainNode.embedding, queryEmbedding)
  const rows = await db
    .select({
      id: schema.brainNode.id,
      name: schema.brainNode.name,
      body: schema.brainNode.body,
    })
    .from(schema.brainNode)
    .where(
      and(
        eq(schema.brainNode.workspaceId, workspaceId),
        eq(schema.brainNode.kind, "page"),
        eq(schema.brainNode.status, "active"),
        isNotNull(schema.brainNode.embedding),
        scopeFilter(scopeChannelId)
      )
    )
    .orderBy(distance)
    .limit(limit)
  return rows.map((r) => ({ ...r, body: r.body ?? "" }))
}

export async function brainPageDetails(
  workspaceId: string,
  nodeId: string,
  scopeChannelId: MemoryScope
): Promise<{ path: string; links: BrainLink[] }> {
  return {
    path: await pagePath(nodeId),
    links: await pageLinks(workspaceId, nodeId, scopeChannelId),
  }
}

export async function searchBrain(
  workspaceId: string,
  queryEmbedding: number[],
  limit: number,
  scopeChannelId: MemoryScope = null
): Promise<{ path: string; body: string; links: BrainLink[] }[]> {
  const rows = await brainCandidates(
    workspaceId,
    queryEmbedding,
    limit,
    scopeChannelId
  )
  const results: { path: string; body: string; links: BrainLink[] }[] = []
  for (const r of rows) {
    results.push({
      body: r.body,
      ...(await brainPageDetails(workspaceId, r.id, scopeChannelId)),
    })
  }
  return results
}

export type BrainWriteScope = {
  /** Access container channel (project category or private channel). */
  scopeChannelId: string
  /** The scope's folder, e.g. "/projects/mobile-launch" or "/channels/admins" — all scoped writes land under it. */
  rootPath: string
}

// Scoped writes are confined under the scope's folder — updating a
// workspace-visible page from a private channel would leak at retrieval.
function scopedSegments(path: string, scope: BrainWriteScope | null) {
  const pathSegments = segmentsOf(path)
  if (!scope) return pathSegments
  const rootSegments = segmentsOf(scope.rootPath)
  return isPrefix(rootSegments, pathSegments)
    ? pathSegments
    : [...rootSegments, ...pathSegments]
}

const alreadyExists = (path: string) =>
  `${path} already exists. Read it, then use edit to change it.`

// Create only: changing an existing page goes through editPage, so a rewrite
// can never silently drop facts (session-memory.md decision 10).
export async function writePage(
  workspaceId: string,
  path: string,
  body: string,
  scope: BrainWriteScope | null = null
): Promise<
  { error: string } | { path: string; action: "created"; nodeId: string }
> {
  const scopeChannelId = scope?.scopeChannelId ?? null
  const segments = scopedSegments(path, scope)
  if (segments.length === 0) return { error: "cannot write to the root" }
  const leaf = segments[segments.length - 1] as string
  const cpath = `/${segments.join("/")}`
  const parentId = await ensureFolderPath(
    workspaceId,
    segments.slice(0, -1),
    scopeChannelId
  )

  const existing = await findChild(
    workspaceId,
    parentId,
    leaf,
    scopeChannelId,
    true
  )
  if (existing?.kind === "folder") return { error: `${cpath} is a folder` }
  if (existing) return { error: alreadyExists(cpath) }

  const embedding = await embedDocument(`${cpath}\n\n${body}`).catch(() => null)
  try {
    const inserted = await db
      .insert(schema.brainNode)
      .values({
        workspaceId,
        kind: "page",
        parentId,
        name: leaf,
        body,
        embedding,
        scopeChannelId,
      })
      .returning({ id: schema.brainNode.id })
      .then((rows) => rows[0])
    if (!inserted) return { error: "write failed" }
    await recordProjectBrainFolder(workspaceId, scope)
    return { path: cpath, action: "created" as const, nodeId: inserted.id }
  } catch (err) {
    // A concurrent write created the page first.
    if (isUniqueViolation(err)) return { error: alreadyExists(cpath) }
    throw err
  }
}

// A targeted replacement that keeps the rest of the page. Saves the previous
// body, and only lands if nobody changed the page in between (compare-and-swap
// on version); parallel write-backs need no workspace lock.
export async function editPage(
  workspaceId: string,
  path: string,
  oldText: string,
  newText: string,
  scope: BrainWriteScope | null = null,
  runId: string | null = null
): Promise<
  | { error: string }
  | { path: string; action: "updated"; nodeId: string; body: string }
> {
  if (!oldText)
    return { error: "oldText is empty; pass the exact text to replace" }
  const scopeChannelId = scope?.scopeChannelId ?? null
  const segments = scopedSegments(path, scope)
  const cpath = `/${segments.join("/")}`
  const node = await resolvePath(workspaceId, cpath, scopeChannelId, true)
  if (node === null || node === "root") {
    return { error: `no such page: ${cpath}. Use write to create it.` }
  }
  if (node.kind === "folder") return { error: `${cpath} is a folder` }

  const outcome: { error: string } | { body: string; version: number } =
    await db
      .transaction(async (tx) => {
        const page = await tx
          .select({
            body: schema.brainNode.body,
            version: schema.brainNode.version,
          })
          .from(schema.brainNode)
          .where(eq(schema.brainNode.id, node.id))
          .limit(1)
          .then((r) => r[0])
        if (!page) return { error: `no such page: ${cpath}` }
        const body = page.body ?? ""
        const at = body.indexOf(oldText)
        if (at === -1) {
          return {
            error: `oldText was not found in ${cpath}. Read the page and copy the exact text to replace.`,
          }
        }
        if (body.indexOf(oldText, at + 1) !== -1) {
          return {
            error: `oldText appears more than once in ${cpath}. Include more surrounding text so it matches once.`,
          }
        }
        const next =
          body.slice(0, at) + newText + body.slice(at + oldText.length)
        await tx.insert(schema.brainNodeVersion).values({
          workspaceId,
          nodeId: node.id,
          version: page.version,
          body,
          runId,
        })
        const updated = await tx
          .update(schema.brainNode)
          .set({ body: next, version: page.version + 1 })
          .where(
            and(
              eq(schema.brainNode.id, node.id),
              eq(schema.brainNode.version, page.version)
            )
          )
          .returning({ id: schema.brainNode.id })
        // Rolls back the history row too.
        if (updated.length === 0) tx.rollback()
        return { body: next, version: page.version + 1 }
      })
      .catch((err: unknown) => {
        // A concurrent edit of the same version fails on the version check
        // or, if it commits first, on the history row's unique key.
        if (err instanceof TransactionRollbackError || isUniqueViolation(err)) {
          return {
            error: `${cpath} changed since you read it. Read it again, then retry the edit.`,
          }
        }
        throw err
      })
  if ("error" in outcome) return outcome

  // Embed after commit; an edit landing meanwhile keeps its own embedding.
  const embedding = await embedDocument(`${cpath}\n\n${outcome.body}`).catch(
    () => null
  )
  if (embedding) {
    await db
      .update(schema.brainNode)
      .set({ embedding })
      .where(
        and(
          eq(schema.brainNode.id, node.id),
          eq(schema.brainNode.version, outcome.version)
        )
      )
  }
  return { path: cpath, action: "updated", nodeId: node.id, body: outcome.body }
}

// First scoped write pins project.brainFolderId for archive synthesis. Scope
// key is the container channel (a project's category); standalone private
// channels have no project row — no-op.
async function recordProjectBrainFolder(
  workspaceId: string,
  scope: BrainWriteScope | null
) {
  if (!scope) return
  const root = await resolvePath(
    workspaceId,
    scope.rootPath,
    scope.scopeChannelId,
    true
  )
  if (!root || root === "root") return
  await db
    .update(schema.project)
    .set({ brainFolderId: root.id })
    .where(
      and(
        eq(schema.project.categoryChannelId, scope.scopeChannelId),
        isNull(schema.project.brainFolderId)
      )
    )
    .catch(() => {})
}

export async function mkdir(
  workspaceId: string,
  path: string,
  scopeChannelId: MemoryScope = null
) {
  const segments = segmentsOf(path)
  if (segments.length === 0) return { error: "the root already exists" }
  await ensureFolderPath(workspaceId, segments, scopeChannelId)
  return { path, ok: true }
}

export async function move(
  workspaceId: string,
  src: string,
  dst: string,
  scopeChannelId: MemoryScope = null
) {
  const node = await resolvePath(workspaceId, src, scopeChannelId)
  if (node === null || node === "root") return { error: `no such path: ${src}` }

  const dstSegments = segmentsOf(dst)
  if (dstSegments.length === 0) return { error: "cannot move to the root" }
  if (isPrefix(segmentsOf(src), dstSegments)) {
    return { error: "cannot move a node into itself" }
  }

  const dstLeaf = dstSegments[dstSegments.length - 1] as string
  const dstParentId = await ensureFolderPath(
    workspaceId,
    dstSegments.slice(0, -1),
    scopeChannelId
  )
  if (await findChild(workspaceId, dstParentId, dstLeaf, scopeChannelId)) {
    return { error: `${dst} already exists` }
  }

  await db
    .update(schema.brainNode)
    .set({ parentId: dstParentId, name: dstLeaf })
    .where(eq(schema.brainNode.id, node.id))

  // Page embeddings include paths; refresh moved pages.
  if (node.kind === "page") {
    const cdst = `/${dstSegments.join("/")}`
    const page = await db
      .select({ body: schema.brainNode.body })
      .from(schema.brainNode)
      .where(eq(schema.brainNode.id, node.id))
      .then((r) => r[0])
    const embedding = await embedDocument(
      `${cdst}\n\n${page?.body ?? ""}`
    ).catch(() => null)
    if (embedding) {
      await db
        .update(schema.brainNode)
        .set({ embedding })
        .where(eq(schema.brainNode.id, node.id))
    }
  }
  return { from: src, to: dst }
}

export async function link(
  workspaceId: string,
  from: string,
  to: string,
  type: (typeof schema.BRAIN_EDGE_TYPES)[number],
  scopeChannelId: MemoryScope = null
) {
  const fromNode = await resolvePath(workspaceId, from, scopeChannelId)
  const toNode = await resolvePath(workspaceId, to, scopeChannelId)
  if (fromNode === null || fromNode === "root" || fromNode.kind !== "page") {
    return { error: `${from} is not a page` }
  }
  if (toNode === null || toNode === "root" || toNode.kind !== "page") {
    return { error: `${to} is not a page` }
  }
  await db
    .insert(schema.brainEdge)
    .values({ workspaceId, fromNodeId: fromNode.id, toNodeId: toNode.id, type })
    .onConflictDoNothing()
  return { from, to, type }
}

function wrap<T>(fn: () => Promise<T>) {
  return fn().catch((e: unknown) => ({
    error: e instanceof Error ? e.message : "operation failed",
  }))
}

// nodeId travels with every write event so consumers (memory chips, the
// archived-project overview) can reference the page durably — paths go stale
// when pages are moved or renamed.
export type BrainWriteEvent = {
  nodeId: string
  path: string
  action: "created" | "updated"
}

const workspaceContext = z.object({
  workspaceId: z.string(),
  // Memory scope (access container channel) — absent/null = workspace only.
  scopeChannelId: z.string().nullable().optional(),
})
const writeContext = z.object({
  workspaceId: z.string(),
  scopeChannelId: z.string().nullable().optional(),
  // Scoped writes are confined under this folder.
  scopeFolderPath: z.string().nullable().optional(),
  // Recorded on page history; null outside a run.
  runId: z.string().nullable().optional(),
  onWrite: z.custom<(e: BrainWriteEvent) => void | Promise<void>>().optional(),
})

// Listener failures should not make a committed write look failed.
async function notifyWrite(
  context: z.infer<typeof writeContext>,
  event: BrainWriteEvent
) {
  if (!context.onWrite) return
  try {
    await context.onWrite(event)
  } catch (err) {
    logger.error({ err, path: event.path }, "Lor onWrite listener failed")
  }
}

function writeScopeOf(context: {
  scopeChannelId?: string | null
  scopeFolderPath?: string | null
}): BrainWriteScope | null {
  return context.scopeChannelId && context.scopeFolderPath
    ? {
        scopeChannelId: context.scopeChannelId,
        rootPath: context.scopeFolderPath,
      }
    : null
}

export const brainReadTools = {
  ls: tool({
    description:
      "List the immediate children (folders and pages) of a brain folder. Path '/' is the root.",
    inputSchema: z.object({
      path: z.string().describe("folder path, e.g. /people"),
    }),
    contextSchema: workspaceContext,
    execute: ({ path }, { context }) =>
      wrap(() => ls(context.workspaceId, path, context.scopeChannelId ?? null)),
    strict: true,
  }),
  read: tool({
    description: "Read a brain page's contents and its linked pages, by path.",
    inputSchema: z.object({
      path: z.string().describe("page path, e.g. /people/alice"),
    }),
    contextSchema: workspaceContext,
    execute: ({ path }, { context }) =>
      wrap(() =>
        readPage(context.workspaceId, path, context.scopeChannelId ?? null)
      ),
    strict: true,
  }),
  tree: tool({
    description:
      "Show the brain's folder/page structure under a path, nested to a depth (default 2).",
    inputSchema: z.object({
      path: z.string().describe("root path, e.g. / or /services"),
      depth: z.number().optional(),
    }),
    contextSchema: workspaceContext,
    execute: ({ path, depth }, { context }) =>
      wrap(() =>
        tree(
          context.workspaceId,
          path,
          depth ?? TREE_DEFAULT_DEPTH,
          context.scopeChannelId ?? null
        )
      ),
    strict: true,
  }),
}

export const brainWriteTools = {
  write: tool({
    description:
      "Create a new brain page at a path (parent folders are created automatically). Fails if the page already exists; change an existing page with edit.",
    inputSchema: z.object({
      path: z.string().describe("page path, e.g. /decisions/auth"),
      body: z.string().describe("the page contents (Markdown)"),
    }),
    contextSchema: writeContext,
    execute: async ({ path, body }, { context }) => {
      const result = await wrap(() =>
        writePage(context.workspaceId, path, body, writeScopeOf(context))
      )
      if ("action" in result) {
        await notifyWrite(context, {
          nodeId: result.nodeId,
          path: result.path,
          action: result.action,
        })
      }
      // Echo the body so the tool-trail card can show what was saved. The
      // node id stays out of the model-facing result — it cites paths.
      return "action" in result
        ? { path: result.path, action: result.action, body }
        : result
    },
    strict: true,
  }),
  edit: tool({
    description:
      "Change part of an existing brain page: replace oldText, which must appear exactly once in the page, with newText. The rest of the page stays as it is. Read the page first and copy oldText exactly.",
    inputSchema: z.object({
      path: z.string().describe("page path, e.g. /decisions/auth"),
      oldText: z.string().describe("exact text to replace"),
      newText: z.string().describe("replacement text (Markdown)"),
    }),
    contextSchema: writeContext,
    execute: async ({ path, oldText, newText }, { context }) => {
      const result = await wrap(() =>
        editPage(
          context.workspaceId,
          path,
          oldText,
          newText,
          writeScopeOf(context),
          context.runId ?? null
        )
      )
      if ("action" in result) {
        await notifyWrite(context, {
          nodeId: result.nodeId,
          path: result.path,
          action: result.action,
        })
      }
      return "action" in result
        ? { path: result.path, action: result.action, oldText, newText }
        : result
    },
    strict: true,
  }),
  mkdir: tool({
    description: "Create a brain folder (and any missing parent folders).",
    inputSchema: z.object({
      path: z.string().describe("folder path"),
    }),
    contextSchema: workspaceContext,
    execute: ({ path }, { context }) =>
      wrap(() =>
        mkdir(context.workspaceId, path, context.scopeChannelId ?? null)
      ),
    strict: true,
  }),
  move: tool({
    description: "Move or rename a brain node (folder or page).",
    inputSchema: z.object({
      from: z.string().describe("current path"),
      to: z.string().describe("new path"),
    }),
    contextSchema: workspaceContext,
    execute: ({ from, to }, { context }) =>
      wrap(() =>
        move(context.workspaceId, from, to, context.scopeChannelId ?? null)
      ),
    strict: true,
  }),
  link: tool({
    description:
      "Create a typed link between two brain pages from the fixed set of edge types.",
    inputSchema: z.object({
      from: z.string().describe("source page path"),
      to: z.string().describe("target page path"),
      type: z.enum(schema.BRAIN_EDGE_TYPES).describe("relationship type"),
    }),
    contextSchema: workspaceContext,
    execute: ({ from, to, type }, { context }) =>
      wrap(() =>
        link(
          context.workspaceId,
          from,
          to,
          type,
          context.scopeChannelId ?? null
        )
      ),
    strict: true,
  }),
}
