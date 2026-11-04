// The code session's browser (reference/planned/sandbox-browser-runbook.md):
// headful Chromium in the sandbox, started by `lor-browser-start` in the
// image. These match its defaults. CDP and VNC stay on 127.0.0.1; only the
// noVNC view port is meant for a preview.
export const BROWSER_CDP_PORT = 9222
export const BROWSER_VNC_PORT = 5900
export const BROWSER_VIEW_PORT = 6080

export const BROWSER_PORTS = [
  BROWSER_CDP_PORT,
  BROWSER_VNC_PORT,
  BROWSER_VIEW_PORT,
]
