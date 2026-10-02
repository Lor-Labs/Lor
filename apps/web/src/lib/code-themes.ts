import type { BundledTheme } from "shiki"

// Light/dark Shiki themes for code blocks, shared by sent messages and the
// composer so a block looks the same before and after send.
export const CODE_THEMES: [BundledTheme, BundledTheme] = [
  "github-light",
  "github-dark-dimmed",
]
