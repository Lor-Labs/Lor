import { parentPort } from "node:worker_threads"

const port = parentPort
if (!port) {
  throw new Error("Image conversion worker requires a parent port")
}

port.once("message", async (message: unknown) => {
  try {
    if (
      typeof message !== "object" ||
      message === null ||
      !("bytes" in message) ||
      !(message.bytes instanceof Uint8Array) ||
      !("maxOutputBytes" in message) ||
      typeof message.maxOutputBytes !== "number"
    ) {
      throw new Error("Image conversion worker received invalid input")
    }

    const { default: convert } = await import("heic-convert")
    const converted = await convert({
      buffer: message.bytes,
      format: "JPEG",
      quality: 0.8,
    })
    const jpeg = Uint8Array.from(converted)
    if (jpeg.byteLength > message.maxOutputBytes) {
      throw new Error("Converted JPEG exceeds the image byte limit")
    }
    port.postMessage({ bytes: jpeg }, [jpeg.buffer])
  } catch (error) {
    port.postMessage({
      error: error instanceof Error ? error.message : "Image conversion failed",
    })
  }
})
