import { vi } from "vitest"

// @repo/env loads the repo .env outside production, so a developer's real
// AUTUMN_SECRET_KEY can reach these tests. Billing tests must never call
// Autumn: any real client construction fails instead of sending requests.
vi.mock("autumn-js", () => ({
  Autumn: class {
    constructor() {
      throw new Error("Autumn is disabled in billing tests")
    }
  },
}))
