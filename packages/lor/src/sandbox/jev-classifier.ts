import { createHash } from "node:crypto"
import { db, schema } from "@repo/db"
import { experimental_decide as decide } from "ai"
import { logger } from "../logger"
import {
  LOR_SANDBOX_CLASSIFIER_MODEL,
  lorSandboxClassifierModel,
} from "../models"
import { emitUsage, type OnUsage } from "../usage"
import type { ClassifierVerdict, SandboxClassifier } from "./classifier"
import {
  CLASSIFIER_POLICY_VERSION,
  CLASSIFIER_QUESTIONS,
  CLASSIFIER_THRESHOLDS,
  classifierVerdict,
} from "./classifier-policy"

const TIMEOUT_MS = 8_000

export function jevSandboxClassifier(options: {
  workspaceId: string
  runId: string
  onUsage?: OnUsage
}): SandboxClassifier {
  return {
    id: `${LOR_SANDBOX_CLASSIFIER_MODEL}/policy-${CLASSIFIER_POLICY_VERSION}`,
    async classify(input, signal) {
      signal?.throwIfAborted()
      if (input.incomplete) {
        return {
          allow: false,
          reason: "could not be fully inspected by the safety classifier",
        }
      }
      const { toolCallId, ...state } = input
      const start = performance.now()
      let verdict: ClassifierVerdict
      let response:
        | Awaited<ReturnType<typeof lorSandboxClassifierModel.doDecide>>
        | undefined
      let error: string | null = null
      try {
        const result = await decide({
          // Capture usage and answers before the SDK throws on a refusal or
          // malformed answer; those requests still incurred provider cost.
          model: {
            specificationVersion:
              lorSandboxClassifierModel.specificationVersion,
            provider: lorSandboxClassifierModel.provider,
            modelId: lorSandboxClassifierModel.modelId,
            supportedQuestionTypes:
              lorSandboxClassifierModel.supportedQuestionTypes,
            doDecide: async (options) => {
              response = await lorSandboxClassifierModel.doDecide(options)
              return response
            },
          },
          questions: CLASSIFIER_QUESTIONS,
          state: JSON.stringify(state),
          maxRetries: 0,
          abortSignal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
            : AbortSignal.timeout(TIMEOUT_MS),
        })
        if (
          result.response.modelId.split("/").at(-1) !==
          LOR_SANDBOX_CLASSIFIER_MODEL.split("/").at(-1)
        ) {
          throw new Error("Classifier model version changed")
        }
        verdict = classifierVerdict(result.answers)
      } catch (err) {
        // Never put provider errors (which can echo inputs) on an approval card.
        error = err instanceof Error ? err.name : "ClassifierError"
        logger.warn({ error, toolCallId }, "Sandbox classifier failed closed")
        verdict = {
          allow: false,
          reason:
            "could not be checked because the safety classifier was unavailable or refused to answer",
        }
      }
      const rawCost = response?.providerMetadata?.gateway?.cost
      const cost = rawCost == null ? NaN : Number(rawCost)
      verdict.costUsd = Number.isFinite(cost) && cost >= 0 ? cost : undefined
      if (response) {
        emitUsage(options.onUsage, {
          workspaceId: options.workspaceId,
          tool: "lor.sandbox.classify",
          model: response.response?.modelId ?? LOR_SANDBOX_CLASSIFIER_MODEL,
          requestedModel: LOR_SANDBOX_CLASSIFIER_MODEL,
          inputTokens: response.usage?.inputTokens,
          outputTokens: response.usage?.outputTokens,
          costUsd: verdict.costUsd,
          wallMs: Math.round(performance.now() - start),
          metadata: { toolCallId, policyVersion: CLASSIFIER_POLICY_VERSION },
        })
      }
      signal?.throwIfAborted()
      try {
        await db.insert(schema.sandboxClassification).values({
          workspaceId: options.workspaceId,
          runId: options.runId,
          toolCallId: toolCallId ?? "unknown",
          model: response?.response?.modelId ?? LOR_SANDBOX_CLASSIFIER_MODEL,
          policyVersion: CLASSIFIER_POLICY_VERSION,
          inputSha256: createHash("sha256")
            .update(JSON.stringify(state))
            .digest("hex"),
          input: state,
          answers: response?.answers ?? null,
          thresholds: CLASSIFIER_THRESHOLDS,
          outcome: verdict.allow ? "allow" : input.autonomous ? "deny" : "ask",
          reason: verdict.reason,
          error,
          costUsd: verdict.costUsd?.toFixed(10),
          wallMs: Math.round(performance.now() - start),
        })
      } catch {
        logger.warn(
          { toolCallId },
          "Sandbox classifier audit could not be saved"
        )
        return { allow: false, reason: "could not save the safety decision" }
      }
      return verdict
    },
  }
}
