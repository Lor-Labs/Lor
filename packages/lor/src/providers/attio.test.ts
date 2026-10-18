import { describe, expect, it } from "vitest"
import {
  ATTIO_REQUIRED_READ_SCOPES,
  ATTIO_WEBHOOK_SCOPE,
  formatAttioTranscript,
  validateAttioReadScopes,
} from "./attio"

describe("validateAttioReadScopes", () => {
  const complete = [...ATTIO_REQUIRED_READ_SCOPES, ATTIO_WEBHOOK_SCOPE].join(
    " "
  )

  it("accepts the complete read scope set plus the webhook scope", () => {
    expect(validateAttioReadScopes(complete)).toBe(true)
  })

  it("rejects a connection missing an activity read scope", () => {
    expect(
      validateAttioReadScopes(
        [
          ...ATTIO_REQUIRED_READ_SCOPES.filter(
            (scope) => scope !== "call_recording:read"
          ),
          ATTIO_WEBHOOK_SCOPE,
        ].join(" ")
      )
    ).toBe(false)
  })

  it("rejects a connection missing the webhook scope", () => {
    expect(validateAttioReadScopes(ATTIO_REQUIRED_READ_SCOPES.join(" "))).toBe(
      false
    )
  })

  it("rejects unsupported read-write scopes even when the set is complete", () => {
    expect(
      validateAttioReadScopes(`${complete} object_configuration:read-write`)
    ).toBe(false)
  })
})

describe("formatAttioTranscript", () => {
  it("groups consecutive same-speaker segments into one line", () => {
    const text = formatAttioTranscript(
      [
        { speech: "Hello,", speaker: "Alex Bell", endTime: 0.8 },
        { speech: "Mr Watson, come here.", speaker: "Alex Bell", endTime: 2.1 },
        { speech: "On my way.", speaker: "Thomas Watson", endTime: 3.4 },
      ],
      10_000
    )
    expect(text).toBe(
      "Alex Bell: Hello, Mr Watson, come here.\nThomas Watson: On my way."
    )
  })

  it("caps the total length", () => {
    const text = formatAttioTranscript(
      [{ speech: "x".repeat(500), speaker: "A", endTime: 1 }],
      100
    )
    expect(text.length).toBe(101)
    expect(text.endsWith("…")).toBe(true)
  })
})
