import {
  and,
  asc,
  cosineDistance,
  db,
  eq,
  isNotNull,
  isNull,
  or,
  schema,
  sql,
} from "@repo/db"
import { tool } from "ai"
import { z } from "zod"
import { embedDocument } from "./embeddings"
import { logger } from "./logger"

const TREE_DEFAULT_DEPTH = 2
const TREE_MAX_DEPTH = 4

type NodeKind = "folder" | "page"
type Resolved = { id: string; kind: NodeKind; name: string }

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
  name: string
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
        eq(schema.brainNode.status, "active")
      )
    )
    .limit(1)
    .then((r) => r[0])
  return row ? { id: row.id, kind: row.kind, name } : null
}

async function childrenOf(workspaceId: string, parentId: string | null) {
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
        eq(schema.brainNode.status, "active")
      )
    )
    .orderBy(asc(schema.brainNode.kind), asc(schema.brainNode.name))
}

async function resolvePath(
  workspaceId: string,
  path: string
): Promise<Resolved | "root" | null> {
  const segments = segmentsOf(path)
  if (segments.length === 0) return "root"
  let parentId: string | null = null
  let node: Resolved | null = null
  for (const name of segments) {
    const child = await findChild(workspaceId, parentId, name)
    if (!child) return null
    node = child
    parentId = child.id
  }
  return node
}

async function ensureFolderPath(
  workspaceId: string,
  segments: string[]
): Promise<string | null> {
  let parentId: string | null = null
  for (const name of segments) {
    let child: Resolved | null = await findChild(workspaceId, parentId, name)
    if (!child) {
      const created: { id: string } | undefined = await db
        .insert(schema.brainNode)
        .values({ workspaceId, kind: "folder", parentId, name })
        .returning({ id: schema.brainNode.id })
        .then((rows) => rows[0])
      if (!created) throw new Error(`failed to create folder "${name}"`)
      child = { id: created.id, kind: "folder", name }
    } else if (child.kind === "page") {
      throw new Error(`"${name}" is a page, not a folder`)
    }
    parentId = child.id
  }
  return parentId
}

export async function ls(workspaceId: string, path: string) {
  const resolved = await resolvePath(workspaceId, path)
  if (resolved === null) return { error: `no such path: ${path}` }
  if (resolved !== "root" && resolved.kind === "page") {
    return { error: `${path} is a page — use read` }
  }
  const parentId = resolved === "root" ? null : resolved.id
  const entries = await childrenOf(workspaceId, parentId)
  return { path, entries: entries.map((e) => ({ name: e.name, kind: e.kind })) }
}

export async function pageExists(
  workspaceId: string,
  path: string
): Promise<boolean> {
  const node = await resolvePath(workspaceId, path)
  return node !== null && node !== "root" && node.kind === "page"
}

export async function readPage(workspaceId: string, path: string) {
  const resolved = await resolvePath(workspaceId, path)
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
    links: await pageLinks(workspaceId, resolved.id),
  }
}

type TreeEntry = { name: string; kind: NodeKind; children?: TreeEntry[] }

async function buildTree(
  workspaceId: string,
  parentId: string | null,
  depth: number
): Promise<TreeEntry[]> {
  const kids = await childrenOf(workspaceId, parentId)
  const out: TreeEntry[] = []
  for (const k of kids) {
    const entry: TreeEntry = { name: k.name, kind: k.kind }
    if (k.kind === "folder" && depth > 1) {
      entry.children = await buildTree(workspaceId, k.id, depth - 1)
    }
    out.push(entry)
  }
  return out
}

export async function tree(workspaceId: string, path: string, depth: number) {
  const resolved = await resolvePath(workspaceId, path)
  if (resolved === null) return { error: `no such path: ${path}` }
  if (resolved !== "root" && resolved.kind === "page") {
    return { error: `${path} is a page — use read` }
  }
  const parentId = resolved === "root" ? null : resolved.id
  const clamped = Math.max(1, Math.min(depth, TREE_MAX_DEPTH))
  return { path, tree: await buildTree(workspaceId, parentId, clamped) }
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

async function pageLinks(
  workspaceId: string,
  nodeId: string
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

  const links: BrainLink[] = []
  for (const e of rows) {
    const outgoing = e.fromNodeId === nodeId
    links.push({
      type: e.type,
      direction: outgoing ? "out" : "in",
      path: await pagePath(outgoing ? e.toNodeId : e.fromNodeId),
    })
  }
  return links
}

export async function searchBrain(
  workspaceId: string,
  queryEmbedding: number[],
  limit: number
): Promise<{ path: string; body: string; links: BrainLink[] }[]> {
  const distance = cosineDistance(schema.brainNode.embedding, queryEmbedding)
  const rows = await db
    .select({ id: schema.brainNode.id, body: schema.brainNode.body })
    .from(schema.brainNode)
    .where(
      and(
        eq(schema.brainNode.workspaceId, workspaceId),
        eq(schema.brainNode.kind, "page"),
        eq(schema.brainNode.status, "active"),
        isNotNull(schema.brainNode.embedding)
      )
    )
    .orderBy(distance)
    .limit(limit)

  const results: { path: string; body: string; links: BrainLink[] }[] = []
  for (const r of rows) {
    results.push({
      path: await pagePath(r.id),
      body: r.body ?? "",
      links: await pageLinks(workspaceId, r.id),
    })
  }
  return results
}

export async function writePage(
  workspaceId: string,
  path: string,
  body: string
): Promise<
  { error: string } | { path: string; action: "created" | "updated" }
> {
  const segments = segmentsOf(path)
  if (segments.length === 0) return { error: "cannot write to the root" }
  const leaf = segments[segments.length - 1] as string
  const cpath = `/${segments.join("/")}`
  const parentId = await ensureFolderPath(workspaceId, segments.slice(0, -1))

  const existing = await findChild(workspaceId, parentId, leaf)
  if (existing?.kind === "folder") return { error: `${cpath} is a folder` }

  const embedding = await embedDocument(`${cpath}\n\n${body}`).catch(() => null)

  if (existing) {
    await db
      .update(schema.brainNode)
      .set({ body, embedding, version: sql`${schema.brainNode.version} + 1` })
      .where(eq(schema.brainNode.id, existing.id))
    return { path: cpath, action: "updated" as const }
  }

  await db.insert(schema.brainNode).values({
    workspaceId,
    kind: "page",
    parentId,
    name: leaf,
    body,
    embedding,
  })
  return { path: cpath, action: "created" as const }
}

export async function mkdir(workspaceId: string, path: string) {
  const segments = segmentsOf(path)
  if (segments.length === 0) return { error: "the root already exists" }
  await ensureFolderPath(workspaceId, segments)
  return { path, ok: true }
}

export async function move(workspaceId: string, src: string, dst: string) {
  const node = await resolvePath(workspaceId, src)
  if (node === null || node === "root") return { error: `no such path: ${src}` }

  const dstSegments = segmentsOf(dst)
  if (dstSegments.length === 0) return { error: "cannot move to the root" }
  if (isPrefix(segmentsOf(src), dstSegments)) {
    return { error: "cannot move a node into itself" }
  }

  const dstLeaf = dstSegments[dstSegments.length - 1] as string
  const dstParentId = await ensureFolderPath(
    workspaceId,
    dstSegments.slice(0, -1)
  )
  if (await findChild(workspaceId, dstParentId, dstLeaf)) {
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
  type: (typeof schema.BRAIN_EDGE_TYPES)[number]
) {
  const fromNode = await resolvePath(workspaceId, from)
  const toNode = await resolvePath(workspaceId, to)
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

export type BrainWriteEvent = { path: string; action: "created" | "updated" }

const workspaceContext = z.object({ workspaceId: z.string() })
const writeContext = z.object({
  workspaceId: z.string(),
  onWrite: z.custom<(e: BrainWriteEvent) => void | Promise<void>>().optional(),
})

export const brainReadTools = {
  ls: tool({
    description:
      "List the immediate children (folders and pages) of a brain folder. Path '/' is the root.",
    inputSchema: z.object({
      path: z.string().describe("folder path, e.g. /people"),
    }),
    contextSchema: workspaceContext,
    execute: ({ path }, { context }) =>
      wrap(() => ls(context.workspaceId, path)),
    strict: true,
  }),
  read: tool({
    description: "Read a brain page's contents and its linked pages, by path.",
    inputSchema: z.object({
      path: z.string().describe("page path, e.g. /people/alice"),
    }),
    contextSchema: workspaceContext,
    execute: ({ path }, { context }) =>
      wrap(() => readPage(context.workspaceId, path)),
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
      wrap(() => tree(context.workspaceId, path, depth ?? TREE_DEFAULT_DEPTH)),
    strict: true,
  }),
}

export const brainWriteTools = {
  write: tool({
    description:
      "Create or update a brain page at a path (parent folders are created automatically). Overwrites the page body.",
    inputSchema: z.object({
      path: z.string().describe("page path, e.g. /decisions/auth"),
      body: z.string().describe("the page contents (Markdown)"),
    }),
    contextSchema: writeContext,
    execute: async ({ path, body }, { context }) => {
      const result = await wrap(() =>
        writePage(context.workspaceId, path, body)
      )
      // Listener failures should not make a committed write look failed.
      if (context.onWrite && "action" in result) {
        try {
          await context.onWrite({ path: result.path, action: result.action })
        } catch (err) {
          logger.error(
            { err, path: result.path },
            "Merlin onWrite listener failed"
          )
        }
      }
      // Echo the body so the tool-trail card can show what was saved.
      return "action" in result ? { ...result, body } : result
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
      wrap(() => mkdir(context.workspaceId, path)),
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
      wrap(() => move(context.workspaceId, from, to)),
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
      wrap(() => link(context.workspaceId, from, to, type)),
    strict: true,
  }),
}
