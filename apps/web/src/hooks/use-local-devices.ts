import { useSyncExternalStore } from "react"

// The browser's microphones, cameras, and speakers, one list shared by the
// pre-join pickers and kept across visits. Listing never asks for access, and
// until the page has used a microphone or camera, browsers hide device names
// and list no speakers. Any grant refreshes the list for every picker.
let devices: MediaDeviceInfo[] | null = null
let latest = 0
let watching = false
const listeners = new Set<() => void>()

export async function refreshLocalDevices() {
  const run = ++latest
  let list: MediaDeviceInfo[] = []
  try {
    list = (await navigator.mediaDevices?.enumerateDevices()) ?? []
  } catch {}
  // An older listing that resolves late must not hide names a grant revealed.
  if (run === latest) {
    devices = list
    for (const listener of listeners) listener()
  }
  return list
}

async function openBriefly(constraints: MediaStreamConstraints) {
  const stream = await navigator.mediaDevices.getUserMedia(constraints)
  for (const track of stream.getTracks()) track.stop()
  return refreshLocalDevices()
}

// Asks for access, which is what reveals names, and resolves with the new
// list. Speakers come with the microphone, so a speaker picker asks for it.
export function requestDeviceAccess(kind: MediaDeviceKind) {
  return openBriefly(kind === "videoinput" ? { video: true } : { audio: true })
}

export function hasDeviceNames(list: MediaDeviceInfo[]) {
  return list.length > 0 && list.every((device) => device.label !== "")
}

// Some browsers (Safari, Firefox) keep names hidden after a reload even with
// the microphone allowed. Opening it for a moment shows them with no prompt.
// Never the camera, whose light would turn on.
async function watchPermissions() {
  for (const name of ["microphone", "camera"] as const) {
    try {
      const status = await navigator.permissions.query({ name })
      status.addEventListener("change", () => void refreshLocalDevices())
      if (name !== "microphone" || status.state !== "granted") continue
      await refreshLocalDevices()
      const microphones = (devices ?? []).filter(
        (device) => device.kind === "audioinput"
      )
      if (microphones.length > 0 && !hasDeviceNames(microphones)) {
        await openBriefly({ audio: true })
      }
    } catch {}
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!watching) {
    watching = true
    navigator.mediaDevices?.addEventListener(
      "devicechange",
      () => void refreshLocalDevices()
    )
    void watchPermissions()
  }
  void refreshLocalDevices()
  return () => {
    listeners.delete(listener)
  }
}

// null until the first listing arrives.
export function useLocalDevices() {
  return useSyncExternalStore(subscribe, () => devices)
}
