import { Button } from "@repo/ui/components/button"
import { useState } from "react"
import {
  CodeTargetPicker,
  type SessionMode,
  SessionModeSwitch,
  useCodeTarget,
} from "@/components/session/code-target-picker"
import { useCodeEnvironment } from "@/hooks/use-environments"

// `@Lor` in channel chat or a human thread: Chat | Code for the session it
// starts, and the repo and branch in Code mode, shown in the composer's Lor
// state. Lor's own agent runs it on the default model; Claude Code, Codex
// and model choice stay on the New session page. Starts on Chat on every
// page load: the New session page's saved mode doesn't carry over.
export function useLorStartMode({
  workspaceSlug,
  channelId,
}: {
  workspaceSlug: string
  channelId: string
}) {
  const [mode, setMode] = useState<SessionMode>("chat")
  const code = useCodeTarget({
    workspaceSlug,
    channelId,
    enabled: mode === "code",
  })
  // The person's environment pick for the repo on the New session page.
  const environment = useCodeEnvironment(
    workspaceSlug,
    mode === "code" ? code.repo : null
  )
  // Sending waits for the environment list so a remembered pick isn't
  // dropped; a failed load needs Retry or an explicit start without one.
  const [withoutEnvironmentFor, setWithoutEnvironmentFor] = useState<
    string | null
  >(null)
  const environmentFailed =
    environment.failed && withoutEnvironmentFor !== code.repo
  const target =
    mode === "code" && code.target
      ? {
          ...code.target,
          ...(environment.selected
            ? { environmentId: environment.selected.id }
            : {}),
        }
      : null

  return {
    tools: (
      <>
        <SessionModeSwitch mode={mode} onChange={setMode} />
        {mode === "code" && (
          <CodeTargetPicker
            workspaceSlug={workspaceSlug}
            channelId={channelId}
            code={code}
          />
        )}
        {mode === "code" && code.repo && environmentFailed && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="min-w-0 truncate text-muted-foreground">
              Couldn't load environments
            </span>
            <Button size="xs" variant="outline" onClick={environment.retry}>
              Retry
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setWithoutEnvironmentFor(code.repo)}
            >
              Start without
            </Button>
          </span>
        )}
      </>
    ),
    sendBlocked:
      mode === "code" &&
      (!code.target || environment.loading || environmentFailed),
    // Only a send that starts a session reads it.
    sendOptions: target ? { code: target } : {},
  }
}
