import type RFB from "@novnc/novnc"

// Shortcuts and the clipboard for the session browser's live view, for the
// person in control (reference/planned/sandbox-browser-runbook.md §4). The
// sandbox's Chromium runs on Linux, where shortcuts use Control: on a Mac,
// Command is sent as Control (Cmd+Left/Right as Home/End). macOS sends no
// keyup for keys pressed while Command is held, so those go as taps. Paste
// sends the person's own clipboard text to the sandbox first; text copied
// there right after a copy shortcut comes back to their clipboard (plain
// selections, which x11vnc also sends, never overwrite it).

const XK_CONTROL_L = 0xffe3
const XK_HOME = 0xff50
const XK_END = 0xff57
const XK_V = 0x76
const NAMED_KEYS: Record<string, number> = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  Delete: 0xffff,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
}
const MODIFIERS = new Set(["Shift", "Alt", "Control", "CapsLock"])
const COPY_WINDOW_MS = 3_000
const PASTE_WAIT_MS = 300

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

function keysym(event: KeyboardEvent): number | null {
  if (event.key.length === 1) {
    const code = event.key.toLowerCase().charCodeAt(0)
    return code >= 0x20 && code <= 0x7e ? code : null
  }
  return NAMED_KEYS[event.key] ?? null
}

// The paste event's text, else the async clipboard (Safari asks first).
function readPaste(): Promise<string | null> {
  return new Promise((resolve) => {
    const onPaste = (event: ClipboardEvent) => {
      window.clearTimeout(timer)
      event.preventDefault()
      resolve(event.clipboardData?.getData("text/plain") ?? null)
    }
    const timer = window.setTimeout(() => {
      window.removeEventListener("paste", onPaste, true)
      navigator.clipboard
        ?.readText()
        .then(resolve)
        .catch(() => resolve(null))
    }, PASTE_WAIT_MS)
    window.addEventListener("paste", onPaste, { capture: true, once: true })
  })
}

export function attachBrowserKeys(target: HTMLElement, rfb: RFB) {
  let commandDown = false
  let copiedAt = 0
  // Keys handled here, whose keyup noVNC must not see either.
  const handled = new Set<string>()

  const stop = (event: KeyboardEvent, keepDefault = false) => {
    event.stopPropagation()
    if (!keepDefault) event.preventDefault()
  }
  const releaseCommand = () => {
    if (!commandDown) return
    commandDown = false
    rfb.sendKey(XK_CONTROL_L, "ControlLeft", false)
    // Their keyups may never come; a stale entry would swallow a later one.
    handled.clear()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isMac && event.key === "Meta") {
      stop(event)
      if (!commandDown) {
        commandDown = true
        rfb.sendKey(XK_CONTROL_L, "ControlLeft", true)
      }
      return
    }
    const shortcut = isMac ? commandDown : event.ctrlKey
    if (!shortcut || MODIFIERS.has(event.key)) return
    const key = event.key.toLowerCase()
    if (key === "c" || key === "x") copiedAt = Date.now()
    if (key === "v") {
      // The browser's paste must still happen, so its default stays.
      stop(event, true)
      handled.add(event.code)
      void readPaste().then((text) => {
        if (text) rfb.clipboardPasteFrom(text)
        rfb.sendKey(XK_V, "KeyV")
      })
      return
    }
    // Elsewhere Control already reaches noVNC as itself.
    if (!isMac) return
    stop(event)
    handled.add(event.code)
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // Command+Left/Right: line start/end, without Control.
      rfb.sendKey(XK_CONTROL_L, "ControlLeft", false)
      rfb.sendKey(event.key === "ArrowLeft" ? XK_HOME : XK_END, null)
      rfb.sendKey(XK_CONTROL_L, "ControlLeft", true)
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // Command+Up/Down: document start/end (Control+Home/End).
      rfb.sendKey(event.key === "ArrowUp" ? XK_HOME : XK_END, null)
      return
    }
    const sym = keysym(event)
    if (sym !== null) rfb.sendKey(sym, event.code)
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (isMac && event.key === "Meta") {
      stop(event)
      releaseCommand()
      return
    }
    if (handled.delete(event.code)) stop(event)
  }

  const onClipboard = (event: Event) => {
    const text = (event as CustomEvent<{ text: string }>).detail?.text
    if (!text || Date.now() - copiedAt > COPY_WINDOW_MS) return
    void navigator.clipboard?.writeText(text).catch(() => {})
  }

  // Capture on the view's container: before noVNC's own listeners below it.
  target.addEventListener("keydown", onKeyDown, true)
  target.addEventListener("keyup", onKeyUp, true)
  window.addEventListener("blur", releaseCommand)
  rfb.addEventListener("clipboard", onClipboard)
  return () => {
    releaseCommand()
    target.removeEventListener("keydown", onKeyDown, true)
    target.removeEventListener("keyup", onKeyUp, true)
    window.removeEventListener("blur", releaseCommand)
    rfb.removeEventListener("clipboard", onClipboard)
  }
}
