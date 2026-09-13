import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createInstallationAccessToken: vi.fn(),
  createPullRequest: vi.fn(),
}))

vi.mock("@repo/env/server", () => ({
  env: {
    GITHUB_APP_ID: "1",
    GITHUB_APP_PRIVATE_KEY: "test-key",
  },
}))

vi.mock("octokit", () => ({
  App: class {
    octokit = {
      rest: {
        apps: {
          createInstallationAccessToken: mocks.createInstallationAccessToken,
        },
      },
    }
  },
  Octokit: class {
    rest = {
      pulls: {
        create: mocks.createPullRequest,
      },
    }
  },
}))

import { openPullRequest } from "./github"

describe("openPullRequest", () => {
  beforeEach(() => {
    mocks.createInstallationAccessToken.mockReset().mockResolvedValue({
      data: { token: "installation-token" },
    })
    mocks.createPullRequest.mockReset().mockResolvedValue({
      data: {
        number: 42,
        html_url: "https://github.com/acme/private-repo/pull/42",
        draft: true,
      },
    })
  })

  it("keeps private repository refs readable while creating a pull request", async () => {
    await expect(
      openPullRequest("123", {
        repoFullName: "acme/private-repo",
        head: "lor/fix-private-repo-a1b2c3d4",
        base: "main",
        title: "Fix private repository PRs",
        body: "Summary",
      })
    ).resolves.toEqual({
      ok: true,
      pr: {
        number: 42,
        url: "https://github.com/acme/private-repo/pull/42",
        draft: true,
        created: true,
      },
    })

    expect(mocks.createInstallationAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        installation_id: 123,
        repositories: ["private-repo"],
        permissions: {
          contents: "read",
          pull_requests: "write",
        },
      })
    )
  })
})
