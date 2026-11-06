import type { HarnessCommand, ReportedHarnessModel } from "@repo/db/schema"

// The model list Lor's bridge patches put on a turn's finish part, under the
// harness's key: Claude Code's supportedModels, Codex's model/list.
export function reportedModels(
  metadata: unknown,
  key: "claude-code" | "codex"
): ReportedHarnessModel[] | null {
  const models = (
    metadata as Record<string, { models?: unknown } | undefined> | null
  )?.[key]?.models
  if (!Array.isArray(models)) return null
  const reported = models.flatMap((model: Record<string, unknown>) =>
    typeof model?.value === "string" && typeof model.displayName === "string"
      ? [
          {
            value: model.value,
            displayName: model.displayName,
            ...(typeof model.resolvedModel === "string"
              ? { resolvedModel: model.resolvedModel }
              : {}),
            ...(typeof model.description === "string"
              ? { description: model.description }
              : {}),
            supportedEffortLevels: Array.isArray(model.supportedEffortLevels)
              ? model.supportedEffortLevels.filter(
                  (level): level is string => typeof level === "string"
                )
              : [],
            supportsFastMode: model.supportsFastMode === true,
            ...(model.isDefault === true ? { isDefault: true } : {}),
          },
        ]
      : []
  )
  return reported.length > 0 ? reported : null
}

// Claude Code's command list (init `commands`), which Lor's bridge patch puts
// on the finish part beside the models.
export function reportedCommands(metadata: unknown): HarnessCommand[] | null {
  const commands = (
    metadata as Record<string, { commands?: unknown } | undefined> | null
  )?.["claude-code"]?.commands
  if (!Array.isArray(commands)) return null
  const reported = commands.flatMap((command: Record<string, unknown>) =>
    typeof command?.name === "string" && command.name
      ? [
          {
            name: command.name,
            description:
              typeof command.description === "string"
                ? command.description
                : "",
            ...(typeof command.argumentHint === "string" && command.argumentHint
              ? { argumentHint: command.argumentHint }
              : {}),
          },
        ]
      : []
  )
  return reported.length > 0 ? reported : null
}
