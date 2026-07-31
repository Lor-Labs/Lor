import {
  and,
  db,
  eq,
  isNull,
  MERLIN_EMBED_DIMENSIONS,
  schema,
  sql,
} from "@repo/db"
import { embedDocument } from "../embeddings"
import { MERLIN_EMBED_MODEL } from "../models"

const DEFAULT_CONCURRENCY = 4
const concurrency = Number.parseInt(
  process.env.MERLIN_REEMBED_CONCURRENCY ?? String(DEFAULT_CONCURRENCY),
  10
)

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  throw new Error("MERLIN_REEMBED_CONCURRENCY must be an integer from 1 to 32")
}

type NodeRow = {
  id: string
  parentId: string | null
  kind: "folder" | "page"
  name: string
  body: string | null
  needsEmbedding: boolean
}

type Failure = {
  type: "brain" | "source"
  id: string
  error: string
}

async function columnType(
  table: "brain_node" | "source"
): Promise<string | undefined> {
  const rows = await db.execute(
    sql.raw(
      `SELECT format_type(attribute.atttypid, attribute.atttypmod) AS data_type
       FROM pg_attribute AS attribute
       WHERE attribute.attrelid = '${table}'::regclass
         AND attribute.attname = 'embedding'
         AND NOT attribute.attisdropped`
    )
  )
  const value = rows[0]?.data_type
  return typeof value === "string" ? value : undefined
}

async function migrateEmbeddingColumns(): Promise<void> {
  const expected = `halfvec(${MERLIN_EMBED_DIMENSIONS})`
  const brainType = await columnType("brain_node")
  const sourceType = await columnType("source")

  if (brainType !== expected) {
    console.log(`Migrating brain_node.embedding: ${brainType} -> ${expected}`)
    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw("DROP INDEX IF EXISTS brain_node_embedding_hnsw_idx")
      )
      await tx.execute(
        sql.raw(
          `ALTER TABLE brain_node
           ALTER COLUMN embedding TYPE ${expected}
           USING NULL::${expected}`
        )
      )
      await tx.execute(
        sql.raw(
          `CREATE INDEX brain_node_embedding_hnsw_idx
           ON brain_node USING hnsw (embedding halfvec_cosine_ops)`
        )
      )
    })
  }

  if (sourceType !== expected) {
    console.log(`Migrating source.embedding: ${sourceType} -> ${expected}`)
    await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw("DROP INDEX IF EXISTS source_embedding_hnsw_idx")
      )
      await tx.execute(
        sql.raw(
          `ALTER TABLE source
           ALTER COLUMN embedding TYPE ${expected}
           USING NULL::${expected}`
        )
      )
      await tx.execute(
        sql.raw(
          `CREATE INDEX source_embedding_hnsw_idx
           ON source USING hnsw (embedding halfvec_cosine_ops)`
        )
      )
    })
  }
}

function nodePath(id: string, nodes: Map<string, NodeRow>): string {
  const segments: string[] = []
  const seen = new Set<string>()
  let current = nodes.get(id)

  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`cycle detected while resolving brain path for ${id}`)
    }
    seen.add(current.id)
    segments.push(current.name)
    current = current.parentId ? nodes.get(current.parentId) : undefined
  }

  return `/${segments.reverse().join("/")}`
}

async function mapConcurrent<T>(
  items: T[],
  worker: (item: T, completed: number) => Promise<void>
): Promise<void> {
  let cursor = 0
  let completed = 0
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor]
        cursor++
        if (item === undefined) return
        await worker(item, ++completed)
      }
    }
  )
  await Promise.all(workers)
}

async function reembedBrain(failures: Failure[]): Promise<number> {
  const rows = await db
    .select({
      id: schema.brainNode.id,
      parentId: schema.brainNode.parentId,
      kind: schema.brainNode.kind,
      name: schema.brainNode.name,
      body: schema.brainNode.body,
      embedding: schema.brainNode.embedding,
    })
    .from(schema.brainNode)

  const nodes = new Map<string, NodeRow>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        parentId: row.parentId,
        kind: row.kind,
        name: row.name,
        body: row.body,
        needsEmbedding: row.kind === "page" && row.embedding === null,
      },
    ])
  )
  const pages = [...nodes.values()].filter((node) => node.needsEmbedding)
  console.log(`Brain pages requiring embeddings: ${pages.length}`)

  let succeeded = 0
  await mapConcurrent(pages, async (page, completed) => {
    try {
      const path = nodePath(page.id, nodes)
      const embedding = await embedDocument(`${path}\n\n${page.body ?? ""}`)
      await db
        .update(schema.brainNode)
        .set({ embedding })
        .where(
          and(
            eq(schema.brainNode.id, page.id),
            isNull(schema.brainNode.embedding)
          )
        )
      succeeded++
      console.log(`  brain ${completed}/${pages.length}: ${path}`)
    } catch (error) {
      failures.push({
        type: "brain",
        id: page.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
  return succeeded
}

async function reembedSources(failures: Failure[]): Promise<number> {
  const sources = await db
    .select({
      id: schema.source.id,
      summary: schema.source.summary,
    })
    .from(schema.source)
    .where(isNull(schema.source.embedding))

  console.log(`Sources requiring embeddings: ${sources.length}`)
  let succeeded = 0
  await mapConcurrent(sources, async (source, completed) => {
    try {
      const embedding = await embedDocument(source.summary)
      await db
        .update(schema.source)
        .set({ embedding })
        .where(
          and(eq(schema.source.id, source.id), isNull(schema.source.embedding))
        )
      succeeded++
      console.log(`  source ${completed}/${sources.length}: ${source.id}`)
    } catch (error) {
      failures.push({
        type: "source",
        id: source.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
  return succeeded
}

async function main(): Promise<void> {
  console.log(
    `Re-embedding Merlin memory with ${MERLIN_EMBED_MODEL} (${MERLIN_EMBED_DIMENSIONS} dimensions, concurrency ${concurrency})`
  )
  await migrateEmbeddingColumns()

  const failures: Failure[] = []
  const brain = await reembedBrain(failures)
  const sources = await reembedSources(failures)

  console.log(`Embedded ${brain} brain pages and ${sources} sources.`)
  if (failures.length > 0) {
    console.error(`${failures.length} rows failed; rerun the command to retry:`)
    for (const failure of failures) {
      console.error(`  ${failure.type}:${failure.id}: ${failure.error}`)
    }
    process.exit(1)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error("Re-embedding failed:", error)
  process.exit(1)
})
