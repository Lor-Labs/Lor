import { GitStorage, OP_NO_FORCE_PUSH, OP_NO_PUSH } from "@pierre/storage"
import { db, desc, eq, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import type { CodeSandbox } from "./code-changes"
import { normalizePrivateKey } from "./providers/github"

// Code session checkpoints in Pierre Code Storage
// (reference/planned/code-sessions-runbook.md, chunk 5). One repo per
// workspace and GitHub repo, so sessions on it share the base's objects; each
// session's checkpoints form a fast-forward chain on session/<sessionId>.
// The org key stays on the server: the sandbox gets a 10-minute token for its
// own branch only, with no force-push, in one command's env.

const TOKEN_TTL_SECONDS = 600
const CHECKPOINT_TIMEOUT_MS = 120_000
const SNAPSHOT_FAILED = 20
const PUSH_FAILED = 21
const SHA = /^[0-9a-f]{40}$/

let cachedStore: GitStorage | null | undefined
function codeStorage(): GitStorage | null {
  if (cachedStore === undefined) {
    const key = normalizePrivateKey(env.CODE_STORAGE_PRIVATE_KEY)
    cachedStore =
      env.CODE_STORAGE_ORG && key
        ? new GitStorage({ name: env.CODE_STORAGE_ORG, key })
        : null
  }
  return cachedStore
}

export function checkpointRepoId(workspaceId: string, repoFullName: string) {
  return `${workspaceId}/${repoFullName.toLowerCase()}`
}

const sessionBranch = (sessionId: string) => `session/${sessionId}`

// Repos known to exist, so a checkpoint skips the lookup.
const knownRepos = new Set<string>()
async function ensureRepo(store: GitStorage, repoId: string) {
  if (knownRepos.has(repoId)) return store.repo({ id: repoId })
  const repo =
    (await store.findOne({ id: repoId })) ??
    (await store.createRepo({ id: repoId }).catch(async (err) => {
      // Another session created it first.
      const created = await store.findOne({ id: repoId })
      if (!created) throw err
      return created
    }))
  knownRepos.add(repoId)
  return repo
}

type WorkFolderState = {
  branch: string | null
  head: string
  upstream: string | null
  tree: string
}

// The work folder as a tree: a temporary index from HEAD, then every change
// and untracked file (ignored ones left out). The real index is untouched.
async function readWorkFolder(
  sandbox: CodeSandbox,
  abortSignal: AbortSignal
): Promise<WorkFolderState> {
  const result = await sandbox.run(
    [
      `idx="\${TMPDIR:-/tmp}/lor-checkpoint-index-$$"`,
      `head=$(git rev-parse -q --verify HEAD) || exit ${SNAPSHOT_FAILED}`,
      "branch=$(git symbolic-ref --short -q HEAD || true)",
      'up=""',
      'if [ -n "$branch" ]; then up=$(git rev-parse -q --verify "refs/remotes/origin/$branch" || true); fi',
      'GIT_INDEX_FILE="$idx" git read-tree HEAD && GIT_INDEX_FILE="$idx" git add -A && tree=$(GIT_INDEX_FILE="$idx" git write-tree)',
      `rc=$?; rm -f "$idx"; [ "$rc" -eq 0 ] || exit ${SNAPSHOT_FAILED}`,
      `printf '%s\\0%s\\0%s\\0%s' "$branch" "$head" "$up" "$tree"`,
    ].join("\n"),
    { abortSignal }
  )
  if (result.exitCode !== 0) {
    throw new Error(`checkpoint snapshot failed: ${result.stderr.slice(-300)}`)
  }
  const [branch = "", head = "", upstream = "", tree = ""] =
    result.stdout.split("\0")
  if (!(SHA.test(head) && SHA.test(tree))) {
    throw new Error("checkpoint snapshot returned no tree")
  }
  return {
    branch: branch || null,
    head,
    upstream: SHA.test(upstream) ? upstream : null,
    tree,
  }
}

export type CheckpointResult = "written" | "unchanged" | "disabled"

// Saves the work folder after a completed turn (or a person's Commit or
// Pull). Unchanged files and HEAD add nothing. One writer per session at a
// time: a Postgres advisory lock covers the read, push and row.
export async function writeCheckpoint(
  sandbox: CodeSandbox,
  input: {
    sessionId: string
    workspaceId: string
    repoFullName: string
    runId: string | null
  }
): Promise<CheckpointResult> {
  const store = codeStorage()
  if (!store) return "disabled"
  const storageRepo = checkpointRepoId(input.workspaceId, input.repoFullName)
  const branch = sessionBranch(input.sessionId)
  const abortSignal = AbortSignal.timeout(CHECKPOINT_TIMEOUT_MS)

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`checkpoint:${input.sessionId}`}))`
    )
    const [previous] = await tx
      .select({
        sha: schema.sessionCheckpoint.sha,
        treeSha: schema.sessionCheckpoint.treeSha,
        headSha: schema.sessionCheckpoint.headSha,
        storageRepo: schema.sessionCheckpoint.storageRepo,
      })
      .from(schema.sessionCheckpoint)
      .where(eq(schema.sessionCheckpoint.sessionId, input.sessionId))
      .orderBy(desc(schema.sessionCheckpoint.createdAt))
      .limit(1)
    const state = await readWorkFolder(sandbox, abortSignal)
    if (previous?.treeSha === state.tree && previous.headSha === state.head) {
      return "unchanged"
    }
    // A chain continues only within one Code Storage repo.
    const parent =
      previous && previous.storageRepo === storageRepo ? previous.sha : null

    const repo = await ensureRepo(store, storageRepo)
    const remote = await repo.getRemoteURL({
      permissions: ["git:read", "git:write"],
      ttl: TOKEN_TTL_SECONDS,
      refPolicies: [
        { pattern: `refs/heads/${branch}`, ops: [OP_NO_FORCE_PUSH] },
        { pattern: "*", ops: [OP_NO_PUSH] },
      ],
    })
    const token = new URL(remote).password
    const result = await sandbox.run(
      [
        // A new sandbox (or a fresh clone) lacks the previous checkpoint:
        // fetch the chain so the new one fast-forwards it.
        parent
          ? `git cat-file -e ${parent}^{commit} 2>/dev/null || git fetch -q --update-shallow "$LOR_CHECKPOINT_REMOTE" "refs/heads/${branch}:refs/lor/checkpoint" || exit ${PUSH_FAILED}`
          : "",
        `c=$(git -c user.name=Lor -c user.email=checkpoints@lor.chat commit-tree ${state.tree}${parent ? ` -p ${parent}` : ""} -p ${state.head} -m "Lor checkpoint") || exit ${SNAPSHOT_FAILED}`,
        `git push -q "$LOR_CHECKPOINT_REMOTE" "$c:refs/heads/${branch}" || exit ${PUSH_FAILED}`,
        'git update-ref refs/lor/checkpoint "$c"',
        `printf '%s' "$c"`,
      ]
        .filter(Boolean)
        .join("\n"),
      { env: { LOR_CHECKPOINT_REMOTE: remote }, abortSignal }
    )
    if (result.exitCode !== 0) {
      const detail = result.stderr.split(token).join("***").slice(-300)
      throw new Error(`checkpoint push failed: ${detail}`)
    }
    const sha = result.stdout.trim()
    if (!SHA.test(sha)) throw new Error("checkpoint push returned no commit")

    await tx.insert(schema.sessionCheckpoint).values({
      sessionId: input.sessionId,
      runId: input.runId,
      storageRepo,
      sha,
      treeSha: state.tree,
      headSha: state.head,
      branch: state.branch,
      upstreamSha: state.upstream,
    })
    return "written"
  })
}
