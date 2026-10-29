import { defineConfig } from "vitest/config"

// Placeholder values that satisfy `@repo/env/server`'s schema, which parses
// `process.env` at import time (billing modules load it through the Autumn
// client, emails and the beta modules). Nothing here is real, and the setup
// file disables the Autumn SDK. Mirrors apps/api/vitest.config.ts.
const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "test-secret-not-real",
  AI_GATEWAY_API_KEY: "test",
  NEXT_PUBLIC_API_URL: "http://localhost:8080",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY_ID: "test",
  S3_SECRET_ACCESS_KEY: "test",
  S3_BUCKET_NAME: "test",
  S3_PUBLIC_URL: "http://localhost:9000/test",
  RESEND_API_KEY: "test",
}

export default defineConfig({
  test: {
    environment: "node",
    env: TEST_ENV,
    setupFiles: ["./vitest.setup.ts"],
  },
})
