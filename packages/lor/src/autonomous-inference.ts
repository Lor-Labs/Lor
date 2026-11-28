import {
  assertBetaSandbox,
  assertWorkspaceActive,
} from "@repo/db/queries/beta-access"
import { assertInferenceKeyCurrent } from "@repo/db/queries/inference"
import { getHarnessSettings } from "@repo/db/queries/personal-accounts"
import type { HarnessAccountRoute } from "@repo/db/schema"
import type { InferenceFunding } from "@repo/utils/inference"
import {
  InferenceConfigError,
  keyFunding,
  nativeInference,
  nativeLanguageModel,
} from "./byok"
import { LOR_MODEL, lorGatewayModel } from "./models"
import { inGatewayCatalog } from "./session-core/pi-runtime"

// Post-answer work (an agent's memory pass, write-back) runs on the agent's
// model, paid by Lor credits or a workspace provider key, never on a
// subscription: subscriptions pay only for coding sessions (Jacob, 11-27).
// With no agent, Lor's own model on Lor credits.
export async function autonomousInference(
  workspaceId: string,
  agentId: string | null,
  _runId?: string
) {
  const settings = await getHarnessSettings({ agentId })
  const funding: InferenceFunding = (await keyFunding(
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
    throw new InferenceConfigError(
      "The agent's AI provider or model is unavailable. Change its model in its settings, or check Workspace settings → AI providers."
    )
  const assertCanInfer = async () => {
    await assertWorkspaceActive(workspaceId)
    await assertInferenceKeyCurrent(workspaceId, funding)
    await assertBetaSandbox(workspaceId)
  }
  await assertCanInfer()
  const native =
    funding.source === "byok"
      ? await nativeInference(workspaceId, funding)
      : null
  return {
    // No subscription route any more; kept in the shape its callers read.
    route: null as HarnessAccountRoute | null,
    funding,
    subscription: false,
    byok: funding.source === "byok",
    model: native
      ? nativeLanguageModel(native)
      : lorGatewayModel(funding.model ?? LOR_MODEL),
    assertCanInfer,
    close: async () => {},
  }
}
