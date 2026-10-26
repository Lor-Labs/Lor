export type PreviewRepoFile = {
  path: string
  name: string
  contents: string
  previousContents?: string
  added: number
  removed: number
}

function file(
  path: string,
  contents: string,
  change?: { previousContents: string; added: number; removed: number }
): PreviewRepoFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    contents: `${contents.trim()}\n`,
    previousContents: change
      ? `${change.previousContents.trim()}\n`
      : undefined,
    added: change?.added ?? 0,
    removed: change?.removed ?? 0,
  }
}

const exportButton = `import { Button } from "./ui/button"

type ExportButtonProps = {
  isExporting: boolean
  onExport: () => void
}

export function ExportButton({ isExporting, onExport }: ExportButtonProps) {
  return (
    <Button
      onClick={onExport}
      disabled={isExporting}
      aria-busy={isExporting}
    >
      {isExporting ? "Preparing…" : "Export CSV"}
    </Button>
  )
}`

const exportPanel = `import { useState } from "react"
import { downloadExport } from "../lib/export"
import { ExportButton } from "./export-button"
import { Card } from "./ui/card"

export function ExportPanel() {
  const [isExporting, setIsExporting] = useState(false)

  async function onExport() {
    if (isExporting) return
    setIsExporting(true)
    try {
      await downloadExport()
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Card>
      <h2>Export your data</h2>
      <p>Download your workspace activity as a CSV.</p>
      <ExportButton isExporting={isExporting} onExport={onExport} />
    </Card>
  )
}`

// Fictional repo contents, displayed only; the preview never executes them.
export const PREVIEW_REPO: [PreviewRepoFile, ...PreviewRepoFile[]] = [
  file("src/components/export-button.tsx", exportButton, {
    previousContents: exportButton
      .replace("      disabled={isExporting}\n", "")
      .replace("      aria-busy={isExporting}\n", "")
      .replace('{isExporting ? "Preparing…" : "Export CSV"}', "Export CSV"),
    added: 3,
    removed: 1,
  }),
  file("src/components/export-panel.tsx", exportPanel, {
    previousContents: exportPanel.replace(
      `    if (isExporting) return
    setIsExporting(true)
    try {
      await downloadExport()
    } finally {
      setIsExporting(false)
    }`,
      "    await downloadExport()"
    ),
    added: 7,
    removed: 1,
  }),
  file(
    "src/components/ui/button.tsx",
    `import type { ComponentProps } from "react"
import { cn } from "../../lib/utils"

export function Button({ className, ...props }: ComponentProps<"button">) {
  return <button className={cn("button", className)} {...props} />
}`
  ),
  file(
    "src/components/ui/card.tsx",
    `import type { ComponentProps } from "react"
import { cn } from "../../lib/utils"

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("card", className)} {...props} />
}`
  ),
  file(
    "src/lib/export.ts",
    `export async function downloadExport() {
  const response = await fetch("/api/exports", { method: "POST" })

  if (!response.ok) {
    throw new Error("We couldn’t prepare your export. Please try again.")
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "workspace-activity.csv"
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}`
  ),
  file(
    "src/lib/utils.ts",
    `import { clsx, type ClassValue } from "clsx"

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}`
  ),
  file(
    "src/styles/globals.css",
    `:root {
  font-family: Inter, system-ui, sans-serif;
  color: #e8e7e4;
  background: #111110;
}

body { margin: 0; }
main { max-width: 960px; margin: 0 auto; padding: 48px 24px; }

.card {
  padding: 24px;
  border: 1px solid #30302e;
  border-radius: 12px;
}

.button {
  padding: 10px 16px;
  border: 0;
  border-radius: 8px;
  background: #e8e7e4;
  color: #111110;
  cursor: pointer;
}

.button:disabled { opacity: 0.6; cursor: wait; }`
  ),
  file(
    "src/app.tsx",
    `import { ExportPanel } from "./components/export-panel"

export function App() {
  return (
    <main>
      <header>
        <h1>Workspace activity</h1>
        <p>Your team’s work, ready to share.</p>
      </header>
      <ExportPanel />
    </main>
  )
}`
  ),
  file(
    "src/main.tsx",
    `import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./app"
import "./styles/globals.css"

const root = document.getElementById("root")
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}`
  ),
  file(".gitignore", "node_modules/\ndist/\n.env.local\n.DS_Store"),
  file(
    "index.html",
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Kestrel · Workspace activity</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`
  ),
  file(
    "package.json",
    `{
  "name": "kestrel-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "clsx": "^2.1.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0"
  }
}`
  ),
  file(
    "README.md",
    `# Kestrel

A shared workspace for customer activity and reporting.

## Development

Install dependencies with pnpm install, then run pnpm dev.

## Project structure

- src/components — workspace UI and export controls
- src/lib — downloads and shared utilities
- src/styles — app styles

## Exports

Workspace activity downloads as a CSV. The export button shows
“Preparing…” while a request runs and resets when it finishes.`
  ),
  file(
    "tsconfig.json",
    `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}`
  ),
  file(
    "vite.config.ts",
    `import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})`
  ),
]

export const PREVIEW_CHANGED_FILES = PREVIEW_REPO.filter(
  (file) => file.previousContents !== undefined
)

export const PREVIEW_CHANGE_TOTALS = PREVIEW_CHANGED_FILES.reduce(
  (total, file) => ({
    added: total.added + file.added,
    removed: total.removed + file.removed,
  }),
  { added: 0, removed: 0 }
)
