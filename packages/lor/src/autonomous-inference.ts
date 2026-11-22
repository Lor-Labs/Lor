import {
  assertBetaSandbox,
  assertHostedHarness,
  assertWorkspaceActive,
} from "@repo/db/queries/beta-access"
import { assertInferenceKeyCurrent } from "@repo/db/queries/inference"
import {
  getWorkspaceHarnessSettings,
  resolveHarnessAccount,
} from "@repo/db/queries/personal-accounts"
import { assertHarnessEnabled } from "@repo/utils/features"
import type { InferenceFunding } from "@repo/utils/inference"
import { agentHarnessModel } from "./agent-harness-model"
import {
  harnessApiConnection,
  harnessApiFunding,
  keyFunding,
  nativeInference,
  nativeLanguageModel,
} from "./byok"
import { LOR_MODEL, lorGatewayModel } from "./models"
import { CLAUDE_CODE_DEFAULT_MODEL } from "./session-core/claude-runtime"
import { CODEX_DEFAULT_MODEL } from "./session-core/codex-runtime"
import { inGatewayCatalog } from "./session-core/pi-runtime"

// Post-answer work has its own workspace payer, independent of the person's turn.
export async function autonomousInference(workspaceId: string, runId?: string) {
  const settings = await getWorkspaceHarnessSettings(workspaceId)
  assertHarnessEnabled(settings.defaultHarness)
  assertHostedHarness(settings.defaultHarness)
  const provider =
    settings.defaultHarness === "claude_code"
      ? "claude"
      : settings.defaultHarness === "codex"
        ? "chatgpt"
        : null
  const route = provider
    ? await resolveHarnessAccount({ workspaceId, userId: null }, provider)
    : null
  const subscription = route?.source === "subscription"
  let funding: InferenceFunding | undefined
  if (route?.source === "api") {
    funding = await harnessApiFunding(
      workspaceId,
      provider === "claude" ? "anthropic" : "openai",
      route.apiBilling ?? "lor",
      undefined,
      provider === "claude"
        ? LOR_MODEL.replace(/^anthropic\//, "")
        : CODEX_DEFAULT_MODEL
    )
  } else if (!subscription) {
    funding = (await keyFunding(
      workspaceId,
      settings.apiModel ?? undefined
    )) ?? {
      source: "lor",
      model:
        settings.apiModel && inGatewayCatalog(settings.apiModel)
          ? settings.apiModel
          : LOR_MODEL,
    }
    if (settings.apiModel?.startsWith("key:") && funding.source !== "byok")
      throw new Error("The autonomous API key or model is unavailable.")
  }
  const assertCanInfer = async () => {
    await assertWorkspaceActive(workspaceId)
    if (!subscription) {
      await assertInferenceKeyCurrent(workspaceId, funding ?? null)
      await assertBetaSandbox(workspaceId)
    }
  }
  await assertCanInfer()
  const native =
    funding?.source === "byok"
      ? await nativeInference(workspaceId, funding)
      : null
  if (route && !runId)
    throw new Error("Autonomous harness inference needs a durable run")
  const harness =
    route && runId
      ? agentHarnessModel({
          route,
          model:
            native?.model ??
            funding?.model ??
            (provider === "claude"
              ? CLAUDE_CODE_DEFAULT_MODEL
              : CODEX_DEFAULT_MODEL),
          run: { runId, assertCanInfer },
          api:
            route.source === "api"
              ? harnessApiConnection(
                  provider === "claude" ? "anthropic" : "openai",
                  funding,
                  native
                )
              : null,
        })
      : null
  return {
    subscription,
    byok: funding?.source === "byok",
    model:
      harness?.model ??
      (native
        ? nativeLanguageModel(native)
        : lorGatewayModel(funding?.model ?? LOR_MODEL)),
    assertCanInfer,
    close: async () => {
      await harness?.close()
    },
  }
}
