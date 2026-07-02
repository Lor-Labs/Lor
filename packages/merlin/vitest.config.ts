import { defineConfig } from "vitest/config"

const TEST_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "test-secret-not-real",
  ANTHROPIC_API_KEY: "test",
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
    include: ["src/**/*.test.ts"],
    env: TEST_ENV,
  },
})
