"use client"

import {
  areLanguagesAttached,
  areThemesAttached,
  DEFAULT_THEMES,
  getFiletypeFromFileName,
  getHighlighterOptions,
  parseDiffFromFile,
  preloadHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs"
import { File as CodeFile, FileDiff } from "@pierre/diffs/react"
import { codeLanguageForPath } from "@repo/utils/file-preview"
import { useEffect, useMemo, useState } from "react"
import type { PreviewRepoFile } from "@/app/components/preview-repo"

// Match repo-file-view and session-changes-panel in the app, including the
// Pierre theme, font metrics, and unified diffs without gutters or +/- markers.
const CODE_CSS = `:host {
  --diffs-light-bg: var(--card);
  --diffs-dark-bg: var(--card);
  --diffs-font-family: var(--font-mono);
  --diffs-font-size: 12.5px;
  --diffs-line-height: 20px;
}`

function usePreviewHighlighter(path: string) {
  const language = (codeLanguageForPath(path) ??
    getFiletypeFromFileName(path)) as SupportedLanguages
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
      getHighlighterOptions(language, { theme: DEFAULT_THEMES })
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

export default function PreviewCodeView({
  file,
  diff,
}: {
  file: PreviewRepoFile
  diff: boolean
}) {
  const { ready, language } = usePreviewHighlighter(file.path)
  const contents = useMemo(
    () => ({ name: file.path, contents: file.contents, lang: language }),
    [file, language]
  )
  const fileDiff = useMemo(
    () =>
      diff && file.previousContents !== undefined
        ? parseDiffFromFile(
            { ...contents, contents: file.previousContents },
            contents
          )
        : null,
    [contents, diff, file.previousContents]
  )

  if (!ready) {
    return (
      <p
        role="status"
        className="px-3 py-6 text-xs text-lor-text-tertiary-dark"
      >
        Loading code…
      </p>
    )
  }

  return (
    <div className="bg-card py-1.5">
      {fileDiff ? (
        <FileDiff
          fileDiff={fileDiff}
          options={{
            themeType: "dark",
            diffStyle: "unified",
            diffIndicators: "none",
            disableLineNumbers: true,
            hunkSeparators: "simple",
            lineDiffType: "none",
            overflow: "scroll",
            disableFileHeader: true,
            unsafeCSS: CODE_CSS,
          }}
        />
      ) : (
        <CodeFile
          file={contents}
          options={{
            themeType: "dark",
            overflow: "scroll",
            disableFileHeader: true,
            unsafeCSS: CODE_CSS,
          }}
        />
      )}
    </div>
  )
}
