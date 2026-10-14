import { router } from "expo-router"

// One of Lor's files, or an upload by its message and position: the viewer
// finds an upload through its message, so the message's access check applies.
export type FileTarget =
  | { artifactId: string }
  | { messageId: string; index: number }

export function openFile(target: FileTarget) {
  router.push({
    pathname: "/file",
    params:
      "artifactId" in target
        ? { artifactId: target.artifactId }
        : { messageId: target.messageId, index: String(target.index) },
  })
}
