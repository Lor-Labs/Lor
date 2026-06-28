import { env } from "@repo/env/server"
import { App } from "octokit"
import { logger } from "../logger"
import type { SourceProvider } from "./types"

// One App, lazily built from env. Null when the App isn't configured — callers
// then fall back to the stored summary.
function fromBase64(s: string): string | undefined {
  try {
    return Buffer.from(s, "base64").toString("utf8")
  } catch {
    return undefined
  }
}

// Re-wrap a PEM to canonical form. .env frequently strips the newlines, gluing
// header+body+footer onto one line, which OpenSSL can't decode. Pull out the
// base64 body and re-emit with header/footer on their own lines + 64-char body.
function rewrapPem(key: string): string {
  const match = key.match(
    /-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/
  )
  const type = match?.[1]
  if (!type) return key
  const body = (match[2] ?? "").replace(/\s+/g, "")
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body
  return `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----\n`
}

// GitHub App private keys are a frequent env footgun. Accept any storage form: a
// normal multi-line PEM, a single-line PEM (newlines stripped by .env), one with
// escaped \n, or the whole PEM base64-encoded — then canonicalize.
function normalizePrivateKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let key = raw.trim()
  if (!key.includes("-----BEGIN")) {
    const decoded = fromBase64(key)
    if (decoded?.includes("-----BEGIN")) key = decoded
  }
  key = key.replace(/\\n/g, "\n")
  return rewrapPem(key)
}

let cachedApp: App | null | undefined
function getApp(): App | null {
  if (cachedApp !== undefined) return cachedApp
  const appId = env.GITHUB_APP_ID
  const raw = env.GITHUB_APP_PRIVATE_KEY
  const privateKey = normalizePrivateKey(raw)
  // One-time diagnostic — only safe metadata (never key bytes). After rewrap a
  // valid key is ~28 lines; pemType is the BEGIN label (PKCS#1 = "RSA PRIVATE
  // KEY", PKCS#8 = "PRIVATE KEY").
  if (raw) {
    logger.info(
      {
        appIdSet: Boolean(appId),
        keyLength: privateKey?.length ?? 0,
        pemType: privateKey?.match(/-----BEGIN ([A-Z0-9 ]+?)-----/)?.[1] ?? "?",
        lineCount: privateKey?.split("\n").length ?? 0,
      },
      "GitHub App private key loaded"
    )
  }
  cachedApp = appId && privateKey ? new App({ appId, privateKey }) : null
  return cachedApp
}

const MAX_CONTENT = 8000
const MAX_COMMENTS = 10

// Mint a short-lived installation access token for cloning private repos into a
// sandbox. Scoped to the installation; expires in ~1h. Null when the App isn't
// configured or the id is invalid.
export async function getInstallationToken(
  installationId: string
): Promise<string | null> {
  const app = getApp()
  if (!app) {
    logger.warn(
      "GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) — cannot mint an installation token"
    )
    return null
  }
  const id = Number(installationId)
  if (!Number.isFinite(id)) {
    logger.warn({ installationId }, "Invalid GitHub installation id")
    return null
  }
  try {
    const { data } = await app.octokit.rest.apps.createInstallationAccessToken({
      installation_id: id,
    })
    return data.token
  } catch (err) {
    logger.error(
      { err, installationId: id },
      "Failed to mint GitHub installation access token"
    )
    return null
  }
}

function clip(s: string): string {
  return s.length > MAX_CONTENT ? `${s.slice(0, MAX_CONTENT)}\n…(truncated)` : s
}

// externalId is "owner/repo#<number>" (PR/issue) or "owner/repo@<id>" (release).
function parseRef(externalId: string, sep: "#" | "@") {
  const [ownerRepo, tail] = externalId.split(sep)
  const [owner, repo] = (ownerRepo ?? "").split("/")
  const id = Number(tail)
  if (!owner || !repo || !Number.isFinite(id)) return null
  return { owner, repo, id }
}

export const githubProvider: SourceProvider = {
  async fetchContent(source, connection) {
    const app = getApp()
    if (!app) return null
    const installationId = Number(connection.externalId)
    if (!Number.isFinite(installationId)) return null
    const octokit = await app.getInstallationOctokit(installationId)

    if (source.kind === "pull_request") {
      const ref = parseRef(source.externalId, "#")
      if (!ref) return null
      const { data } = await octokit.rest.pulls.get({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.id,
      })
      const state = data.merged ? "merged" : data.state
      let out = `# ${data.title}\nState: ${state} · by ${data.user?.login ?? "unknown"}\n\n${data.body ?? "(no description)"}`
      // PRs are issues under the hood — the conversation thread plus the
      // inline code-review comments are the discussion we want as memory.
      const [comments, reviewComments] = await Promise.all([
        octokit.rest.issues
          .listComments({
            owner: ref.owner,
            repo: ref.repo,
            issue_number: ref.id,
            per_page: MAX_COMMENTS,
          })
          .then((r) => r.data)
          .catch(() => []),
        octokit.rest.pulls
          .listReviewComments({
            owner: ref.owner,
            repo: ref.repo,
            pull_number: ref.id,
            per_page: MAX_COMMENTS,
          })
          .then((r) => r.data)
          .catch(() => []),
      ])
      for (const cm of comments) {
        out += `\n\n— ${cm.user?.login ?? "unknown"}: ${cm.body ?? ""}`
      }
      for (const rc of reviewComments) {
        out += `\n\n— ${rc.user?.login ?? "unknown"} on ${rc.path}: ${rc.body ?? ""}`
      }
      return clip(out)
    }

    if (source.kind === "issue") {
      const ref = parseRef(source.externalId, "#")
      if (!ref) return null
      const { data } = await octokit.rest.issues.get({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.id,
      })
      let out = `# ${data.title}\nState: ${data.state} · by ${data.user?.login ?? "unknown"}\n\n${data.body ?? "(no description)"}`
      const comments = await octokit.rest.issues
        .listComments({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: ref.id,
          per_page: MAX_COMMENTS,
        })
        .then((r) => r.data)
        .catch(() => [])
      for (const cm of comments) {
        out += `\n\n— ${cm.user?.login ?? "unknown"}: ${cm.body ?? ""}`
      }
      return clip(out)
    }

    if (source.kind === "release") {
      const ref = parseRef(source.externalId, "@")
      if (!ref) return null
      const { data } = await octokit.rest.repos.getRelease({
        owner: ref.owner,
        repo: ref.repo,
        release_id: ref.id,
      })
      return clip(
        `# ${data.name ?? data.tag_name}\n\n${data.body ?? "(no notes)"}`
      )
    }

    return null
  },

  async verifyConnection(connection) {
    const app = getApp()
    if (!app) return null
    const installationId = Number(connection.externalId)
    if (!Number.isFinite(installationId)) return null
    try {
      const { data } = await app.octokit.rest.apps.getInstallation({
        installation_id: installationId,
      })
      const account = data.account
      const accountLabel = account && "login" in account ? account.login : null
      return { accountLabel }
    } catch {
      return null
    }
  },
}
