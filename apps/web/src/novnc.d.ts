// The parts of noVNC's RFB client the session browser's live view uses
// (@novnc/novnc ships no types).
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      url: string,
      options?: { wsProtocols?: string[]; shared?: boolean }
    )
    viewOnly: boolean
    scaleViewport: boolean
    clipViewport: boolean
    resizeSession: boolean
    focusOnClick: boolean
    background: string
    qualityLevel: number
    compressionLevel: number
    disconnect(): void
    focus(): void
    clipboardPasteFrom(text: string): void
  }
}
