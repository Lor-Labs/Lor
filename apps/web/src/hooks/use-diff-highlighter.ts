import {
  DEFAULT_THEMES,
  getFiletypeFromFileName,
  getHighlighterOptions,
  isHighlighterLoaded,
  preloadHighlighter,
} from "@pierre/diffs"
import { useEffect, useState } from "react"

// FileDiff paints nothing if it mounts before the shared Shiki highlighter
// has ever loaded (its lazy init doesn't repaint this instance), so gate the
// first mount on an explicit preload — later mounts find it warm and skip.
export function useDiffHighlighterReady(fileName: string) {
  const [ready, setReady] = useState(isHighlighterLoaded)
  useEffect(() => {
    if (ready) return
    let cancelled = false
    void preloadHighlighter(
      getHighlighterOptions(getFiletypeFromFileName(fileName), {
        theme: DEFAULT_THEMES,
      })
    )
      .catch(() => {
        // Failed preload: render the diff unhighlighted instead of spinning
        // forever.
      })
      .then(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [ready, fileName])
  return ready
}
