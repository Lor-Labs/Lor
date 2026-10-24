import { randomUUID } from "node:crypto"
import { shellQuote } from "@ai-sdk/harness/utils"
import { GitStorage, OP_NO_FORCE_PUSH, OP_NO_PUSH } from "@pierre/storage"
import { db, desc, eq, inArray, schema, sql } from "@repo/db"
import { env } from "@repo/env/server"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import type { CodeSandbox } from "./code-changes"
import { normalizePrivateKey } from "./providers/github"
import {
  attachOrCreateSessionSandbox,
  SESSION_WORK_DIR,
} from "./sandbox/session-sandbox"
import { piWorkDir } from "./session-core/work-dir"

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

const lockSession = (tx: Pick<typeof db, "execute">, sessionId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`checkpoint:${sessionId}`}))`
  )

function newestCheckpoint(tx: Pick<typeof db, "select">, sessionId: string) {
  return tx
    .select()
    .from(schema.sessionCheckpoint)
    .where(eq(schema.sessionCheckpoint.sessionId, sessionId))
    .orderBy(desc(schema.sessionCheckpoint.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

export async function hasCheckpoint(sessionId: string): Promise<boolean> {
  return (
    codeStorage() !== null && (await newestCheckpoint(db, sessionId)) !== null
  )
}

const RESTORE_FAILED = 30

export type RestoreResult = "restored" | "present" | "none"

// Rebuilds a session's work folder from its newest checkpoint: the branch at
// the saved HEAD (people's own commits included), the work tree as saved,
// nothing staged, and origin/<branch> where GitHub last was. It builds in a
// temporary folder and moves it into place last, so an interrupted restore
// leaves no half-built work folder. Under the session's checkpoint lock, so a
// restore never overlaps another restore or a checkpoint.
export async function restoreWorkFolder(
  session: SandboxSession,
  input: { sessionId: string; workDir: string; repoFullName: string },
  abortSignal?: AbortSignal
): Promise<RestoreResult> {
  const store = codeStorage()
  if (!store) return "none"
  return db.transaction(async (tx) => {
    await lockSession(tx, input.sessionId)
    const checkpoint = await newestCheckpoint(tx, input.sessionId)
    if (!checkpoint) return "none"
    const { sha, headSha, branch, upstreamSha } = checkpoint
    if (![sha, headSha].every((value) => SHA.test(value))) {
      throw new Error("checkpoint row has an invalid SHA")
    }
    const remote = await store
      .repo({ id: checkpoint.storageRepo })
      .getRemoteURL({ permissions: ["git:read"], ttl: TOKEN_TTL_SECONDS })
    const token = new URL(remote).password
    const q = shellQuote
    const checkout = branch ? `-B ${q(branch)}` : "--detach"
    const result = await session.run({
      command: [
        `dir=${q(input.workDir)}`,
        `if [ "$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" = "$dir" ]; then printf present; exit 0; fi`,
        // A folder left without a repo (or partly removed) can't be restored into.
        `if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then exit ${RESTORE_FAILED}; fi`,
        `rm -rf "$dir".restore-*`,
        `tmp="$dir.restore-$$"`,
        `mkdir -p "$tmp" && cd "$tmp" && git init -q || exit ${RESTORE_FAILED}`,
        `git fetch -q --update-shallow "$LOR_CHECKPOINT_REMOTE" ${q(`refs/heads/${sessionBranch(input.sessionId)}:refs/lor/checkpoint`)} || exit ${RESTORE_FAILED}`,
        `git checkout -q -f ${checkout} ${sha} && git reset -q --soft ${headSha} && git reset -q || exit ${RESTORE_FAILED}`,
        `git remote add origin ${q(`https://github.com/${input.repoFullName}.git`)}`,
        branch && upstreamSha && SHA.test(upstreamSha)
          ? `git update-ref ${q(`refs/remotes/origin/${branch}`)} ${upstreamSha} || true`
          : "",
        `cd / && rmdir "$dir" 2>/dev/null; mv "$tmp" "$dir" || exit ${RESTORE_FAILED}`,
        "printf restored",
      ]
        .filter(Boolean)
        .join("\n"),
      env: { LOR_CHECKPOINT_REMOTE: remote },
      ...(abortSignal ? { abortSignal } : {}),
    })
    if (result.exitCode !== 0) {
      const detail = result.stderr.split(token).join("***").slice(-300)
      throw new Error(`checkpoint restore failed: ${detail}`)
    }
    return result.stdout.trim() === "present" ? "present" : "restored"
  })
}

// The Changes panel's restore: the session's sandbox (created when gone),
// then its work folder from the newest checkpoint.
export async function restoreSessionFiles(input: {
  sessionId: string
  repoFullName: string
}): Promise<RestoreResult> {
  const sandbox = await attachOrCreateSessionSandbox({
    sessionId: input.sessionId,
  })
  if (!sandbox) return "none"
  try {
    return await restoreWorkFolder(sandbox.session, {
      ...input,
      workDir: piWorkDir(SESSION_WORK_DIR, input.sessionId),
    })
  } finally {
    sandbox.close()
  }
}

export type CheckpointResult = "written" | "unchanged" | "disabled"

// Saves the work folder after a completed turn, or a person's Commit, Push or
// Pull. Unchanged files, HEAD and upstream add nothing. One writer per
// session at a time: a Postgres advisory lock covers the read, push and row.
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
    await lockSession(tx, input.sessionId)
    const previous = await newestCheckpoint(tx, input.sessionId)
    const state = await readWorkFolder(sandbox, abortSignal)
    // A push changes only the upstream; a restore must know it too.
    if (
      previous?.treeSha === state.tree &&
      previous.headSha === state.head &&
      previous.upstreamSha === state.upstream
    ) {
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
    // Trailers make Code Storage's blame on the session branch name the
    // session, turn and checkpoint behind each line.
    const checkpointId = randomUUID()
    const message = [
      "Lor checkpoint",
      "",
      `Lor-Session: ${input.sessionId}`,
      ...(input.runId ? [`Lor-Run: ${input.runId}`] : []),
      `Lor-Checkpoint: ${checkpointId}`,
    ].join("\n")
    const result = await sandbox.run(
      [
        // A new sandbox (or a fresh clone) lacks the previous checkpoint:
        // fetch the chain so the new one fast-forwards it.
        parent
          ? `git cat-file -e ${parent}^{commit} 2>/dev/null || git fetch -q --update-shallow "$LOR_CHECKPOINT_REMOTE" "refs/heads/${branch}:refs/lor/checkpoint" || exit ${PUSH_FAILED}`
          : "",
        `c=$(printf '%s\\n' ${shellQuote(message)} | git -c user.name=Lor -c user.email=checkpoints@lor.chat commit-tree ${state.tree}${parent ? ` -p ${parent}` : ""} -p ${state.head} -F -) || exit ${SNAPSHOT_FAILED}`,
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
      id: checkpointId,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SESSION_BRANCH = /^session\/([0-9a-f-]{36})$/

// Deletions reach Code Storage (no default pruning; people's deletions
// propagate): a daily sweep deletes the branches of sessions that are gone
// (a channel deleted, say) and the repos of workspaces that are gone.
// Sessions and their checkpoint rows go by database cascade, so nothing runs
// at that moment. Only repos named <workspaceId>/<owner>/<repo> are touched.
export async function sweepCheckpointStorage(): Promise<{
  deletedBranches: number
  deletedRepos: number
}> {
  const store = codeStorage()
  const counts = { deletedBranches: 0, deletedRepos: 0 }
  if (!store) return counts
  let cursor: string | undefined
  do {
    const page = await store.listRepos({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })
    for (const { repoId } of page.repos) {
      const [workspaceId, ...rest] = repoId.split("/")
      if (!(workspaceId && UUID.test(workspaceId) && rest.length === 2)) {
        continue
      }
      const [workspace] = await db
        .select({ id: schema.workspace.id })
        .from(schema.workspace)
        .where(eq(schema.workspace.id, workspaceId))
        .limit(1)
      if (!workspace) {
        await deleteStorageRepo(store, repoId)
        counts.deletedRepos++
        continue
      }
      counts.deletedBranches += await sweepSessionBranches(store, repoId)
    }
    cursor = page.hasMore ? page.nextCursor : undefined
  } while (cursor)
  return counts
}

async function sweepSessionBranches(store: GitStorage, repoId: string) {
  const repo = store.repo({ id: repoId })
  const sessionIds: string[] = []
  let cursor: string | undefined
  do {
    const page = await repo.listBranches({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })
    for (const { name } of page.branches) {
      const id = SESSION_BRANCH.exec(name)?.[1]
      if (id) sessionIds.push(id)
    }
    cursor = page.hasMore ? page.nextCursor : undefined
  } while (cursor)
  if (sessionIds.length === 0) return 0
  const live = new Set(
    (
      await db
        .select({ id: schema.agentSession.id })
        .from(schema.agentSession)
        .where(inArray(schema.agentSession.id, sessionIds))
    ).map((row) => row.id)
  )
  const gone = sessionIds.filter((id) => !live.has(id))
  for (const id of gone) {
    await repo.deleteBranch({ name: sessionBranch(id) })
  }
  return gone.length
}

// The SDK has no repo delete; the HTTP API's delete is asynchronous.
async function deleteStorageRepo(store: GitStorage, repoId: string) {
  const url = await store
    .repo({ id: repoId })
    .getRemoteURL({ permissions: ["repo:write"], ttl: 300 })
  const org = env.CODE_STORAGE_ORG ?? ""
  const res = await fetch(
    `${GitStorage.getDefaultAPIBaseUrl(org)}/api/v1/repos/delete`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${new URL(url).password}` },
    }
  )
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new Error(`Code Storage repo delete failed: ${res.status}`)
  }
}
