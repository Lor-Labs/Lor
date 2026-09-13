import { describe, expect, it } from "vitest"
import { buildPiCommand, buildPiModelConfig } from "./pi-config"

describe("buildPiModelConfig", () => {
  it("configures Kimi through Vercel AI Gateway without duplicating rates", () => {
    expect(buildPiModelConfig({ model: "moonshotai/kimi-k3" })).toEqual({
      providers: {
        "vercel-ai-gateway": {
          baseUrl: "https://ai-gateway.vercel.sh/v1",
          api: "openai-completions",
          apiKey: "$AI_GATEWAY_API_KEY",
          models: [
            expect.objectContaining({
              id: "moonshotai/kimi-k3",
              reasoning: true,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1_048_576,
              maxTokens: 32_000,
            }),
          ],
        },
      },
    })
  })

  it("accepts a provider-neutral base URL override", () => {
    const config = buildPiModelConfig({
      baseUrl: "https://gateway.example.test/v1",
      model: "moonshotai/kimi-k3",
    })

    expect(config.providers["vercel-ai-gateway"].baseUrl).toBe(
      "https://gateway.example.test/v1"
    )
  })
})

describe("buildPiCommand", () => {
  it("allows only read-only tools and ignores untrusted repo customizations", () => {
    const command = buildPiCommand("moonshotai/kimi-k3")

    expect(command.startsWith("pi ")).toBe(true)
    expect(command).toContain("--tools read,grep,find,ls")
    expect(command).toContain("--no-session")
    expect(command).toContain("--no-extensions")
    expect(command).toContain("--no-skills")
    expect(command).toContain("--no-prompt-templates")
    expect(command).toContain("--no-context-files")
    expect(command).toContain("--no-approve")
    expect(command).toContain("@/investigation.txt")
  })

  it("rejects model ids that could inject shell commands", () => {
    expect(() => buildPiCommand("model; echo unsafe")).toThrow(
      "Invalid Pi model id"
    )
  })

  it("adds explicit print mode for pi ≥0.71 (Blaxel) while leaving legacy commands unchanged", () => {
    const printCmd = buildPiCommand("moonshotai/kimi-k3", {
      print: true,
      session: {
        dir: "/workspace/.pi-sessions",
        id: "0f0e0d0c-0b0a-4988-8766-554433221100",
      },
    })
    expect(printCmd).toContain(" -p ")
    expect(printCmd).toContain(
      "--session-dir /workspace/.pi-sessions --session-id 0f0e0d0c-0b0a-4988-8766-554433221100"
    )
    expect(printCmd).toContain("--thinking max")
    expect(printCmd).toContain("--no-approve")

    const legacy = buildPiCommand("moonshotai/kimi-k3")
    expect(legacy).not.toContain(" -p ")
  })
})
