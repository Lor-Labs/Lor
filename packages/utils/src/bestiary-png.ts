import { deflateSync } from "node:zlib"
import {
  type CreatureId,
  creatureById,
  pixelColor,
  SPRITE_SIZE,
} from "./bestiary"

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, "ascii")
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

// A creature as a transparent PNG, each sprite pixel `scale` pixels wide:
// Discord webhook avatars, emails and push notifications, where the app's
// SVG sprite can't render.
export function creaturePng(id: CreatureId, scale = 8): Buffer {
  const art = { ...creatureById(id), rows: creatureById(id).open }
  const size = SPRITE_SIZE * scale
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const color = pixelColor(
        art,
        Math.floor(x / scale),
        Math.floor(y / scale)
      )
      if (!color) continue
      const at = y * (size * 4 + 1) + 1 + x * 4
      raw[at] = Number.parseInt(color.slice(1, 3), 16)
      raw[at + 1] = Number.parseInt(color.slice(3, 5), 16)
      raw[at + 2] = Number.parseInt(color.slice(5, 7), 16)
      raw[at + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ])
}
