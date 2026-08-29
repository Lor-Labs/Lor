import { describe, expect, it } from "vitest"
import {
  assertJpegOutputSize,
  heifExceedsPixelLimit,
  MAX_IMAGE_BYTES,
  readHeifDimensions,
} from "./images"

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.byteLength, 0)
  )
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const body = concatenate(...payload)
  const result = new Uint8Array(8 + body.byteLength)
  const view = new DataView(result.buffer)
  view.setUint32(0, result.byteLength)
  for (let index = 0; index < type.length; index += 1) {
    result[4 + index] = type.charCodeAt(index)
  }
  result.set(body, 8)
  return result
}

function heifWithDimensions(width: number, height: number): Uint8Array {
  const spatialExtents = new Uint8Array(12)
  const view = new DataView(spatialExtents.buffer)
  view.setUint32(4, width)
  view.setUint32(8, height)

  return box(
    "meta",
    new Uint8Array(4),
    box("iprp", box("ipco", box("ispe", spatialExtents)))
  )
}

describe("HEIF image limits", () => {
  it("reads standard spatial-extents metadata", () => {
    expect(readHeifDimensions(heifWithDimensions(8064, 6048))).toEqual([
      { width: 8064, height: 6048 },
    ])
  })

  it("rejects metadata over the pixel limit", () => {
    expect(heifExceedsPixelLimit(heifWithDimensions(10_000, 5_000))).toBe(false)
    expect(heifExceedsPixelLimit(heifWithDimensions(10_001, 5_000))).toBe(true)
  })

  it("continues when dimensions are unavailable", () => {
    expect(heifExceedsPixelLimit(box("meta", new Uint8Array(4)))).toBe(false)
    expect(heifExceedsPixelLimit(new Uint8Array([0, 0, 0, 100]))).toBe(false)
  })

  it("caps converted JPEG output bytes", () => {
    expect(() =>
      assertJpegOutputSize(new Uint8Array(MAX_IMAGE_BYTES))
    ).not.toThrow()
    expect(() =>
      assertJpegOutputSize(new Uint8Array(MAX_IMAGE_BYTES + 1))
    ).toThrow("Converted JPEG exceeds the image byte limit")
  })
})
