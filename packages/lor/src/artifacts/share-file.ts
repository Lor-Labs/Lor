import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import { LOR_USER_ID } from "@repo/db"
import { env } from "@repo/env/server"
import { fileContentType } from "@repo/utils/file-preview"
import { tool } from "ai"
import { z } from "zod"
import { WORKSPACE_MOUNT } from "../sandbox/blaxel"
import { writeArtifactVersion } from "./service"

const shareFileContext = z.object({
  workspaceId: z.string(),
  channelId: z.string(),
  // The session that owns the file: re-sharing a path versions it.
  threadRootId: z.custom<string | null>(),
  // Provenance for new files. A getter because the plan may start mid-run.
  getPlan: z.custom<() => { id: string } | null>(),
  // The conversation's work folder in the sandbox; relative paths start here.
  workDir: z.string(),
})

// Publishes a file from the session sandbox into the session's Files panel
// (artifacts). Sandbox files are private until shared.
export const shareFileTool = {
  share_file: tool({
    description:
      "Share a file from your sandbox with the people in this session: it appears in the session's Files panel, and you get a link to put in your answer. Sharing the same path again publishes a new version of that file. Share only files someone should get, not scratch or intermediate files.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "the file's path in your sandbox, relative to your working folder (e.g. report.csv) or absolute"
        ),
    }),
    contextSchema: shareFileContext,
    execute: async ({ path }, { context, experimental_sandbox: sandbox }) => {
      if (!sandbox) return { error: "this run has no sandbox" }
      const target = posix.isAbsolute(path)
        ? path
        : posix.join(context.workDir, path)
      // Resolved inside the sandbox so a symlink cannot reach outside the
      // workspace volume.
      const probe = await sandbox.run({
        command: `f=$(realpath -e -- ${shellQuote(target)}) && [ -f "$f" ] && printf '%s\\n%s' "$f" "$(stat -c %s -- "$f")"`,
      })
      const [real, sizeText] = probe.stdout.trim().split("\n")
      if (probe.exitCode !== 0 || !real || !sizeText) {
        return { error: `no file at ${path}` }
      }
      if (!real.startsWith(`${WORKSPACE_MOUNT}/`)) {
        return { error: `only files under ${WORKSPACE_MOUNT} can be shared` }
      }
      if (Number(sizeText) > env.LOR_WORKBENCH_MAX_FILE_BYTES) {
        return {
          error: `${path} is ${sizeText} bytes, over the ${env.LOR_WORKBENCH_MAX_FILE_BYTES}-byte limit for a shared file`,
        }
      }
      const bytes = await sandbox.readBinaryFile({ path: real })
      if (!bytes) return { error: `no file at ${path}` }

      const logicalPath = real.startsWith(`${context.workDir}/`)
        ? posix.relative(context.workDir, real)
        : posix.relative(WORKSPACE_MOUNT, real)
      const file = await writeArtifactVersion({
        workspaceId: context.workspaceId,
        channelId: context.channelId,
        threadRootId: context.threadRootId,
        planId: context.getPlan()?.id ?? null,
        path: logicalPath,
        contentType: fileContentType(logicalPath),
        bytes,
        authorType: "agent",
        authorId: LOR_USER_ID,
      })
      return {
        files: [
          {
            path: file.path,
            contentType: file.contentType,
            size: file.size,
            version: file.version,
            artifactId: file.artifactId,
            url: file.url,
          },
        ],
      }
    },
    strict: true,
  }),
}
