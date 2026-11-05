// Lor's session-browser commands (`lor-browser …`, reference/planned/
// sandbox-browser-runbook.md §4) as transcript steps people can read: "Ran
// lor-browser click @e3" shows as "Clicked on the page". Display only: the
// stored label keeps the command. Null for any other command, and for
// chained ones, which stay as the command Lor ran.

export type BrowserStep = { verb: string; target: string | null }

const CHAINED = /&&|\|\||[;|`\n]|\$\(/
const TOKENS = /"[^"]*"|'[^']*'|\S+/g

const unquote = (token: string) => token.replace(/^(["'])([\s\S]*)\1$/, "$2")

// `http://localhost:3000/` → `localhost:3000`.
const shortUrl = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "")

const ELEMENT_VERBS: Record<string, string> = {
  click: "Clicked",
  dblclick: "Double-clicked",
  hover: "Pointed at",
  focus: "Focused",
  highlight: "Highlighted",
  scrollintoview: "Scrolled to",
}

const PAGE_STEPS: Record<string, string> = {
  snapshot: "Read the page",
  screenshot: "Took a screenshot",
  pdf: "Saved the page as a PDF",
  get: "Checked the page",
  is: "Checked the page",
  console: "Read the console",
  errors: "Read the page errors",
  back: "Went back",
  forward: "Went forward",
  reload: "Reloaded the page",
  scroll: "Scrolled the page",
  wait: "Waited for the page",
  fill: "Filled a field",
  type: "Typed into a field",
  keyboard: "Typed on the keyboard",
  select: "Chose an option",
  check: "Checked a box",
  uncheck: "Unchecked a box",
  upload: "Uploaded a file",
  download: "Downloaded a file",
  eval: "Ran a script on the page",
  drag: "Dragged on the page",
  mouse: "Used the mouse",
}

// Commands `lor-browser` runs while a person has control (they only look).
const OBSERVE_ONLY = new Set([
  "snapshot",
  "screenshot",
  "get",
  "is",
  "console",
  "errors",
  "session",
  "skills",
])

// A `lor-browser` command that needs the browser: while a person has control
// it asks for it back and waits (sandbox-image/browser/lor-browser).
export function needsBrowserControl(command: string): boolean {
  const text = command.trim()
  if (!/^lor-browser(\s|$)/.test(text) || CHAINED.test(text)) return false
  const name = (text.match(TOKENS) ?? [])
    .slice(1)
    .find((token) => !token.startsWith("-"))
  return name !== undefined && !OBSERVE_ONLY.has(unquote(name))
}

export function browserStep(command: string): BrowserStep | null {
  const text = command.trim()
  if (!/^lor-browser(\s|$)/.test(text) || CHAINED.test(text)) return null
  const args = (text.match(TOKENS) ?? [])
    .slice(1)
    .filter((token) => !token.startsWith("-"))
    .map(unquote)
  const [name, first, second] = args
  if (!name) return { verb: "Used the browser", target: null }
  if (name === "open" && first)
    return { verb: "Opened", target: shortUrl(first) }
  if (name === "tab") {
    if (first === "new" && second) {
      return { verb: "Opened a tab at", target: shortUrl(second) }
    }
    return {
      verb: first === "close" ? "Closed a tab" : "Switched tabs",
      target: null,
    }
  }
  if (name === "press" && first) return { verb: "Pressed", target: first }
  const elementVerb = ELEMENT_VERBS[name]
  if (elementVerb) {
    // A snapshot ref (@e3) means nothing to people; a selector or text does.
    return first && !first.startsWith("@")
      ? { verb: elementVerb, target: first }
      : { verb: `${elementVerb} an element`, target: null }
  }
  return { verb: PAGE_STEPS[name] ?? "Used the browser", target: null }
}
