import {
  areLanguagesAttached,
  areThemesAttached,
  DEFAULT_THEMES,
  getFiletypeFromFileName,
  getHighlighterOptions,
  preloadHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs"
import { codeLanguageForPath } from "@repo/utils/file-preview"
import { useEffect, useState } from "react"

export function repoFileLanguage(fileName: string): SupportedLanguages {
  return (codeLanguageForPath(fileName) ??
    getFiletypeFromFileName(fileName)) as SupportedLanguages
}

// Each file needs its own grammar ready, even when another language has
// already initialized the shared highlighter.
export function useDiffHighlighter(fileName: string) {
  const language = repoFileLanguage(fileName)
  const [settled, setSettled] = useState<{
    language: SupportedLanguages
    failed: boolean
  } | null>(null)
  const loaded =
    areLanguagesAttached(language) && areThemesAttached(DEFAULT_THEMES)
  useEffect(() => {
    if (loaded) return
    let cancelled = false
    void preloadHighlighter(
      getHighlighterOptions(language, {
        theme: DEFAULT_THEMES,
      })
    ).then(
      () => {
        if (!cancelled) setSettled({ language, failed: false })
      },
      () => {
        if (!cancelled) setSettled({ language, failed: true })
      }
    )
    return () => {
      cancelled = true
    }
  }, [loaded, language])
  return {
    ready: loaded || settled?.language === language,
    language:
      !loaded && settled?.language === language && settled.failed
        ? ("text" as const)
        : language,
  }
}

export function useDiffHighlighterReady(fileName: string) {
  return useDiffHighlighter(fileName).ready
}
