import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import { piWorkDir } from "../session-core/work-dir"

// The code session's repo folder in its sandbox.
export const sessionWorkDir = (sessionId: string) =>
  piWorkDir(WORKSPACE_MOUNT, sessionId)

// The repo's run setup: install command and dev servers (repo-setup.ts).
export const REPO_SETUP_FILE = ".lor/environment.json"
