import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import { piWorkDir } from "../session-core/work-dir"

// The code session's repo folder in its sandbox.
export const sessionWorkDir = (sessionId: string) =>
  piWorkDir(WORKSPACE_MOUNT, sessionId)
