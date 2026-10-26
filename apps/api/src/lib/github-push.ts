import {
  type CodeSandbox,
  type LocalCommit,
  readBlobs,
} from "@repo/lor/code-changes"
import { GITHUB_API, GITHUB_HEADERS } from "@/lib/github-account"

// Push without a token in the sandbox (reference/planned/code-sessions-runbook.md,
// chunk 4c): the server replays the sandbox's commits through GitHub's Git
// Data API with the person's token. Same blobs, trees, authors, dates and
// messages, so GitHub's SHAs equal the sandbox's and the branch
// fast-forwards. The branch moves only after every object matched.

export type PushResult =
  | { ok: true; headSha: string }
  // behind: GitHub's branch has commits the session doesn't; pull first.
  | { ok: false; detail: string; behind?: true }

class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const BLOB_UPLOADS_AT_ONCE = 6

async function github<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      ...GITHUB_HEADERS,
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text
    } catch {}
    throw new GithubError(res.status, message.slice(0, 300))
  }
  return (await res.json()) as T
}

const mismatch = (sha: string) => ({
  ok: false as const,
  detail: `GitHub's copy of commit ${sha.slice(0, 7)} didn't match the sandbox's, so nothing was pushed`,
})

export async function pushCommits(input: {
  token: string
  repoFullName: string
  branch: string
  // The commit the sandbox last saw on GitHub's branch.
  upstreamSha: string
  commits: LocalCommit[]
  sandbox: CodeSandbox
}): Promise<PushResult> {
  const { token, branch, commits } = input
  const first = commits[0]
  const last = commits.at(-1)
  if (!(first && last)) return { ok: false, detail: "Nothing to push" }
  const repo = `/repos/${input.repoFullName}`
  const branchPath = branch.split("/").map(encodeURIComponent).join("/")
  try {
    const remote = await github<{ object: { sha: string } }>(
      token,
      "GET",
      `${repo}/git/ref/heads/${branchPath}`
    ).catch((err) => {
      if (err instanceof GithubError && err.status === 404) return null
      throw err
    })
    // An earlier push landed but the sandbox didn't record it.
    if (remote?.object.sha === last.sha) return { ok: true, headSha: last.sha }
    if (remote && remote.object.sha !== input.upstreamSha) {
      return {
        ok: false,
        behind: true,
        detail: `${branch} has new commits on GitHub. Pull them in first`,
      }
    }

    const blobShas = [
      ...new Set(
        commits.flatMap((commit) =>
          commit.changes.flatMap((change) =>
            change.type === "blob" && change.sha ? [change.sha] : []
          )
        )
      ),
    ]
    const contents = await readBlobs(input.sandbox, blobShas)
    for (let i = 0; i < blobShas.length; i += BLOB_UPLOADS_AT_ONCE) {
      const uploaded = await Promise.all(
        blobShas.slice(i, i + BLOB_UPLOADS_AT_ONCE).map(async (sha) => {
          const blob = await github<{ sha: string }>(
            token,
            "POST",
            `${repo}/git/blobs`,
            { content: contents.get(sha) ?? "", encoding: "base64" }
          )
          return blob.sha === sha
        })
      )
      if (uploaded.includes(false)) return mismatch(first.sha)
    }

    for (const commit of commits) {
      if (commit.changes.length > 0) {
        const tree = await github<{ sha: string }>(
          token,
          "POST",
          `${repo}/git/trees`,
          { base_tree: commit.parentTree, tree: commit.changes }
        )
        if (tree.sha !== commit.tree) return mismatch(commit.sha)
      }
      const created = await github<{ sha: string }>(
        token,
        "POST",
        `${repo}/git/commits`,
        {
          message: commit.message,
          tree: commit.tree,
          parents: commit.parents,
          author: commit.author,
          committer: commit.committer,
        }
      )
      if (created.sha !== commit.sha) return mismatch(commit.sha)
    }

    if (remote) {
      await github(token, "PATCH", `${repo}/git/refs/heads/${branchPath}`, {
        sha: last.sha,
        force: false,
      })
    } else {
      await github(token, "POST", `${repo}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: last.sha,
      })
    }
    return { ok: true, headSha: last.sha }
  } catch (err) {
    if (!(err instanceof GithubError)) throw err
    if (err.status === 403 || err.status === 404) {
      return {
        ok: false,
        detail: `Your GitHub account can't push to ${input.repoFullName}. You need write access, and the Lor GitHub App needs the Contents write permission`,
      }
    }
    if (err.status === 422 && /fast.forward/i.test(err.message)) {
      return {
        ok: false,
        behind: true,
        detail: `${branch} changed on GitHub while pushing. Pull the new commits in first`,
      }
    }
    return { ok: false, detail: `GitHub refused the push: ${err.message}` }
  }
}

// After a push, like Zed's "Create Pull Request": the branch's open pull
// request, or GitHub's page for a new one. Null on the default branch, which
// has nothing to merge into. Best-effort.
export async function pullRequestLink(input: {
  token: string
  repoFullName: string
  branch: string
}): Promise<{ url: string; open: boolean } | null> {
  const repo = `/repos/${input.repoFullName}`
  const owner = input.repoFullName.split("/")[0]
  try {
    const info = await github<{ default_branch: string }>(
      input.token,
      "GET",
      repo
    )
    if (info.default_branch === input.branch) return null
    const head = encodeURIComponent(`${owner}:${input.branch}`)
    const [existing] = await github<{ html_url: string }[]>(
      input.token,
      "GET",
      `${repo}/pulls?state=open&head=${head}&per_page=1`
    )
    if (existing) return { url: existing.html_url, open: true }
    const branchPath = input.branch.split("/").map(encodeURIComponent).join("/")
    return {
      url: `https://github.com/${input.repoFullName}/pull/new/${branchPath}`,
      open: false,
    }
  } catch {
    return null
  }
}
